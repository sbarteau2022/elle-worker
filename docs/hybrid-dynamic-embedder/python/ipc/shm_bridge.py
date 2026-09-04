"""
Milestone 6: Zero-Copy Shared Memory IPC Bridge (Python side).

Implements POSIX shared memory allocation, 64-byte ShmTensorDescriptor packing,
and mmap-based tensor read/write for the MLX ↔ Rust harness zero-copy boundary.

Memory Layout (SPECIFICATION.md § 6.3):
    [0x0000 - 0x003F] 64-byte ShmTensorDescriptor header
    [0x0040 - ...]     float16 payload: 7 × 3584 × 2 = 50,176 bytes

The descriptor is packed as:
    magic:          u32  (0x44484E47 = "DHNG")
    version:        u16  (0x0001)
    dtype:          u16  (0x0001 = float16)
    num_layers:     u32  (7)
    hidden_dim:     u32  (3584)
    seq_len:        u32  (variable)
    flags:          u32  (Bit 0: Gated visual fusion, Bit 1: DoRA active)
    payload_offset: u64  (64)
    payload_bytes:  u64  (50176)
    timestamp_ns:   u64  (nanosecond wall clock)
    sequence_id:    u64  (monotonic counter)
    reserved:       8 bytes padding (64-byte total alignment)
"""

from __future__ import annotations

import mmap
import struct
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import numpy as np
except ImportError:
    np = None

# ============================================================================
# Constants matching extract_endpoint.py
# ============================================================================

MAGIC_DHNG = 0x44484E47
VERSION_V1 = 0x0001
DTYPE_FLOAT16 = 0x0001
DEFAULT_NUM_LAYERS = 7
DEFAULT_HIDDEN_DIM = 3584
DEFAULT_PAYLOAD_BYTES = DEFAULT_NUM_LAYERS * DEFAULT_HIDDEN_DIM * 2  # 50,176 bytes
DESCRIPTOR_SIZE = 64
DESCRIPTOR_FORMAT = "<IHHI I I I Q Q Q Q 8s"

# Flag bits
FLAG_GATED_VISUAL_FUSION = 0x01
FLAG_DORA_ACTIVE = 0x02


# ============================================================================
# ShmTensorDescriptor — Python-native packing/unpacking
# ============================================================================

