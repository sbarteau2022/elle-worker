"""
Milestone 6: Zero-Copy Shared Memory IPC Bridge.
"""

from python.ipc.shm_bridge import (
    SharedMemoryBuffer,
    ShmTensorDescriptor,
    DESCRIPTOR_SIZE,
    MAGIC_DHNG,
    VERSION_V1,
    DTYPE_FLOAT16,
    DEFAULT_NUM_LAYERS,
    DEFAULT_HIDDEN_DIM,
    DEFAULT_PAYLOAD_BYTES,
    FLAG_GATED_VISUAL_FUSION,
    FLAG_DORA_ACTIVE,
)

__all__ = [
    "SharedMemoryBuffer",
    "ShmTensorDescriptor",
    "DESCRIPTOR_SIZE",
    "MAGIC_DHNG",
    "VERSION_V1",
    "DTYPE_FLOAT16",
    "DEFAULT_NUM_LAYERS",
    "DEFAULT_HIDDEN_DIM",
    "DEFAULT_PAYLOAD_BYTES",
    "FLAG_GATED_VISUAL_FUSION",
    "FLAG_DORA_ACTIVE",
]
