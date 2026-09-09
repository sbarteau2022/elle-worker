[MEASURED] Rechecked every bullet in FINDINGS_REGISTER_FOR_QWEN §14 against current files, plus the three reported repairs and their surviving contradictory statements.
[DERIVED] The three source repairs and generator obliquity repair are present; encoder/capability claims, missing-paper references, hypothesis serialization, default-protocol wording and snapshot provenance still need the exact edits proposed below.

# Stale documentation remaining — 2026-09-09

[DESIGN CHOICE] All paths below are relative to `/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK`. Line numbers identify the inspected version and are not durable patch offsets. Each replacement block is literal proposed text tagged DESIGN CHOICE; preceding MEASURED statements identify the supporting source. No existing file was edited. The user’s no-edit/no-git instruction governs this handoff; the owner applies any accepted change.

[MEASURED] §14 contains nine bullets, several bundling multiple defects, rather than fourteen individually enumerated items. The sections below account for all nine bullets and the two torus defects elsewhere in the register. Additional occurrences of the same claims in the implementation plan are included to avoid a cosmetic one-line repair.

## Repairs present — do not reapply

[MEASURED] `elle-worker/CLAUDE.md:65–74` now distinguishes the actual lazy import/test from the absent local WASM artifact and incorrect export destructuring. `elle-worker/src/torus.ts:25–31` now says winding is exact and lemniscate unnecessary. `elle-worker/docs/TOROIDAL_GRAPH_MAPPING.md:228` now says TRUE for torus identity continuity. These repair the three specific old statements. They do not prove deployment or cognitive mechanism.

[MEASURED] `elle-worker/scripts/gen-harmonic-snapshot.mjs:15–19` uses `../src` imports, and :70–79 implements the bisection and analytic `acos(sqrt(PHI_INV))`. The stale 26.049° expression appears only in the explanatory history comment. Generator execution was not repeated because it is owned by the other session and unnecessary for this source audit. Remaining literal inputs are documented below.

## 1. Hyperbolic dimensions, encoder and caps

[MEASURED] `elle-worker/docs/HYPERBOLIC_GRAPH_MAPPING.md:62–83` still describes universal hashed input, D=16 and the old hard norm clamp. `src/hyper.ts:165–177,202–237` implements compact 29-dimensional input, a PAMI bridge special case, and radial tanh squash for other reports. The defect is broader than changing 16 to 29.

[DESIGN CHOICE] Replace the body of §2, lines 62–83, with:

> [MEASURED] `ripVector` produces 29-dimensional input features by default (`RIP_DIM = 29`). PAMI-like inputs use `pamiBridgeVector`, truncated or zero-padded to the requested feature width. Other reports contribute up to 512 finite numeric leaves in sorted-key order. Each path hashes to a unit direction; its value contributes `tanh(sign(v) * log(1 + abs(v)))` times that direction. If the resulting sum is u with finite norm n > 0, the feature vector is `u * tanh(n) / n`; the zero vector remains zero. This replaces the old hard clamp that erased radial variation.
>
> [MEASURED] Input feature width and fitted manifold dimension are separate: `hyperMap` defaults to 128 manifold coordinates. A 1024-wide consumer must adapt at its own boundary. See `src/hyper.ts` and `PSI_ENCODER_FINDING.md`.
>
> [OPEN] These transformations are instrumentation. They do not establish geometry-specific retrieval benefit on real content; the old fixed-radius encoder’s failure cannot be repaired by relabelling its dimensions.

[MEASURED] `elle-worker/docs/HYPERBOLIC_GRAPH_MAPPING.md:142` still gives caps 256/2048 and dim 2–16/default 2. Code `src/hyper.ts:271–274,311` gives 20000/200000, 1000 epochs, MAX_DIM 512 and default 128.

[DESIGN CHOICE] Replace the cap sentence beginning “Caps:” with:

> Caps: 20,000 nodes, 200,000 edges, 1,000 epochs, dim ∈ [2, 512] (default 128). `hyperMapCapacity()` reports dropped input so callers can distinguish a complete atlas from clipped input.

