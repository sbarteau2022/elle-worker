// seam.ts — THE load-bearing file. One flag controls whether κ is form-complete
// (staged) or load-bearing (live). While KAPPA_VALIDATED is false: traces are written,
// κ/r rank on NOTHING, retrieval falls back to relevance+recency, all validated layers inert.
// Flip to true ONLY after validate_kappa returns BUILD.

export const SEAM = {
  KAPPA_VALIDATED: false,        // master. validate_kappa BUILD is the ONLY thing that sets this.
  VELOCITY_BOUNDARY: false,      // validate_memory kill-test 1: AUC >= 0.70
  RESERVE_CONSOLIDATION: false,  // validate_memory kill-test 2: AUC >= 0.65
} as const;

// Guard: run the κ-dependent path only when validated; else return the stub.
// Grep `ranksOnKappa` to audit the whole seam.
export function ranksOnKappa<T>(gate: keyof typeof SEAM, live: () => T, stub: T): T {
  return SEAM[gate] ? live() : stub;
}

export const KAPPA_PROVISIONAL = !SEAM.KAPPA_VALIDATED;
