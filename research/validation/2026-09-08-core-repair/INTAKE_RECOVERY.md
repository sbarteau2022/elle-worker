# Intake and recovery integration — 2026-09-09

Implemented a service-authenticated `/api/atlas/anchors/intake` route and authenticated read-only `/api/atlas/anchors/map` route. Intake validates finite measured samples and an optional same-length prediction. It computes residuals, calls the shipped PFAR spectrum and PAMI wavelet/index routines, stores PAMI references, and uses the existing PAMI bridge plus `placeFeatures` for H128 coordinates. Four paired phase coordinates are also embedded onto ring tori with R=1 and r=1/phi. These surface coordinates do not certify a geodesic distance or a learned semantic organization.

Publication is gated by the existing anchor evidence policy. The accepted event and its full observation/content/map row are committed in one database batch. A rejected observation remains auditable without replacing the accepted map node. Injected storage failure rolls back the event and map update together (the earlier PAMI index can remain as an unreferenced observation).

Recovery resolves exact PAMI references. When an intake source record exists, the complete content is returned instead of PAMI's 4,000-character preview. Legacy previews are marked incomplete. Unknown references remain explicit; similarity alone is never promoted to factual support.

Revision assessment now incorporates rejected same-claim counterevidence, preventing resubmission from laundering it away. Atomic publication checks both accepted version and the count of observed events; a concurrent evidence change prevents promotion even if the accepted version did not change.

Validation uses the actual numerical modules and SQLite-backed D1 adapter. It covers residual arithmetic, dimensions/domain, gated map updates, exact recovery beyond 4,000 characters, unresolved references, rejected observations, and rollback after injected persistence failure. See intake-recovery-tests.json for exact test outcomes. Tests use synthetic signals and attributed fixture observations; they establish implementation behavior, not cognition or pretrained-model accuracy.

Still outstanding for the full objective:
- Rust harness transport into this worker intake path and end-to-end task execution.
- Real Qwen prediction/residual production with validated language baseline; no knowledge-in-weights eviction decision is implemented here.
- Linking measured evidence/surprise to StrataKV retention rather than position-default priorities.
- Full calibrated κ recovery/revision loop, including required blind-rater gates.
- Rerun of mathematical instruments against the complete corrected implementation and controlled system comparisons for the book.

No remote deployment, server restart, model training or benchmark run was performed in this integration step.
