"""
Shared-memory descriptor fixtures and binary serialization utilities.
Validates the 64-byte ShmTensorDescriptor ABI bridge between MLX and harness-dhng.
"""

import struct
from typing import Dict, Any, Tuple

# Binary layout per PROJECT.md § M2/M3 <-> M4 Interface Contract:
# magic: u32 (4B)
# version: u16 (2B)
# dtype: u16 (2B) - 0x0001 = Float16
# num_layers: u32 (4B) - 7 layers
# hidden_dim: u32 (4B) - 3584
# seq_len: u32 (4B)
# flags: u32 (4B) - Bit 0: Gated visual fusion, Bit 1: DoRA active
# payload_offset: u64 (8B)
# payload_bytes: u64 (8B) - 7 * 3584 * 2 = 50,176
# timestamp_ns: u64 (8B)
# sequence_id: u64 (8B)
# reserved / padding: 8 bytes to achieve 64-byte alignment
SHM_DESCRIPTOR_FORMAT = "<IHHI I I I Q Q Q Q 8s"
SHM_DESCRIPTOR_SIZE = struct.calcsize(SHM_DESCRIPTOR_FORMAT)
MAGIC_DHNG = 0x44484E47  # "DHNG" in ASCII little-endian
VERSION_V1 = 0x0001
DTYPE_FLOAT16 = 0x0001
NUM_LAYERS_DEFAULT = 7
HIDDEN_DIM_DEFAULT = 3584
PAYLOAD_BYTES_DEFAULT = NUM_LAYERS_DEFAULT * HIDDEN_DIM_DEFAULT * 2  # 50,176 bytes


def pack_shm_descriptor(
    seq_len: int = 1,
    flags: int = 0x0003,  # Gated fusion (bit 0) + DoRA (bit 1)
    payload_offset: int = 64,
    payload_bytes: int = PAYLOAD_BYTES_DEFAULT,
    timestamp_ns: int = 1725412800000000000,
    sequence_id: int = 1,
    magic: int = MAGIC_DHNG,
    version: int = VERSION_V1,
    dtype: int = DTYPE_FLOAT16,
    num_layers: int = NUM_LAYERS_DEFAULT,
    hidden_dim: int = HIDDEN_DIM_DEFAULT,
) -> bytes:
    """Packs a 64-byte ShmTensorDescriptor."""
    padding = b"\x00" * 8
    return struct.pack(
        SHM_DESCRIPTOR_FORMAT,
        magic,
        version,
        dtype,
        num_layers,
        hidden_dim,
        seq_len,
        flags,
        payload_offset,
        payload_bytes,
        timestamp_ns,
        sequence_id,
        padding,
    )


def unpack_shm_descriptor(buffer: bytes) -> Dict[str, Any]:
    """Unpacks a 64-byte ShmTensorDescriptor from raw binary bytes."""
    if len(buffer) < SHM_DESCRIPTOR_SIZE:
        raise ValueError(f"Buffer length {len(buffer)} is less than descriptor size {SHM_DESCRIPTOR_SIZE}")

    (
        magic,
        version,
        dtype,
        num_layers,
        hidden_dim,
        seq_len,
        flags,
        payload_offset,
        payload_bytes,
        timestamp_ns,
        sequence_id,
        padding,
    ) = struct.unpack(SHM_DESCRIPTOR_FORMAT, buffer[:SHM_DESCRIPTOR_SIZE])

    return {
        "magic": magic,
        "magic_hex": hex(magic),
        "is_valid_magic": magic == MAGIC_DHNG,
        "version": version,
        "dtype": dtype,
        "num_layers": num_layers,
        "hidden_dim": hidden_dim,
        "seq_len": seq_len,
        "flags": flags,
        "gated_fusion_active": bool(flags & 0x01),
        "dora_active": bool(flags & 0x02),
        "payload_offset": payload_offset,
        "payload_bytes": payload_bytes,
        "timestamp_ns": timestamp_ns,
        "sequence_id": sequence_id,
        "descriptor_size": SHM_DESCRIPTOR_SIZE,
    }
