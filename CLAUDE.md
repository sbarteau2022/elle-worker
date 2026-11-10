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

## The psi finding — read before touching Target C

Measured, not argued. Full writeup + runnable scripts: `docs/PSI_ENCODER_FINDING.md`,
`docs/experiments/{bench,honest,beta}.mjs`.

- **The shipped Leaf Encoder psi is exactly Euclidean.** `max(1, ||sum||)` clamps
  `||f||` to 1 for any report with >=4 leaves, so `||psi|| = tanh(0.9)` for every
  input (2000/2000 at rho = 1.800000000, stddev 6e-14). All points land on one
  sphere, where d_B is a strictly increasing function of cosine distance:
  Spearman 1.000000000000, 0 inversions in 19900 pairs. Confirmed end-to-end —
  the hyperbolic arm scores 0.0207 mAP, identical to plain cosine.
  **H^128 under this encoder is 128 dimensions of restated cosine similarity.**
- **Do not "fix" it by putting derivation depth in the radius.** That looks like a
  970% mAP gain and is not one: ablating content to random directions with the
  same radii still scores 0.2175 vs 0.2216 — content contributes under 2%. It is
  a depth ruler, because near-orthogonal directions in high dimension make
  d_B ~ |rho_a - rho_b|. A beta sweep finds no setting that escapes it.
- **Where the fix is.** `src/hyper.ts` `hyperMap()` already implements Nickel &
  Kiela correctly (Riemannian SGD, inverse-metric rescaling, negative sampling,
  analytic gradient) — it fits radius and angle *jointly*, which is the only way
  both carry signal. psi should produce input FEATURES; hyperMap should produce
  the manifold COORDINATES. The plan has psi doing both.
- **Blocking unknowns.** `hyperMap` clamps dim to [2,16] and caps at 256 nodes /
  2048 edges, against a plan specifying H^128 and a 500-node benchmark. And
  delta-hyperbolicity has never been measured on real corpus content — the only
  reading (`GRAPH_PRESSURE_TEST.md`) says cyclic, and was computed over
  retriever-manufactured co-recall edges rather than content.

## Delegating to the local model

`tools/qwen-mcp/` in the **Elle** repo (not this one) bridges Claude Code to the
laptop's Ollama. Elle's own path already existed — `delegate_local` ->
`electron/native/providers/local-react-agent.cjs` -> Ollama, with `qwen3.8:27b`
hardcoded as the default in `sovereign-duplex.cjs`. The bridge just gives the
coding harness a door. Only works from a session executing ON the laptop;
127.0.0.1:11434 from a cloud container is that container's loopback.

## Known state
- `wasm-bridge.ts` cannot load the WASM core: **no `public/wasm/` artifact** (verified
  2026-09-09 — the directory does not exist), and `initWasm()` destructures
  `instance.exports` but wasm-pack's `init()` returns `InitOutput` (which *is* the
  exports). Target C Phase 1 depends on this crate.
  Corrected 2026-09-09: the clause "nothing imports the bridge" was **wrong** —
  `src/pfar.ts` imports it lazily (`import('./wasm-bridge')`) and `src/pfar-fft.test.ts`
  exercises it. But `docs/PFAR_PHASE_SPACE_PAPER.md` §"Corrections" overcorrected in the
  other direction, calling the bridge "confirmed live": with no artifact the fast path
  cannot engage in production, so the float-DFT fallback is what runs. Both halves of the
  record were wrong; this is the measured state.
- `test/m2-cordic-adversarial.spec.ts` 100k-step geodesic walk fails on slow hardware —
  5000ms default vs ~5.6s. Pre-existing on `main`, not a regression. Needs `testTimeout`.
- `ingest-queue.ts` rejects at depth 100 with no dead-letter path (§6.1 specifies one).

## Conventions
- Autonomous work writes to `elle/*` branches only; humans merge (invariant C3).
- Staging inserts are `INSERT OR IGNORE` — delivery is at-least-once keyed by a stable id,
  and D1 `batch()` is one transaction, so a plain INSERT lets one stale key wedge 50 rows.
- Once the sovereign lane demotes, the run stays hosted (§4.7) — `localDemoted` in router.ts.
