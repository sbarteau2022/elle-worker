# flow_emit.py — Linux/pure-numpy optical-flow extractor for the seam ladder.
#
# WHY THIS EXISTS
#   vision_emit.swift emits the `flow_mag` channel via Apple Vision and only
#   runs on macOS. rung 2 of the seam ladder ("real footage, one channel —
#   does the signal have a seam at all?") needs that channel on whatever box
#   the analysis runs on. This is a faithful substitute for the `flow_mag`
#   column: mean dense-optical-flow magnitude per frame — the SAME physical
#   quantity, not an invented projection. It preserves vision_emit's CSV
#   contract so rip.py / phase_eight.py consume it unchanged.
#
#   flow_mag(t) = mean over pixels of the optical-flow magnitude between
#   frame t-1 and frame t. Two estimators:
#     - cv2.calcOpticalFlowFarneback if OpenCV is present (production path);
#     - otherwise a transparent pure-numpy NORMAL-FLOW magnitude
#       |I_t| / |grad I| (the optical-flow constraint), so this runs with only
#       numpy. Both are documented; neither is tuned to any downstream verdict.
#
# USAGE
#   Real footage:  python3 flow_emit.py --video clip.mp4 --out flow.csv
#                  (needs imageio + imageio-ffmpeg to decode; pip install both)
#                  then: python3 rip.py --csv flow.csv --col flow_mag --fps <fps>
#   Validate:      python3 flow_emit.py --selftest
#
# HONESTY NOTE (see SESSION_AUDIT_2026-08-01.md): --selftest validates the
# EXTRACTOR on synthetic frames with known motion. It is NOT a real-footage
# result and does not clear rung 2. A synthetic PASS proves the pipeline can
# detect a motion seam when one is planted; it says nothing about whether real
# footage contains one.
import sys, csv as csvmod
import numpy as np


def flow_mag_numpy(prev_gray, gray):
    """Mean normal-flow magnitude between two grayscale frames (pure numpy).
    Normal flow = |I_t| / |grad I| from the optical-flow constraint. Only
    pixels with real spatial structure (|grad I| above a small floor) vote,
    so flat regions don't inject divide-by-noise."""
    Ix = 0.5 * (np.roll(prev_gray, -1, axis=1) - np.roll(prev_gray, 1, axis=1))
    Iy = 0.5 * (np.roll(prev_gray, -1, axis=0) - np.roll(prev_gray, 1, axis=0))
    It = gray - prev_gray
    grad = np.sqrt(Ix * Ix + Iy * Iy)
    floor = max(1e-6, 0.05 * float(grad.max()))
    m = grad > floor
    if not np.any(m):
        return 0.0
    return float(np.mean(np.abs(It[m]) / grad[m]))


def flow_mag_cv2(prev_gray, gray):
    import cv2
    f = cv2.calcOpticalFlowFarneback(
        prev_gray.astype(np.float32), gray.astype(np.float32),
        None, 0.5, 3, 15, 3, 5, 1.2, 0)
    return float(np.mean(np.sqrt(f[..., 0] ** 2 + f[..., 1] ** 2)))


def extract(frames, use_cv2=False):
    """frames: iterable of 2D grayscale float arrays. Returns flow_mag list
    (len = n_frames-1)."""
    fn = flow_mag_cv2 if use_cv2 else flow_mag_numpy
    out, prev = [], None
    for g in frames:
        if prev is not None:
            out.append(fn(prev, g))
        prev = g
    return out


def read_video_gray(path):
    import imageio.v3 as iio
    for frame in iio.imiter(path):
        f = np.asarray(frame, dtype=np.float64)
        if f.ndim == 3:
            f = f[..., :3].mean(axis=2)
        yield f


def synth_motion_frames(fps=100.0, dur=30.0, H=48, W=64, period_px=16.0):
    """Render a drifting vertical grating whose horizontal velocity carries a
    planted bimodal MOTION seam: vx(t) = C + slow + (1+0.9*slow)*fast, with a
    DC offset C so velocity stays positive (no abs-folding of the bands). For a
    translating grating the normal-flow magnitude tracks |vx|, so flow_mag(t)
    inherits the same slow/(fast-envelope) coupling rip.py is built to detect."""
    n = int(fps * dur)
    t = np.arange(n) / fps
    slow = np.sin(2 * np.pi * 1.0 * t)
    fast = np.sin(2 * np.pi * 12.0 * t)
    vx = 3.0 + slow + (1.0 + 0.9 * slow) * fast          # pixels/frame-ish drive
    disp = np.cumsum(vx) / fps                            # cumulative phase shift
    xs = np.arange(W)[None, :]
    k = 2 * np.pi / period_px
    for i in range(n):
        row = np.sin(k * (xs - disp[i] * 4.0))            # 4 px/unit spatial gain
        yield np.repeat(row, H, axis=0).reshape(H, W)
    return


def _cli():
    args = sys.argv
    use_cv2 = "--cv2" in args
    if "--selftest" in args:
        fps = 100.0
        frames = list(synth_motion_frames(fps=fps))
        mag = extract(frames, use_cv2=use_cv2)
        arr = np.array(mag)
        out = args[args.index("--out") + 1] if "--out" in args else "flow_selftest.csv"
        with open(out, "w", newline="") as f:
            w = csvmod.writer(f); w.writerow(["frame", "flow_mag"])
            for i, v in enumerate(mag):
                w.writerow([i, f"{v:.6f}"])
        print(f"SELFTEST: rendered {len(frames)} synthetic frames @ {fps} fps")
        print(f"  estimator: {'cv2 Farneback' if use_cv2 else 'pure-numpy normal flow'}")
        print(f"  flow_mag  n={len(arr)} mean={arr.mean():.4f} std={arr.std():.4f}")
        print(f"  wrote {out}  ->  validate seam with: python3 rip.py --csv {out} --col flow_mag --fps {fps}")
        return
    if "--video" in args:
        path = args[args.index("--video") + 1]
        fps = float(args[args.index("--fps") + 1]) if "--fps" in args else 30.0
        out = args[args.index("--out") + 1] if "--out" in args else "flow.csv"
        mag = extract(read_video_gray(path), use_cv2=use_cv2)
        with open(out, "w", newline="") as f:
            w = csvmod.writer(f); w.writerow(["frame", "flow_mag"])
            for i, v in enumerate(mag):
                w.writerow([i, f"{v:.6f}"])
        print(f"wrote {out}  n={len(mag)}  (source {path})")
        print(f"NYQUIST NOTE: rip.py's fast band is 8-20 Hz. At fps={fps} the "
              f"representable ceiling is {fps/2:.1f} Hz. If fps<=40 the fast band "
              f"is near/above Nyquist and a NULL may be instrumental, not physical "
              f"— do NOT retune the band to force a PASS.")
        return
    print(__doc__)


if __name__ == "__main__":
    _cli()
