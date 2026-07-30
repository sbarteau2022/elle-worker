// validate.ts — the pre-registered κ validation apparatus (docs/MEMORY_KERNEL_SPEC.md §10).
//
// The seam (seam.ts) has always named a "validate_kappa run returning BUILD" as
// the ONE thing allowed to flip a gate — but that run never existed. This is it:
// a deterministic, pure eval that scores the κ-trajectory-derived candidate
// signals already stored on every bending_trace against an INDEPENDENT label and
// reports KILL / BUILD / INSUFFICIENT against thresholds PRE-REGISTERED here
// (committed before the data, not chosen after seeing it — §10 Gate 1/2). AUC is
// the ROC area via the Mann–Whitney U statistic (exact, tie-aware).
//
// WHAT THIS IS NOT — three honesties the spec demands, encoded so they can't be
// laundered:
//
//   1. It does NOT write SEAM.KAPPA_VALIDATED (or any gate). Invariant Q3 (§6.2)
//      says a gate is flipped by exactly one thing — a human committing the
//      one-line seam edit after a BUILD — never by code "to unblock testing."
//      This runner RECOMMENDS and prints the exact edit; the flip stays a manual
//      commit. `seam_written` is therefore always false, by construction.
//
//   2. Its label (`settled_open`, a lexical readout of the response tail from
//      write_path.extractSettling) is an INTERNAL proxy — a different channel
//      from the κ-series-derived predictors (velocity_peak, reserve), so the
//      test is not circular, but it is a LOWER BAR than the blind human-rater
//      Gate 2 the spec ultimately requires (§10 Gate 2). A BUILD here is
//      necessary, not sufficient: it clears the internal proxy and escalates to
//      a human-rater Gate 2. A KILL here is decisive — a signal that can't beat
//      the internal proxy is dead regardless of Gate 2.
//
//   3. The master gate (KAPPA_VALIDATED) rides a base κ(T,t) DEFINITION that
//      does not exist yet: validatedKappa() still throws (Gate 0, §10). So this
//      runner cannot BUILD the master gate — it reports it blocked upstream. It
//      can only run the two kill-tests, whose predictors (velocity_peak,
//      reserve) ARE computed and stored today.

// ── Pre-registered gate — committed BEFORE looking at any accumulated data ────
export const GATE = {
  // Gate 1 (§10) — minimum sample size for the AUC to mean anything. Total
  // labeled traces AND a floor per class, because an AUC over 3 positives is noise.
  MIN_N: 100,
  MIN_PER_CLASS: 20,
  // kill-test thresholds — verbatim from seam.ts / §10 "the seam flip".
  VELOCITY_BOUNDARY_AUC: 0.70,
  RESERVE_CONSOLIDATION_AUC: 0.65,
} as const;

// The minimal row shape the eval needs — a projection of bending_trace.
export interface TraceRow {
  settled_open: number | null;   // 0 | 1 — the independent (lexical) label
  reserve: number | null;        // ∫κ dt over the settling window
  velocity_peak: number | null;  // max |dκ/dt| over the settling window
}

// ── ROC-AUC via Mann–Whitney U (tie-aware, exact) ────────────────────────────
// AUC = P(score(pos) > score(neg)) + ½·P(tie). Computed from midranks so ties
// contribute exactly ½ — the textbook rank-sum identity, no sampling. Returns
// 0.5 for any degenerate input (a missing class), which is the honest "no
// signal" value rather than a throw.
export function rocAuc(scores: number[], labels: number[]): number {
  const n = Math.min(scores.length, labels.length);
  const pairs: { s: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(scores[i]) && (labels[i] === 0 || labels[i] === 1))
      pairs.push({ s: scores[i], y: labels[i] });
  }
  const nPos = pairs.filter((p) => p.y === 1).length;
  const nNeg = pairs.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;

  // Midranks: sort by score, assign each tie-group the average of its ranks.
  pairs.sort((a, b) => a.s - b.s);
  const ranks = new Array(pairs.length);
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].s === pairs[i].s) j++;
    const midrank = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) ranks[k] = midrank;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let k = 0; k < pairs.length; k++) if (pairs[k].y === 1) rankSumPos += ranks[k];
  const u = rankSumPos - (nPos * (nPos + 1)) / 2; // Mann–Whitney U for positives
  return u / (nPos * nNeg);
}

// Hanley–McNeil standard error of the AUC — the conservative closed form using
// only n and the AUC itself (no per-class variance estimate). Enough to put a
// normal-approx lower bound on the AUC and refuse a "pass" whose CI still
// straddles 0.5.
export function aucStdError(auc: number, nPos: number, nNeg: number): number {
  if (nPos <= 0 || nNeg <= 0) return NaN;
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const num = auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc);
  return Math.sqrt(Math.max(0, num) / (nPos * nNeg));
}

export type KillVerdict = 'BUILD' | 'KILL' | 'INSUFFICIENT';

export interface KillTestResult {
  gate: 'VELOCITY_BOUNDARY' | 'RESERVE_CONSOLIDATION';
  predictor: string;
  positive_class: string;
  threshold: number;
  auc: number;
  auc_lower95: number;
  n_pos: number;
  n_neg: number;
  verdict: KillVerdict;
  reason: string;
  seam_edit_if_build: string;
}