## 2. Dual-router sensory capabilities

[MEASURED] `elle-worker/docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md:395–396` still claims a 16-band eGeMAPS ripper with spectral flux, and scene cuts with 8-orientation Gabor. `src/pfar.ts:264–274,295–297,485` documents frame-level prosody proxies and coarse spectral summaries. `src/vfar.ts:208–210` uses wavelengths [4,8], orientations [0,45,90,135], and 9×9 kernels. No spectral-flux or scene-cut implementation was found in these named modules. The parameter set tracks eGeMAPS; that is not the same as a standardized full eGeMAPS implementation.

[DESIGN CHOICE] Replace item 2 at :395 with:

> 2. **Acoustic Prosody Channel (PFAR, `src/pfar.ts`):** Autocorrelation F0 estimates, pitch statistics, frame-granular jitter/shimmer/HNR proxies, voiced fraction, pauses, alpha ratio, Hammarberg index and spectral centroid. These are selected eGeMAPS-related features, not a validated complete eGeMAPS implementation. This module does not implement the previously claimed 16-band eGeMAPS or spectral-flux extractor.

[DESIGN CHOICE] Replace item 3 at :396 with:

> 3. **Visual Field Channel (vFAR, `src/vfar.ts`):** Luma-field and Sobel statistics, structure-tensor orientation, Gabor texture energy at four orientations (0°, 45°, 90°, 135°) and two wavelengths (4, 8 pixels), and GLCM features. Scene-cut detection is not implemented in this module.

[DESIGN CHOICE] Replace the trailing comment on the `vision?: boolean` line at :357 with:

> // Visual field (vFAR): spatial statistics and texture — world channel 2

## 3. Implementation plan: dead encoder and overbroad validation stamp

[MEASURED] `elle-worker/docs/COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md:265–313` still presents the B^1024 hard-clamp encoder as the implementation. `src/hyper.ts:165–177` explicitly calls this plan’s encoder dead and separates 29 input features from default 128-dimensional fitted coordinates. `docs/PSI_ENCODER_FINDING.md:5` records the fixed-radius failure. At :1042 the plan still says “Production Validated.”

[DESIGN CHOICE] Replace all of §2.2 (heading at :265 through the separator before §2.3) with:

> ### 2.2 Compact input features and fitted coordinates
>
> [MEASURED] The B^1024 hard-clamp leaf encoder formerly described here is retired; `PSI_ENCODER_FINDING.md` records its constant-radius and cosine-equivalent retrieval failure. Current `src/hyper.ts` uses `RIP_DIM = 29`: PAMI inputs use the phase-aware bridge and other numeric-leaf reports use deterministic hashing followed by radial tanh squash with a zero-norm guard.
>
> [MEASURED] Input feature dimension is distinct from fitted manifold dimension: `hyperMap` defaults to 128 coordinates and permits dimensions 2–512. A 1024-dimensional storage/index boundary does not require a 1024-dimensional leaf encoder.
>
> [OPEN] This is implemented instrumentation, not proof of geometric retrieval mechanism. The current graph-geodesic corpus measurement is recorded in `research/seam-wire/ROUTING_002_recenter.md` as not clearing the preregistered tree-like threshold.

[DESIGN CHOICE] Replace :1042 with:

> *Integrity Mode:* Implementation plan; validation is claim-specific. The former B^1024 encoder is retired, and implemented sensory features differ from some historical diagrams. See `src/hyper.ts`, `src/pfar.ts`, `src/vfar.ts`, `PSI_ENCODER_FINDING.md` and the dated routing findings.

[MEASURED] The same plan repeats the obsolete modalities in §2.1 and diagrams/milestones. [DESIGN CHOICE] Apply these exact companion text replacements (leave surrounding diagram borders and indentation intact):

