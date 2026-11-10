# Mean-centering re-measure — is the routing ceiling a cone artifact?

## Context

Routing holds 58% of briefs at the centre; the raw ceiling is 0.58 and top-3 containment 0.83 (ROUTING_001, `ELLE_GSM8K_001.md:595`). Qwen's audit diagnosed the measured collinearity — every faculty description at cosine 0.73–0.86 with a word problem — as **sentence-embedding anisotropy**: the twelve faculty embeddings share a large common direction, so no brief's leading faculty clears the collapse margin. If true, the ceiling is an unsubtracted mean vector, not ontology.

`COGNITIVE_OBLIQUITY.md` adds a constraint: obliquity needs anisotropy to act on. So the fix must remove the **mean offset** (which collapses routing) while preserving the **variance structure** (the preferred axis obliquity rotates against). That means mean-centering only — **not** all-but-the-top, which deletes the top principal component and may delete the axis.

Pre-registered by Qwen and me jointly; decision rule fixed before running. Testing is paused for the model; this touches no model, no heal, and none of Stewart's in-progress files. First pass uses cached embeddings only.

## What exists (no new infrastructure)

- `Elle/electron/native/routing-diagnose.cjs <batch.jsonl> [limit] [--sweep] [--posted]` — re-embeds briefs, ranks all 12 faculties, reports rank of the intended one + the `collapse()` decision; caches at `<batch>.emb.json`. Has `--sweep` over COLLAPSE/MARGIN/RATIO.
- Live atlas: `~/Library/Application Support/elle/hyper-map/atlas13.json`, field `facultyEmb` (12 × 1024, bge-large). Used by `atlas13.cjs:533–534` when present.
- The gate: `collapse()` at `atlas13.cjs:414–420` — `held = !(top ≥ 0.06 ∧ top−next ≥ 0.02 ∧ top ≥ 1.3·next)`.
- Briefs: `elle-worker/research/seam-wire/briefs/gemini-batch-01.jsonl` with `.emb.json` and `.posted.emb.json` cached; batches 02–15 uncached (990 total).
- Six faculty axes: `faculties.json` pairs, mapped to `KISSING_PAIRS` at `atlas13.cjs:453–457`.

## The change

One new script, `Elle/electron/native/routing-recenter.cjs` (≈80 lines), reusing `routing-diagnose.cjs`'s cache format and `atlas13.collapse`:

1. Load `atlas.facultyEmb` (12 × 1024) and the cached brief embeddings from `gemini-batch-01.jsonl.posted.emb.json` (the text the coordinator actually saw — the variant that reproduced 0.227 = live).
2. Compute two candidate means: **μ_fac** = mean of the 12 faculty embeddings; **μ_briefs** = mean of all cached brief embeddings (a larger sample of the encoder's offset). Report ‖μ‖ and cos(μ_fac, μ_briefs).
3. For each arm ∈ {raw, centred-by-μ_fac, centred-by-μ_briefs}: subtract μ from every faculty embedding **and** every brief embedding, re-normalise, recompute the 12 affinities per brief, apply the unchanged `collapse()` constants, record rank-of-intended, held/released, top-1 and top-3.
4. **F1b readout** per arm: SVD of the centred 12 × 1024 faculty matrix → σ₂/σ₁. This is Qwen's identifiability floor and, by `COGNITIVE_OBLIQUITY.md`'s precondition, the test of whether a preferred axis survives centering.
5. Aperture per arm: the 12 × 12 faculty cosine matrix — mean off-diagonal cosine before/after (the 0.73–0.86 number).
6. Print one table: arm | held % | top-1 | top-3 | mean off-diag cos | σ₂/σ₁. Write it to `elle-worker/research/seam-wire/ROUTING_002_recenter.md` under the pre-registration below, numbers as returned.

Do **not** touch `COLLAPSE/MARGIN/RATIO` in this pass — the point is whether centering alone clears the existing gate. `--sweep` on the centred embeddings is a permitted second pass.

## Pre-registered decision rule (Qwen + me, 2026-09-09)

- **Held fraction < 30% after centering** → the cone was artifact. The ceiling was never ontology. F2b's residual failure (if any) becomes the real duality number. Next: apply centering in `atlas13.build()` behind a flag, re-measure live routing.
- **Held fraction ≥ 30% after centering** → the cone is semantic; `collapse()` is doing real work; the routing gap is genuinely in the faculty descriptions and needs the reranker (T1), not a projection fix.
- **σ₂/σ₁ collapses toward 0 after centering** → centering removed the preferred axis; report it, and obliquity's precondition is lost under this fix. If σ₂/σ₁ stays well above its raw value's noise floor, both mechanisms survive.
- Either branch is informative. No re-tuning to reach a branch.

## Scope guard

- Pass 1: batch-01 only, cached vectors, **no embedder, no GPU**.
- Pass 2 (only if pass 1 is within ±5 pts of the 30% line): embed batches 02–15 with `local-embed.cjs` — that's the bge-large embedder, not the 27B; unload Ollama first per the standing trap list.
- Nothing is written into `atlas13.cjs`. The flag-gated build change is a separate step after the number exists.

## Verification

- Raw arm must reproduce ROUTING_001 on the same briefs: held ≈ 58%, top-1 ≈ 0.23 on `--posted` text. If it doesn't, the script is wrong — stop.
- μ_fac vs μ_briefs arms should agree in direction (cos > 0.9); disagreement means the faculty set is too small to estimate the encoder offset and μ_briefs is the one to trust.
- The table and the decision go verbatim to Qwen for ledger v3 — it asked for exactly this ("send the aperture re-measure … when it exists").

## After this, in order

1. F3 anchor-hash binding — now includes obliquity 38.669°, since `COGNITIVE_OBLIQUITY.md` settled it (analytic 38.1727° = arccos(1/√φ), the cos²θ golden crossing; the generator's 26.049° is `timescaleSeparation`'s drift schedule, a different quantity — fix the generator to call `obliquitySteers()`).
2. The stale rows: `TOROIDAL_GRAPH_MAPPING §9` lemniscate-necessity row; `torus.ts:25–29`; `CLAUDE.md` wasm-bridge bullet.
3. Semantic δ-hyperbolicity arm — needs the `/api/search` service key; the single highest-value unrun experiment.
4. PAMI T² acceptance bench (Qwen §4) — replaces my withdrawn great-circle T³ task.