function runKillTest(
  gate: KillTestResult['gate'],
  predictor: string,
  positiveClass: string,
  threshold: number,
  scores: number[],
  labels: number[],
): KillTestResult {
  const nPos = labels.filter((y) => y === 1).length;
  const nNeg = labels.filter((y) => y === 0).length;
  const seamKey = gate; // the seam.ts flag name is identical
  const seam_edit_if_build = `set ${seamKey}: true in src/kappa-memory/seam.ts (manual commit — never by the runner)`;
  const base = { gate, predictor, positive_class: positiveClass, threshold, seam_edit_if_build };

  if (nPos + nNeg < GATE.MIN_N || nPos < GATE.MIN_PER_CLASS || nNeg < GATE.MIN_PER_CLASS) {
    return {
      ...base, auc: 0.5, auc_lower95: 0.5, n_pos: nPos, n_neg: nNeg, verdict: 'INSUFFICIENT',
      reason: `Gate 1 not met: need ≥${GATE.MIN_N} labeled traces with ≥${GATE.MIN_PER_CLASS} per class; have ${nPos + nNeg} (${nPos} pos / ${nNeg} neg). No verdict — accumulate data first.`,
    };
  }
  const auc = rocAuc(scores, labels);
  const se = aucStdError(auc, nPos, nNeg);
  const lower = Number.isFinite(se) ? auc - 1.96 * se : auc;
  let verdict: KillVerdict;
  let reason: string;
  if (auc >= threshold && lower > 0.5) {
    verdict = 'BUILD';
    reason = `AUC ${auc.toFixed(3)} ≥ ${threshold} and the 95% lower bound ${lower.toFixed(3)} clears chance. Clears the INTERNAL proxy — necessary, not sufficient; escalate to a blind human-rater Gate 2 before the manual seam flip.`;
  } else {
    verdict = 'KILL';
    reason = auc < threshold
      ? `AUC ${auc.toFixed(3)} < ${threshold}. The signal does not discriminate the label at the pre-registered bar. Decisive: keep the gate closed.`
      : `AUC ${auc.toFixed(3)} clears the point estimate but its 95% lower bound ${lower.toFixed(3)} still straddles chance — not separable from 0.5 at this n. Keep the gate closed.`;
  }
  return { ...base, auc: round(auc), auc_lower95: round(lower), n_pos: nPos, n_neg: nNeg, verdict, reason };
}

function round(x: number, d = 4): number { const p = 10 ** d; return Math.round(x * p) / p; }

export interface ValidateKappaReport {
  ran_at: number;
  n_total: number;
  n_labeled: number;
  // The master gate can't be validated here — its base κ(T,t) definition is unbuilt.
  master_gate: { flag: 'KAPPA_VALIDATED'; validatable: false; blocked_by: string };
  kill_tests: KillTestResult[];
  overall: KillVerdict;
  seam_written: false;
  independence_caveat: string;
  next_action: string;
}

// The pure entry point: takes the projected rows, returns the full report.
// Deterministic — same rows in, byte-identical report out (modulo ran_at, which
// the caller supplies for testability).
export function runValidateKappa(rows: TraceRow[], ranAt = Date.now()): ValidateKappaReport {
  const labeled = rows.filter((r) => (r.settled_open === 0 || r.settled_open === 1));

  // VELOCITY_BOUNDARY: velocity_peak (max |Δκ|) predicts a turn that stays OPEN.
  // A bigger swing marks a bend that didn't close — the event-boundary reading.
  const vel = labeled.filter((r) => Number.isFinite(r.velocity_peak as number));
  const velScores = vel.map((r) => r.velocity_peak as number);
  const velLabels = vel.map((r) => (r.settled_open === 1 ? 1 : 0)); // positive = OPEN

  // RESERVE_CONSOLIDATION: reserve (∫κ) predicts a turn that SETTLED — a resolved
  // close accumulated more coherence mass than an open, still-oscillating one.
  const res = labeled.filter((r) => Number.isFinite(r.reserve as number));
  const resScores = res.map((r) => r.reserve as number);
  const resLabels = res.map((r) => (r.settled_open === 0 ? 1 : 0)); // positive = SETTLED

  const velTest = runKillTest('VELOCITY_BOUNDARY', 'velocity_peak', 'settled_open = 1 (OPEN)',
    GATE.VELOCITY_BOUNDARY_AUC, velScores, velLabels);
  const resTest = runKillTest('RESERVE_CONSOLIDATION', 'reserve', 'settled_open = 0 (SETTLED)',
    GATE.RESERVE_CONSOLIDATION_AUC, resScores, resLabels);
  const kill_tests = [velTest, resTest];

  // Overall: BUILD only if a test BUILT; else KILL if any real KILL; else INSUFFICIENT.
  const verdicts = kill_tests.map((t) => t.verdict);
  const overall: KillVerdict = verdicts.includes('BUILD')
    ? 'BUILD'
    : verdicts.includes('KILL') ? 'KILL' : 'INSUFFICIENT';

  const next_action = overall === 'INSUFFICIENT'
    ? 'Accumulate bending_trace rows (real chat volume) until Gate 1 is met, then re-run. Nothing to decide yet.'
    : overall === 'KILL'
      ? 'At least one kill-test failed at the pre-registered bar. Keep every gate closed — this is working as intended, not a bug.'
      : 'A kill-test cleared the INTERNAL proxy. Do NOT flip the seam on this alone: stand up a blind multi-rater human coherence label (Gate 2), re-run against it, and only then make the one-line manual seam edit.';

  return {
    ran_at: ranAt,
    n_total: rows.length,
    n_labeled: labeled.length,
    master_gate: {
      flag: 'KAPPA_VALIDATED',
      validatable: false,
      blocked_by: 'Gate 0 (§10) — no κ(T,t) definition is committed; validatedKappa() throws. The master gate cannot be validated until a definition exists to score.',
    },
    kill_tests,
    overall,
    seam_written: false,
    independence_caveat:
      'Label is settled_open — a lexical readout of the response tail (write_path.extractSettling), independent of the κ-series-derived predictors but still an INTERNAL proxy. A BUILD clears this bar only; the human-rater Gate 2 (§10) is the real one.',
    next_action,
  };
}
