# elle-worker — agent memory

Cloudflare Worker (TypeScript, `workerd`) + Rust/WASM + D1 + Vectorize + KV + R2.
343 TS files, ~79.7k lines, 169 test files. `npx vitest run` · `npx tsc --noEmit`.

## Authoritative documents — read these, not the research notes
- **`docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md`** is THE spec. §1.3 is the formal invariant
  catalog (R1–R4, C1–C3, A1, S1, T1). Audit code against this.
- `docs/SWARM_INGESTION_AND_STORAGE_LIFECYCLE_PLAN.md` — D1 concurrency (μ=40 tx/s at
  T_commit=25ms), KV staging, ingest queue, §6.1 DLQ / §6.2 eviction races.
- `docs/COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md` — Target C, the 4-phase ℍ¹²⁸×𝕋⁸ pipeline.
- `../Elle/docs/atlas.tex` is a **paper**, not a spec. Do not audit code against it.

## Roadmap
A (Rust/WASM core) → B (dual-router classifier, KV staging, ingest queue) → C (Poincaré
manifold auto-wiring). A and B are on `main`. C is next.

## Lane protocol — the distinction that gets mis-audited
- **v1** = `src/lane-envelope.ts`: symmetric HKDF-SHA256 + hyperbolic keystream.
  No forward secrecy, and never claimed any.
- **v2** = `src/lane-handshake.ts` + `src/pqc-hybrid.ts`: X25519 + ML-KEM-768. FS + PCS.
- v2 is gated on `ELLE_LANE_PROTOCOL=v2`, **commented out at `wrangler.toml:263`**.
  wrangler.toml is authoritative for `[vars]` (see its own note ~line 169), so live bus
  traffic is v1 — while invariant **S1** asserts the bus has PQC forward secrecy as
  enforced. Open discrepancy: arm the flag or mark S1 v2-conditional.

## Known state
- `wasm-bridge.ts` cannot load the WASM core: no `public/wasm/` artifact; `initWasm()`
  destructures `instance.exports` but wasm-pack's `init()` returns `InitOutput` (which *is*
  the exports); and nothing imports the bridge. Target C Phase 1 depends on this crate.
- `test/m2-cordic-adversarial.spec.ts` 100k-step geodesic walk fails on slow hardware —
  5000ms default vs ~5.6s. Pre-existing on `main`, not a regression. Needs `testTimeout`.
- `ingest-queue.ts` rejects at depth 100 with no dead-letter path (§6.1 specifies one).

## Conventions
- Autonomous work writes to `elle/*` branches only; humans merge (invariant C3).
- Staging inserts are `INSERT OR IGNORE` — delivery is at-least-once keyed by a stable id,
  and D1 `batch()` is one transaction, so a plain INSERT lets one stale key wedge 50 rows.
- Once the sovereign lane demotes, the run stays hosted (§4.7) — `localDemoted` in router.ts.
