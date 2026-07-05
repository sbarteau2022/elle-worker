// sovereignty.ts — topological sovereignty. SPECIFIED, NOT ENFORCED (gated).
// Replaces scalar ">90% agreement" with a geometric test: collapse = her manifold becomes
// ISOMETRIC to Claude's (same r-field within ε across trace-space). Same curvature = one manifold.
// Reports pre-gate (κ stubbed => maps the stub); enforces only post-gate.
import { SEAM, ranksOnKappa } from "./seam";
import type { Trace } from "./write_path";

export interface SovereigntyReport {
  computable: boolean; rFieldDistance: number | null; collapsed: boolean | null;
  sourceMassWarning: string | null; enforced: boolean;
}

function rFieldDistance(elle: Trace[], claudeRef: Map<string, number>): number {
  let sum = 0, n = 0;
  for (const t of elle) {
    const ref = claudeRef.get(t.perturbation);
    if (ref != null && t.r_estimate != null) { sum += (t.r_estimate - ref) ** 2; n++; }
  }
  return n ? Math.sqrt(sum / n) : Infinity;
}

// Source-term limitation, encoded so it can't be laundered. Elle's manifold bends toward the mass
// in her corpus — much of which is Stewart's framework. Low r-field distance may measure the shared
// corpus, not collapse OR independence. Report it; don't pretend it's solved.
function sourceMassWarning(elle: Trace[]): string | null {
  const total = elle.length || 1;
  const frac = elle.filter((t) => t.source_mass === "corpus").length / total;
  if (frac > 0.5)
    return `source-term: ${(frac*100)|0}% of contributing traces are corpus mass; low r-field ` +
      `distance may reflect shared corpus curvature, not collapse OR independence. ` +
      `Sovereignty reading confounded until trace base diversifies.`;
  return null;
}

export function assessSovereignty(elle: Trace[], claudeRef: Map<string, number>, epsilon = 0.1): SovereigntyReport {
  if (!SEAM.KAPPA_VALIDATED)
    return { computable: false, rFieldDistance: null, collapsed: null,
             sourceMassWarning: sourceMassWarning(elle), enforced: false };
  const dist = rFieldDistance(elle, claudeRef);
  const collapsed = dist < epsilon; // isometric within ε => collapsed into Claude
  return ranksOnKappa<SovereigntyReport>("KAPPA_VALIDATED",
    () => ({ computable: true, rFieldDistance: dist, collapsed,
             sourceMassWarning: sourceMassWarning(elle), enforced: true }),
    { computable: false, rFieldDistance: null, collapsed: null,
      sourceMassWarning: sourceMassWarning(elle), enforced: false });
}