- :64, :184 and :528: replace `eGeMAPS` labels with `selected prosody proxies`.
- :71: replace `Leaf Encoder psi: R^1024 -> B^n` with `Input features: R^29; fitted B^n`.
- :182: replace `Gabor 8-O` with `Gabor 4-O`.
- :190: replace `Leaf Encoder psi (1024-dim Dense)` with `Compact input features (29 dimensions)`.
- :191: replace `f = sum_i s(v_i) e(p_i) in R^1024` with `PAMI bridge or radially squashed hash features`.
- :228 through the end of §2.1.1 at :241: replace with the PFAR item text proposed in section 2 above, without its leading `2.`.
- :250: replace `8-orientation, 4-scale` with `4-orientation, 2-wavelength`.
- :531: replace `1024-dim Leaf Projection` with `29-dim Input Features`.
- :562: replace the entire milestone with `1. Validate the implemented PFAR prosody proxies and fallback behavior on representative audio; full eGeMAPS coverage, spectral flux, WASM deployment and sub-2-ms performance remain separate unverified targets.`
- :563: replace `8-orientation` with `4-orientation, 2-wavelength`.
- :565 through its subordinate encoder steps before item 5 at :569: replace with `4. Use the compact 29-dimensional input encoder and separate fitted manifold dimensions as specified in the corrected §2.2; retire the B^1024 hard-clamp design.`

[DERIVED] References to an actual 1024-dimensional Vectorize boundary (for example :569) should remain. Blind global replacement of “1024” would introduce new errors.

## 4. Two missing-paper references

[MEASURED] `Elle/docs/pfar_phase_space.tex` does not exist at the cited location. Both `elle-worker/docs/PFAR_PHASE_SPACE_PAPER.md:3–10` and `Dynanic-Hyperbolic-Neural-Graph/docs/PFAR_PHASE_SPACE_PAPER.md:3–10` still introduce it as “the paper.” This is a missing current path, not a claim that no historical or differently named paper ever existed.

[DESIGN CHOICE] In each companion, replace the introductory paragraph from “Status” through its paper/spec explanation with:

> **Status: historical implementation companion.** The previously cited `../../Elle/docs/pfar_phase_space.tex` is absent from the current checkout; its title and section references are historical, unverified references. This document is not an independent specification. Audit implementation against this repository’s extant specification files and current source. Restore a verified paper path and version before treating its section citations as authoritative.

## 5. WASM overcorrection survives in the companion

[MEASURED] `elle-worker/docs/PFAR_PHASE_SPACE_PAPER.md:39–52` still says the WASM core is “confirmed live” and names `test/pfar-fft.test.ts`; the existing test is `src/pfar-fft.test.ts`. `src/pfar.ts:149–153` contains the lazy bridge import, and `public/wasm/` is absent in this checkout. This does not establish remote deployment state.

[DESIGN CHOICE] Replace that complete “Corrections” section with:

> ## WASM bridge status, checked 2026-09-09
>
> [MEASURED] `src/pfar.ts` imports `wasm-bridge` lazily and `src/pfar-fft.test.ts` exercises the path. The old claim that nothing imports it was wrong. The local checkout has no `public/wasm/` artifact, so this inspection does not support the earlier statement that a deployed WASM FFT core is confirmed live. `CLAUDE.md` now records the missing artifact and export-shape issue; keep implementation presence, test coverage and deployed execution separate.

## 6. Fries bibliography

