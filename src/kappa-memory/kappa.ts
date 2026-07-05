// kappa.ts — contraction operator (real) + κ(T,t) (stubbed behind seam).
// u̇ = −r·u is known and implemented. κ(T,t) validated form is NOT dropped in here;
// validatedKappa() throws pre-gate so nothing can quietly depend on an unvalidated κ.
import { SEAM } from "./seam";

export function estimateR(traj: number[]): number {
  const u = traj.map((x) => Math.max(x, 1e-9));
  const n = u.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let t = 0; t < n; t++) { const y = Math.log(u[t]); sx += t; sy += y; sxx += t*t; sxy += t*y; }
  const slope = (n*sxy - sx*sy) / (n*sxx - sx*sx);
  return -slope; // r  (ln(u) = ln(u0) − r·t)
}

export function reserveOf(traj: number[]): number {
  let s = 0; for (let i = 1; i < traj.length; i++) s += (traj[i] + traj[i-1]) / 2; return s;
}

export function velocityPeak(traj: number[]): number {
  let m = 0; for (let i = 1; i < traj.length; i++) m = Math.max(m, Math.abs(traj[i]-traj[i-1])); return m;
}

export function kappaTrajectory(samples: number[]): number[] { return samples; }

export function kappaOf(_T: unknown, _t: number): number {
  return SEAM.KAPPA_VALIDATED ? validatedKappa(_T, _t) : 0; // stub: explicit zero, visibly inert
}

function validatedKappa(_T: unknown, _t: number): number {
  throw new Error("validatedKappa called before validate_kappa cleared — seam violation");
}
