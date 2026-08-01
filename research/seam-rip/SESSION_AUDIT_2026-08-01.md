# Session audit — 2026-08-01

Record of what was built and what the data showed, regardless of where the
conclusion fell. Same discipline as the 2026-07-13 audit.

## Goal for the session
Advance the seam ladder to **rung 2** — "real footage, one channel: does the
signal have a seam at all?" — using real news clips pulled from the internet.

## What actually happened, stated plainly

**Real footage could not be obtained in this environment.** Outbound HTTPS is
governed by an egress policy that denied every external video host tried —
`download.blender.org`, `upload.wikimedia.org`, and `archive.org` all returned
proxy `403` (recorded server-side as policy denials). The agent-proxy README is
explicit that these are organization-policy denials to be reported, not routed
around. Only package registries (pypi, npm) are directly reachable. So no real
clip entered the pipeline this session, and **rung 2 is NOT cleared.** Nothing
advances a rung until the rung below returns real signal; a synthetic stand-in
does not count and was not allowed to.

Rather than fabricate a "real data" result — which is precisely the failure the
companion methodology write-up (`docs/HARNESS_REFLECTION_METHODOLOGY.md`)
dissects — the session advanced the *instrument* so rung 2 is executable the
moment a clip is available, and left this record.

## Built this session, under research/seam-rip/

- **`flow_emit.py`** — a Linux/pure-numpy port of the `flow_mag` channel that
  `vision_emit.swift` only produces on macOS. It computes mean dense-optical-flow
  magnitude per frame — the *same physical quantity*, not an invented
  projection — and preserves the CSV contract, so `rip.py`/`phase_eight.py`
  consume it unchanged. Pure-numpy normal-flow estimator by default; optional
  `cv2` Farneback path for production. Reads real video via `imageio` (needs
  `imageio-ffmpeg`); validated here on synthetic frames.

## Data recorded — extractor + pipeline validation (SYNTHETIC, labeled)

Rendered drifting-grating frames at 100 fps with a planted **motion** seam
(slow drift modulating fast-drift amplitude), ran `flow_emit.py` → `rip.py`
end-to-end. The point was to prove the ported frames→flow→rip path is a valid,
**null-capable** instrument — not to claim anything about real footage.

```
COUPLED motion (seam present):   kappa=0.9968  p=0.0010  -> PASS
UNCOUPLED motion (no seam):      kappa=0.2741  p=0.2627  -> NULL
```

It PASSes when a seam is planted in the motion and returns NULL when it isn't.
The instrument can decline. That is the only property this validates.

## Finding worth pre-registering before any real run

**`rip.py`'s fast band (8–20 Hz) assumes a high sample rate.** Broadcast
footage is 25–30 fps, whose Nyquist ceiling is 12.5–15 Hz — so the specified
fast band sits near or above Nyquist and is only partly representable. Real
macro head/scene motion carries little genuine 8–20 Hz energy anyway; at
broadcast fps that band mostly captures sub-Nyquist flicker/compression noise.

Consequence: a real-footage **NULL may be instrumental (band vs. fps), not a
statement about the footage.** The correct response is to note it, not to
retune the band to force a PASS — retuning the instrument until it separates
candidates is the exact artifact the methodology write-up condemns. Options
that stay honest: source higher-fps footage, or move to the audio channel
(kHz sample rate, the fast band trivially representable) as the README already
anticipates ("audio later").

## Discipline carried (unchanged)
- **Durable != live. Coherence != truth. Every measure must be able to return
  null.** The ported pipeline was accepted only after it returned null on
  uncoupled motion.
- **Let reality break the symmetry, not the mirror.** No real footage was
  reachable, so no rung-2 claim is made. Recorded as data, not as a verdict.

## To clear rung 2 (unblock path)
1. Provide a real clip in-repo, or enable egress for one licensed video host,
   or run `vision_emit.swift`/`flow_emit.py --video` on a machine with footage.
2. `python3 flow_emit.py --video clip.mp4 --fps <fps> --out flow.csv`
3. `python3 rip.py --csv flow.csv --col flow_mag --fps <fps>`  → honest PASS/NULL,
   read with the Nyquist note above in mind.
