# Hybrid Dynamic Embedder

Multi-layer hyperbolic embedder for the **Qwen3.8-27B** multimodal local
observer on Apple Silicon (MLX, 4-bit), feeding the Dynamic Hyperbolic
Neural Graph. Replaces flat Euclidean embeddings with a mixed-curvature
product manifold, ℍⁿ × 𝕋ᵈ.

## Canonical location

    /Users/stewartbarteau/Desktop/elle-worker/docs/hybrid-dynamic-embedder

This is the **only** copy. Earlier sessions produced several near-empty
look-alikes at `~/Desktop/Hybrid Dynamic Embedder/` and at a variant of
the repo root whose name began with a space; both have been deleted and
their unique content committed here. If you find another, it is stale.

## Layout

| Path | Contents |
|---|---|
| `python/math_core/` | Poincaré and Lorentz charts, ℍⁿ × 𝕋ᵈ product metric, Atlas/TIT bridge |
| `python/mlx_server/` | `/v1/embed/layers` daemon, layer extraction, JIT Metal kernels |
| `python/vision_fusion/` | Qwen-VL vision tower, patch merger, RoI pooling, origin tangent fusion |
| `python/gates/` | Gate 3 geometric cross-modal validation filter |
| `python/ipc/` | Shared-memory descriptor bridge to the Rust harness |
| `python/training/` | DoRA adapter and compound manifold loss |
| `python/atlas/` | Atlas transformer, tokenizer, symplectic and swarm engines |
| `tests/` | unit, integration, adversarial, e2e, benchmarks |
| `scratch/` | `pressure_test.sh`, the Milestone 2 load-test gate |

`SPECIFICATION.md` is the architecture of record. `POTENTIAL_TUNING.md`
covers MLX Q4 surgery, DoRA, and the Metal shaders.

## Status

| Milestone | State | Evidence |
|---|---|---|
| M1 hyperbolic math core | done | 600 tests pass; Metal kernel matches CPU to 2.5e-07 |
| M2 MLX multi-layer observer | **live** | `scratch/pressure_test.sh` → 20/20, `mode=live` |
| M3 visual fusion | code complete, untested end-to-end against the live tower |
| M4 Gate 3 cross-modal filter | **not wired** | endpoint returns fixed placeholders with `gate3_wired: false` |
| M5 DoRA training | scaffolding only, no adapter trained |
| M6 zero-copy IPC | Python packs the descriptor; **no Rust reader exists yet** |

### Running the server

    uv run python -m python.mlx_server.server            # loads the 4-bit weights
    uv run python -m python.mlx_server.server --simulate # constant vectors, no model

`--simulate` serves deterministic placeholder vectors that are identical for
every input. `GET /health` reports `mode` so a caller can tell the two apart.

### Milestone 2 gate

    bash scratch/pressure_test.sh

## Running the tests

    cd "/Users/stewartbarteau/Desktop/elle-worker/docs/hybrid-dynamic-embedder"
    uv run --with pytest --with numpy --with mlx python -m pytest -q

## Model weights

`mlx-community/Qwen3.8-27B-4bit`, already on disk (~15 GB):

    ~/Desktop/Elle/tools/mlx-serve/weights/Qwen3.8-27B-4bit

hidden_size **5120**, 64 transformer blocks, multimodal. Re-fetch with
`~/Desktop/Elle/tools/mlx-serve/fetch_weights.sh` if it ever goes missing.

## Related repositories

- `~/Desktop/hybrid-HNPA-active-inference-LLM` — Atlas / TIT (branch `proof-of-golden-ratio-emergence-8afc0`)
- `~/Desktop/Dynanic-Hyperbolic-Neural-Graph` — DHNG manifold substrate
- `~/Desktop/Elle/elle_rust_harness` — Rust harness, `crates/harness-dhng`