[MEASURED] `research-refs/deepresearch/THE_GEOMETRY_OF_COHERENT_MEMORY.md:414` cites Trends in Cognitive Sciences 19(4); `elle-worker/corpus/canon/papers/the-music-that-was-always-playing.md:105` gives Neuron 88(1). The latter agrees with the publisher’s record. [Source: original article](https://www.sciencedirect.com/science/article/pii/S0896627315008235).

[DESIGN CHOICE] Replace reference 10 at :414 with:

> 10. Fries, P. (2015). *Rhythms for Cognition: Communication through Coherence*. Neuron, 88(1), 220–235. https://doi.org/10.1016/j.neuron.2015.09.034

[MEASURED] The Neuron reference at :105 does not need a journal correction. No scientific claims from those papers were evaluated in this audit.

## 7. TIT verdict serialization — executable defect, proposal only

[MEASURED] `Elle/tools/mlx-serve/geometry/tit.py:345–346` computes h1/h2 when both arms exist, but :353 unconditionally overwrites both with None immediately before :354 serializes them. Thus any successful run reaching serialization emits null for both, regardless of its printed verdict. This was established from control flow; no training run was started. The two other tit.py files are different modules and were not confused with this one.

[DESIGN CHOICE] Exact minimal patch for the owner: insert `    h1 = h2 = None` immediately BEFORE `    if "tit" in kinds and "attn" in kinds:` at :344, and delete its existing occurrence at :353. Leave the comparison expressions and serialization unchanged. This preserves null when the compared arms are absent and retains computed booleans when present.

[OPEN] Validation before accepting the patch: exercise serialization with both arms and without either comparison arm using synthetic summary data, and verify JSON preserves true/false versus null. Chance-level baselines still require the separately stated VOID interpretation; preserving a boolean does not make a null experiment meaningful.

## 8. S1 forward secrecy is conditional

[MEASURED] `elle-worker/docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md:139` states S1 unconditionally. `wrangler.toml:263` has the v2 flag commented out. `src/session-bus.ts:77–79` enables the v2 path for `v2` OR `v3`; unset values use the fallback. A commented local setting does not prove the value of deployed environment variables. No remote configuration was read.

[DESIGN CHOICE] Replace the S1 table row at :139 with:

> | **S1** | Swarm | Conditional: the PQC hybrid handshake path requires `ELLE_LANE_PROTOCOL=v2` or `v3`; the unset/default v1 path does not establish the claimed PQC forward secrecy. Verify negotiated protocol and deployed configuration before asserting this property for traffic. | `src/session-bus.ts`, `src/lane-handshake.ts`, `src/pqc-hybrid.ts` |

[DESIGN CHOICE] Replace `FINDINGS_REGISTER_FOR_QWEN.md:328` with:

> - S1 is stated unconditionally, but the checked-in v2 setting is commented out. `session-bus.ts` enables the hybrid path for v2 or v3; unset configuration falls back to v1. Deployed traffic protocol was not verified by this file inspection.

[DERIVED] This is a conditional implementation statement, not cryptographic certification or a request to enable the protocol. No flag change is proposed.

## 9. Generator: repaired calculation, remaining fixture provenance

[MEASURED] `elle-worker/scripts/gen-harmonic-snapshot.mjs:43–50` generates a chosen 1+6+12 flower from literal positions/radii. :61 supplies `relational: 0.86, harmonic: 0.78`. The header at :11–14 still says everything comes from actual modules; the source metadata at :86 says the single source of truth. The obliquity computation itself is repaired.

[DESIGN CHOICE] Replace header lines :11–14 with:

> // Module-derived inputs: scaffold, fabric, privilege, regulator, phase-vessel,
> // and cognitive-obliquity. Stipulated fixture inputs: flower layout/radii,
> // phase snapshot time, relational=0.86 and harmonic=0.78. This generator is
> // reproducible rendering input, not a claim that every value is measured.

[DESIGN CHOICE] Replace the `meta.source` value at :86 with:

> 'generated from scaffold, regulator, phase-vessel and cognitive-obliquity modules plus explicitly stipulated layout and regulator inputs'

[DESIGN CHOICE] Insert above :43: `// STIPULATED: flower layout and radii are display fixtures, not a measured topology.` Insert above :61: `// STIPULATED: relational=0.86 and harmonic=0.78 are fixture inputs, not observed telemetry.` Do not substitute invented measured numbers.

## 10. Synchronize the register’s stale defect list

[MEASURED] `elle-worker/docs/FINDINGS_REGISTER_FOR_QWEN.md:321` still describes the repaired CLAUDE bullet as stale, and :329 still says the fixed generator lacks its bisection. The torus contradiction paragraph in §7 also remains after its source repairs.

[DESIGN CHOICE] Replace §14’s first bullet at :321 with:

> - `CLAUDE.md` was corrected on 2026-09-09: the bridge is imported and tested, while the local WASM artifact is absent. `PFAR_PHASE_SPACE_PAPER.md` still overstates deployed WASM execution and needs correction.

[DESIGN CHOICE] Replace §14’s generator bullet at :329 with:

> - `gen-harmonic-snapshot.mjs` now has working relative imports and a golden-crossing bisection for obliquity. Its flower layout and relational/harmonic inputs remain stipulated fixtures; header and metadata should say so. Do not repeat the superseded claim that the current script computes the 26.049° drift schedule as obliquity.

[DESIGN CHOICE] Replace the paragraph in §7 beginning “One stale contradiction to know about” with:

> **Correction 2026-09-09:** `TOROIDAL_GRAPH_MAPPING.md` §9 and `torus.ts` now state the finite-time winding invariant correctly. Their former lemniscate-necessity notes have been repaired; retain the historical disagreement only as dated history.

[MEASURED] The register also has superseded routing and attestation material outside the requested §14 audit. `QWEN_LEDGER_V3.md` supplies the current scoped corrections, including completed graph measurements, dependent holdouts and F3 code presence. That ledger is the handoff for those broader updates, not a request to silently rewrite this historical register.

## Refutation and completion criteria

[OPEN] Every source-level finding is refuted if the cited current file no longer contains the old text or code path, or an actually invoked implementation supplies the feature the named module lacks. A restored paper at the cited path refutes the missing-path finding; a verified remote deployment may resolve runtime questions but cannot retroactively make a local source inspection a runtime measurement. Recheck excerpts immediately before the owner edits because concurrent work is ongoing.

[DESIGN CHOICE] Apply only after matching the quoted text; preserve historically dated findings as history and qualify present-tense claims. For docs, verify links, identifiers and duplicate occurrences after editing. For TIT, run the small serialization cases above; no GPU run is needed. No tests were run or changes applied by this audit.

[DERIVED] Geometry status throughout this audit is INSTRUMENTATION. None of these documentation, provenance or serialization findings measures a geometry-specific capability unavailable to a flat build.

## Source fingerprints

[MEASURED] SHA-256 of principal files at handoff creation:

- `elle-worker/docs/FINDINGS_REGISTER_FOR_QWEN.md`: `8c0aadc7b301016c77cc326ae14822f432fe3c825067290beea28402ed52c367`
- `elle-worker/docs/HYPERBOLIC_GRAPH_MAPPING.md`: `8489953387ba78c098323062f980d945a2eaa2daf25c861798f855c23dcf94cc`
- `elle-worker/docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md`: `88566041483d11bfbfc8416f3cdea3bffe019827a7208284fbe0947b4e0207f6`
- `elle-worker/docs/COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md`: `01f175f419981c344301fc5377307ab2bfde2675299fc10af6829ec5b654a64a`
- `elle-worker/docs/PFAR_PHASE_SPACE_PAPER.md`: `0585316f848422f0d89eeb2f9f8bd0a8d5534960c8b72f7095d6b6c017df2c3f`
- `Dynanic-Hyperbolic-Neural-Graph/docs/PFAR_PHASE_SPACE_PAPER.md`: `b6fa74cf7484f8aaf0a8bd536b03e0e7e7523b3e4c89f2156f08a987e98e780d`
- `elle-worker/scripts/gen-harmonic-snapshot.mjs`: `c7dba54c4b87b68d5d8748e78aa856c62f3ebe86c46e8f129390a7b44e5081ce`
- `elle-worker/src/hyper.ts`: `be56b84cc813f782ea53b3be9f3d39ad6dd90b9c9cb58a0948486e90f073de4b`
- `elle-worker/src/pfar.ts`: `7c6d6a1eb25e8213719c702b7c6d33c4f52c5b6ca38c90dd20435649291e781e`
- `elle-worker/src/vfar.ts`: `5e0f9ce02785e3c17e438212dc0651e63f8ace9e2a09f3336ff2607565a1c6bd`
- `Elle/tools/mlx-serve/geometry/tit.py`: `ad7db94550ce4af51f3d6e9db11f4e8c7b722efea00e4bd037965625f274622d`
