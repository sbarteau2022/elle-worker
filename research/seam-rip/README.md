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
- `vision_emit.swift` — Apple Vision -> CSV (head pose + optical flow). Scaffold;
  compile/adjust on macOS. The CSV contract is the fixed part.

## Run
```
python3 rip.py                              # self-test (PASS #1, NULL #2/#3)
swiftc -O vision_emit.swift -o vision_emit  # on macOS
./vision_emit clip.mov > vision.csv
python3 rip.py --csv vision.csv --col flow_mag --fps 30
```

## The ladder (each rung gated by the one below returning signal)
1. seam harness — **DONE**, validated, returns null correctly.
2. real footage, one channel — does the signal have a seam at all?
3. cross-mode v2 — head-pose <-> flow-envelope.
4. lightweight Poincare embedding — is the structure hyperbolic-shaped? (cheap, 8GB M1)
5. dynamic hyperbolic / toroidal net — only after 2-4 return signal; let the
   **data** pick the geometry, not a model's stated preference.

Nothing advances a rung until the rung below comes back with signal.