class ShmTensorDescriptor:
    """
    64-byte shared memory tensor descriptor for the DHNG IPC protocol.
    """

    def __init__(
        self,
        num_layers: int = DEFAULT_NUM_LAYERS,
        hidden_dim: int = DEFAULT_HIDDEN_DIM,
        seq_len: int = 0,
        flags: int = FLAG_GATED_VISUAL_FUSION | FLAG_DORA_ACTIVE,
        payload_offset: int = DESCRIPTOR_SIZE,
        payload_bytes: int = DEFAULT_PAYLOAD_BYTES,
        timestamp_ns: int = 0,
        sequence_id: int = 1,
    ) -> None:
        self.magic = MAGIC_DHNG
        self.version = VERSION_V1
        self.dtype = DTYPE_FLOAT16
        self.num_layers = num_layers
        self.hidden_dim = hidden_dim
        self.seq_len = seq_len
        self.flags = flags
        self.payload_offset = payload_offset
        self.payload_bytes = payload_bytes
        self.timestamp_ns = timestamp_ns if timestamp_ns else time.time_ns()
        self.sequence_id = sequence_id

    def pack(self) -> bytes:
        """Packs the descriptor into a 64-byte buffer."""
        padding = b"\x00" * 8
        return struct.pack(
            DESCRIPTOR_FORMAT,
            self.magic,
            self.version,
            self.dtype,
            self.num_layers,
            self.hidden_dim,
            self.seq_len,
            self.flags,
            self.payload_offset,
            self.payload_bytes,
            self.timestamp_ns,
            self.sequence_id,
            padding,
        )

    @classmethod
    def unpack(cls, data: bytes) -> "ShmTensorDescriptor":
        """Unpacks a 64-byte buffer into a ShmTensorDescriptor."""
        if len(data) < DESCRIPTOR_SIZE:
            raise ValueError(f"Buffer too small: {len(data)} < {DESCRIPTOR_SIZE}")

        fields = struct.unpack(DESCRIPTOR_FORMAT, data[:DESCRIPTOR_SIZE])
        magic = fields[0]
        if magic != MAGIC_DHNG:
            raise ValueError(f"Invalid magic: 0x{magic:08X} (expected 0x{MAGIC_DHNG:08X})")

        desc = cls.__new__(cls)
        desc.magic = fields[0]
        desc.version = fields[1]
        desc.dtype = fields[2]
        desc.num_layers = fields[3]
        desc.hidden_dim = fields[4]
        desc.seq_len = fields[5]
        desc.flags = fields[6]
        desc.payload_offset = fields[7]
        desc.payload_bytes = fields[8]
        desc.timestamp_ns = fields[9]
        desc.sequence_id = fields[10]
        return desc

    @property
    def gated_visual_fusion(self) -> bool:
        return bool(self.flags & FLAG_GATED_VISUAL_FUSION)

    @property
    def dora_active(self) -> bool:
        return bool(self.flags & FLAG_DORA_ACTIVE)

    @property
    def shape(self) -> Tuple[int, int]:
        return (self.num_layers, self.hidden_dim)

    @property
    def strides(self) -> Tuple[int, int]:
        return (self.hidden_dim * 2, 2)

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable descriptor metadata."""
        return {
            "magic": f"0x{self.magic:08X}",
            "version": self.version,
            "dtype": "float16",
            "num_layers": self.num_layers,
            "hidden_dim": self.hidden_dim,
            "seq_len": self.seq_len,
            "flags": self.flags,
            "gated_visual_fusion": self.gated_visual_fusion,
            "dora_active": self.dora_active,
            "payload_offset": self.payload_offset,
            "payload_bytes": self.payload_bytes,
            "timestamp_ns": self.timestamp_ns,
            "sequence_id": self.sequence_id,
            "shape": list(self.shape),
            "strides": list(self.strides),
        }


# ============================================================================
# Shared Memory Buffer — Anonymous mmap for zero-copy IPC
# ============================================================================

class SharedMemoryBuffer:
    """
    Anonymous mmap-backed shared memory buffer for zero-copy tensor exchange.

    Writes:
        1. 64-byte ShmTensorDescriptor header at offset 0
        2. float16 payload at offset 64

    The Rust harness maps the same region and reads directly without copies.
    """

    def __init__(
        self,
        num_layers: int = DEFAULT_NUM_LAYERS,
        hidden_dim: int = DEFAULT_HIDDEN_DIM,
    ) -> None:
        self.num_layers = num_layers
        self.hidden_dim = hidden_dim
        self.payload_bytes = num_layers * hidden_dim * 2
        self.total_bytes = DESCRIPTOR_SIZE + self.payload_bytes
        self._buf: Optional[mmap.mmap] = None
        self._sequence_counter = 0

    def allocate(self) -> None:
        """Allocates anonymous mmap buffer."""
        self._buf = mmap.mmap(-1, self.total_bytes)

    def is_allocated(self) -> bool:
        return self._buf is not None

    def write_tensor(
        self,
        pooled_layers: Sequence[Sequence[float]],
        seq_len: int = 0,
        flags: int = FLAG_GATED_VISUAL_FUSION | FLAG_DORA_ACTIVE,
    ) -> ShmTensorDescriptor:
        """
        Writes a multi-layer pooled tensor into the shared memory buffer.

        Args:
            pooled_layers: List of 7 vectors, each of dimension 3584.
            seq_len: Input sequence length (metadata).
            flags: Bit flags for gated fusion / DoRA status.

        Returns:
            The packed ShmTensorDescriptor.
        """
        if self._buf is None:
            self.allocate()

        self._sequence_counter += 1

        descriptor = ShmTensorDescriptor(
            num_layers=self.num_layers,
            hidden_dim=self.hidden_dim,
            seq_len=seq_len,
            flags=flags,
            payload_bytes=self.payload_bytes,
            sequence_id=self._sequence_counter,
        )

        # Pack header
        header_bytes = descriptor.pack()
        self._buf.seek(0)
        self._buf.write(header_bytes)

        # Pack payload as float16
        payload = struct.pack(
            f"<{self.num_layers * self.hidden_dim}e",
            *(float(x) for layer in pooled_layers for x in layer),
        )
        self._buf.write(payload)

        return descriptor

    def read_descriptor(self) -> ShmTensorDescriptor:
        """Reads the 64-byte descriptor from offset 0."""
        if self._buf is None:
            raise RuntimeError("Buffer not allocated")
        self._buf.seek(0)
        header_data = self._buf.read(DESCRIPTOR_SIZE)
        return ShmTensorDescriptor.unpack(header_data)

    def read_payload(self) -> List[List[float]]:
        """Reads the float16 payload and reshapes to [num_layers, hidden_dim]."""
        if self._buf is None:
            raise RuntimeError("Buffer not allocated")
        self._buf.seek(DESCRIPTOR_SIZE)
        raw = self._buf.read(self.payload_bytes)
        count = self.num_layers * self.hidden_dim
        flat = struct.unpack(f"<{count}e", raw)
        return [
            list(flat[i * self.hidden_dim : (i + 1) * self.hidden_dim])
            for i in range(self.num_layers)
        ]

    def read_payload_numpy(self) -> Any:
        """Reads payload as numpy float16 array of shape [num_layers, hidden_dim]."""
        if np is None:
            raise RuntimeError("NumPy required")
        if self._buf is None:
            raise RuntimeError("Buffer not allocated")
        self._buf.seek(DESCRIPTOR_SIZE)
        raw = self._buf.read(self.payload_bytes)
        arr = np.frombuffer(raw, dtype=np.float16)
        return arr.reshape(self.num_layers, self.hidden_dim)

    def close(self) -> None:
        """Closes the mmap buffer."""
        if self._buf is not None:
            self._buf.close()
            self._buf = None

    def __del__(self) -> None:
        self.close()
