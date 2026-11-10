# Map ingestion readiness — 2026-09-10

Status: local wiring repaired and tested; live ingestion and graph-conditioned TIT are not certified.

## Implemented connections

- Elle swarm task completion -> local Lorentz hyper-map -> atlas13 region routing and localized recall.
- Swarm task observations -> dhng-bridge -> standalone cartographer -> hyperbolic and toroidal charts -> local atlas viewer.
- Worker memory recall -> append-only atlas event ledger -> standalone sync-events pull script -> cartographer.
- Standalone publisher -> service-authenticated worker atlas ingestion -> R2 snapshot + D1 index + best-effort Vectorize index -> read-only atlas queries.
- Local geometric nearest-neighbor -> Rust atlas-kernel. The harness-server crate is explicitly a placeholder; it is not the transport.
- TIT is loaded from specialist adapter configuration by the Python serving layer, with a private TITCache for replaced blocks. The inspected path does not take DHNG nodes or edges as runtime operator-construction inputs.

These are related maps with distinct schemas, not interchangeable snapshots. In particular, the local Lorentz task tree is not the same object as the standalone event-derived product atlas. The generic corpus paper-ingestion path stores text and chunks; it does not automatically extract a complete graph of concepts or distill model weights.

## Repairs

1. DHNG bridge and local atlas viewer now share the current sibling checkout, including ELLE_DHNG_DIR overrides. ELLE_ATLAS_DIR remains an explicit viewer override.
2. Concurrent specialist event appends are locked and atomic; corrupted ledgers cannot be silently overwritten. Existing bounded-history eviction is now returned as `dropped`.
3. Co-recalled task IDs retain their exact identity instead of stripping nonnumeric prefixes.
4. Publisher runs using the host Node runtime and the installed tsx loader. Standalone package dependencies were restored from the local npm cache.
5. Rejected atlas builds no longer overwrite latest.json; accepted latest snapshots use an atomic rename.
6. Local map ingestion and recall invoke the previously disconnected embedding-width check. Invalid, mixed-width, and zero vectors are rejected. New maps persist their input width. Existing maps with unknown width are held for provenance verification.
7. Corrupt existing local maps no longer become an empty map on write. Local view snapshots are written atomically.
8. Worker atlas ingestion validates node uniqueness, edge endpoints, finite chart coordinates, chart dimensions, Poincare bounds, timestamp, replay-compatible hash format, and curvature weights before persistence.
9. Incomplete embedding responses are rejected before vector upsert; ingestion receipts distinguish complete, partial and failed indexing while retaining the durable snapshot.
10. Atlas/event schema initialization is tracked per database handle.

## Verification

- Final combined local map, atlas13, state, viewer, DHNG bridge and swarm run: 104 tests passed.
- DHNG bridge: 4 tests passed, including 60 appends from four concurrent processes and a real isolated publish/read round trip.
- Worker graph, atlas, event, ingestion and geometry selection: 151 tests passed; worker TypeScript check passed.
- Worker test additionally builds a real standalone cartographer snapshot, ingests it through fake storage services, and retrieves both charts and the historical snapshot.
- Standalone cartographer: 171 tests passed with its installed dependency versions; both TypeScript checks passed.
- Rust harness-dhng: 66 tests passed using the rustup toolchain. Existing Rust atlas-kernel agrees with JavaScript on nearest-neighbor IDs and distances.
- Initial publisher CLI execution required an unnecessary IPC socket. Direct loading through the host Node runtime removed that dependency; the final real publish/read test passes.
- No production write, deployment, model training, live-map migration or model-server restart was performed.

## Remaining readiness conditions

### Qwen layer embeddings

The user confirms the map embedding came from Qwen layers. The current local embedder defaults to /api/embed/layers, concatenating layer taps. The saved faculty atlas contains 35,840-wide faculty vectors and a 35,840-wide centering vector, consistent with seven 5,120-wide taps. Do not substitute BGE embeddings for this local space.

The existing ~/.elle/hyper-map/map.json has 2,764 nodes without an embedDim field. The Electron user-data map has 24 nodes and embedDim:null. These are separate stores; they were not merged or modified. Width checks alone also cannot prove equal encoder checkpoints, tap order or pooling. Verify the live producer against the intended saved map before recording its provenance or rebuilding into a separate destination. Preserve the originals.

### Metal and TIT

The project virtual environment fails importing MLX in this session with "No Metal device available". The user ran the same environment in normal macOS Terminal and reported Metal available: True and [2.0, 3.0] for the test calculation. Metal/MLX works on the host; this session lacks device access. No installation was changed. The user was asked to run the actual TIT layer tests on the host; their result is pending.

The serving path constructs TIT from adapter configuration and loads adapters.safetensors. A graph-conditioned runtime construction interface has not been established. Do not describe graph ingestion as TIT distillation or as transferring the whole model into graph storage.

### Publication and corpus coverage

Cloud credentials, deployed code, remote storage writes and live service readiness were not tested. The source changes require the normal deployment/restart process before live use. The standalone worker-ledger pull and swarm-ledger build use separate files; a unified replay policy is still needed if one atlas must represent both histories. The sync-events script still stores event data and cursor separately, so crash-consistent replay requires further work. Do not start a bulk unified import until that is addressed.

## Next action

Obtain the host-side TIT test result (the Metal probe already passed). Confirm the exact Qwen producer/taps and intended live map directory, then preserve and migrate its provenance or re-encode into a new map. Run one reversible live ingest/read receipt through the selected deployment before bulk ingestion. Graph-to-TIT construction is a separate implementation task requiring the actual operator contract; it must not be invented from the map names.
