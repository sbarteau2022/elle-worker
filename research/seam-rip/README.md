# seam-rip — bimodal manifold-edge research sandbox

**SANDBOX. Not wired to Elle.** Nothing here runs in production; nothing imports
it; nothing gates a decision on it. This is the research corner for the seam /
bimodal-rip experiment.

## What this is
Extract a signal from a stream (video via Apple Vision; audio later), split it
into two modes (slow/structural + fast/dynamic), and test whether there is a
genuine cross-mode **seam** — coupling between the slow-mode phase and the
fast-mode amplitude — that survives a pre-registered null.

## The one rule
Every run must be able to come back **NULL**. `rip.py` is validated to PASS on a
genuinely coupled signal and to return NULL on pure noise AND on a real-but-
uncoupled signal. An instrument that cannot return null is a kaleidoscope.

## Validated self-test (2026-07-13)
```
coupled (real seam)   kappa=0.9775  p=0.0030  -> PASS
pure noise            kappa=0.0540  p=0.3397  -> NULL
uncoupled tones       kappa=0.0385  p=0.2697  -> NULL
```

## Files
- `rip.py` — the validated seam detector + circular-shift permutation null.
- `phase_eight.py` — does a figure-eight phase portrait (2:1 slow/fast
  phase-locking, PLV per Tass et al. 1998) emerge in the data, or would one
  be drawn regardless? Same discipline as `rip.py`: a circular-shift null
  the lock must survive, self-test pre-registered at p<0.01.
- `vision_emit.swift` — Apple Vision -> CSV (head pose + optical flow). Scaffold;
  compile/adjust on macOS. The CSV contract is the fixed part.
- `flow_emit.py` — Linux/pure-numpy port of the `flow_mag` channel (same
  physical quantity — mean dense-optical-flow magnitude per frame — same CSV
  contract). Runs where `vision_emit.swift` can't. Optional `cv2` Farneback
  path; reads real video via `imageio`. `--selftest` validates the extractor
  on synthetic frames.
- `SESSION_AUDIT_2026-07-13.md` / `SESSION_AUDIT_2026-08-01.md` — dated records
  of what was built and what the data showed, kept as-is (historical).

## Run
```
python3 rip.py                              # self-test (PASS #1, NULL #2/#3)
swiftc -O vision_emit.swift -o vision_emit  # on macOS
./vision_emit clip.mov > vision.csv
python3 rip.py --csv vision.csv --col flow_mag --fps 30
python3 phase_eight.py                              # self-test (locked/drift/noise)
python3 phase_eight.py --csv vision.csv --slow yaw --fast flow_mag --fps 30
```

## The ladder (each rung gated by the one below returning signal)
1. seam harness — **DONE**, validated, returns null correctly.
2. real footage, one channel — does the signal have a seam at all? **NOT
   CLEARED.** Extractor is ported and runnable on any platform (`flow_emit.py`)
   and the frames→flow→rip path is validated null-capable on synthetic motion
   (PASS on a planted seam, NULL on uncoupled motion) — but **no real footage
   has been run**: this environment's egress policy blocks external video hosts
   (see `SESSION_AUDIT_2026-08-01.md`). Provide a clip to clear it. Pre-flight
   caveat: `rip.py`'s fast band (8–20 Hz) is near/above Nyquist at broadcast
   fps (25–30) — a NULL there may be instrumental; source higher fps or use the
   audio channel, do **not** retune the band.
3. cross-mode v2 — head-pose <-> flow-envelope.
4. lightweight Poincare embedding — is the structure hyperbolic-shaped? (cheap, 8GB M1)
5. dynamic hyperbolic / toroidal net — only after 2-4 return signal; let the
   **data** pick the geometry, not a model's stated preference.

Nothing advances a rung until the rung below comes back with signal.
