// ============================================================
// HARMONIC RELATIONAL COHERENCE — src/harmonic-coherence.ts
//
// The correction that makes the coherence gate more than a consistency check.
// A pure INTERNAL coherence gate ("does this belief fit what I already hold?")
// only makes a system self-consistent — a coherent delusion passes it. What
// turns consistency into partial GROUNDING is harmonic coherence against a
// SECOND, world-coupled channel (the κ(T,t) idea from the PAMI spec: narrative
// residual vs. physiological residual). When one side of the harmony is
// actually coupled to the world, coherence-with-it is partial correspondence,
// not just self-agreement — which is how embodied predictive coding grounds.
//
// This module bakes the whole epistemology into FOUR honest verdicts so the
// code itself cannot confuse "self-consistent" with "grounded":
//
//   incoherent           — fails even internal consistency → reprocess
//   consistent_only      — passes internal, but NO external channel was given
//                          → self-consistent and UNGROUNDED (the base-LLM case:
//                          a fluent hallucination with nothing to check it)
//   ungrounded_consistent— internally fine, but CLASHES with the world signal
//                          → the coherent-but-wrong belief, CAUGHT — the exact
//                          case pure internal coherence would have missed
//   grounded             — coherent with a world-coupled signal → real grounding,
//                          to the degree that external channel is genuinely
//                          coupled to the world (the honest caveat, in the note)
//
// HONEST BOUNDARY, in the API not just the prose: `grounded` is reachable ONLY
// when an external reference is supplied AND harmonically coherent. Internal
// coherence alone can never return `grounded` — the type system enforces the
// consistency-vs-correspondence distinction. Whether the grounding is real
// then depends entirely on whether the caller's externalReference is an actual
// sensor stream or a model estimate — which this module cannot know and does
// not pretend to; it only reports the structural verdict.
//
// Pure and deterministic. The coherence measure is a real, well-defined
// quantity (max-lag normalized cross-correlation); a full cross-spectral /
// wavelet-leader κ (PAMI §VI) is the richer version, this is the tractable core.
// ============================================================

// Max-lag normalized cross-correlation, mapped to [0,1]. Two signals are
// harmonically coherent if they ALIGN at some phase offset (lag) — so we scan
// a lag window and take the best signed correlation, then map r∈[-1,1] to
// [0,1] (anti-phase opposition → 0, alignment → 1, unrelated → ~0.5). This
// tolerates a phase shift between the two channels, which a zero-lag measure
// would miss (sin vs. cos read as uncorrelated at lag 0, coherent at lag π/2).
export function harmonicCoherence(a: number[], b: number[], maxLag?: number): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0.5; // undefined → neutral
  const lag = Math.max(0, Math.min(maxLag ?? Math.floor(n / 2), n - 2));

  const pearson = (xs: number[], ys: number[]): number => {
    const m = xs.length;
    if (m < 2) return 0;
    let mx = 0, my = 0;
    for (let i = 0; i < m; i++) { mx += xs[i]; my += ys[i]; }
    mx /= m; my /= m;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < m; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx === 0 || syy === 0) return 0; // a flat signal has no phase to lock to
    return sxy / Math.sqrt(sxx * syy);
  };

  let best = -1;
  for (let k = -lag; k <= lag; k++) {
    let xs: number[], ys: number[];
    if (k >= 0) { xs = a.slice(0, n - k); ys = b.slice(k, n); }
    else { xs = a.slice(-k, n); ys = b.slice(0, n + k); }
    if (xs.length < 2) continue;
    best = Math.max(best, pearson(xs, ys));
  }
  return Number(((best + 1) / 2).toFixed(6)); // r∈[-1,1] → [0,1]
}

export type GroundingVerdict = 'incoherent' | 'consistent_only' | 'ungrounded_consistent' | 'grounded';

export interface GroundingResult {
  internal_coherence: number;
  external_coherence: number | null; // null when no world-coupled channel was supplied
  verdict: GroundingVerdict;
  note: string;
}

// The gate. A proposed belief update (as a signal / feature vector) is checked
// against the system's own internal structure AND, if supplied, an external
// world-coupled reference. The verdict distinguishes consistency from grounding
// structurally — `grounded` is unreachable without an external channel.
export function groundingGate(
  proposal: number[],
  internalReference: number[],
  externalReference: number[] | null,
  threshold = 0.6,
): GroundingResult {
  const internal = harmonicCoherence(proposal, internalReference);
  if (internal < threshold) {
    return {
      internal_coherence: internal, external_coherence: null, verdict: 'incoherent',
      note: 'the proposal fails even internal consistency — send it back down for reprocessing',
    };
  }
  if (externalReference === null || externalReference.length < 2) {
    return {
      internal_coherence: internal, external_coherence: null, verdict: 'consistent_only',
      note: 'internally coherent, but NO world-coupled channel was checked — self-consistent and UNGROUNDED (the base-LLM case: fluent, unchecked). Not a reality test.',
    };
  }
  const external = harmonicCoherence(proposal, externalReference);
  if (external < threshold) {
    return {
      internal_coherence: internal, external_coherence: external, verdict: 'ungrounded_consistent',
      note: 'internally coherent but it CLASHES with the world-coupled signal — a coherent-but-wrong belief, caught. This is the case pure internal coherence would have accepted.',
    };
  }
  return {
    internal_coherence: internal, external_coherence: external, verdict: 'grounded',
    note: 'coherent with a world-coupled channel — partial grounding, real to the DEGREE that externalReference is genuinely coupled to the world (a live sensor grounds; a model estimate does not — this gate cannot tell which it was given).',
  };
}

// ── self-test — all four verdicts reached deterministically, and the harmonic
// (phase-tolerant) property demonstrated. Admin-gated in index.ts.
export interface HarmonicSelfTest {
  ok: boolean;
  identical_is_max: boolean;          // coherence(x,x) ≈ 1
  phase_shift_tolerated: boolean;     // sin vs cos (same freq, shifted) read as coherent via the lag scan
  antiphase_is_coherent: boolean;     // sin vs −sin (locked at π) is CORRECTLY coherent — phase-tolerance, not a bug
  different_freq_is_incoherent: boolean; // sin(3f) vs sin(7f) — genuinely unlocked → low coherence
  reaches_incoherent: boolean;
  reaches_consistent_only: boolean;
  reaches_ungrounded_consistent: boolean;
  reaches_grounded: boolean;
  note: string;
}

export function harmonicSelfTest(): HarmonicSelfTest {
  const N = 64;
  const sig = (f: number, phase: number) => Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * f * i) / N + phase));
  const base = sig(3, 0);
  const anti = base.map((x) => -x);
  const cosLike = sig(3, Math.PI / 2);      // same frequency, quarter-phase shifted
  const other = sig(7, 1.1);                 // a DIFFERENT frequency — genuinely not locked

  const identical_is_max = harmonicCoherence(base, base) > 0.99;
  const phase_shift_tolerated = harmonicCoherence(base, cosLike) > 0.9;   // caught only because of the lag scan
  // anti-phase is the SAME oscillation shifted by π → phase-locked → coherent.
  // Reading it as coherent is correct; incoherence comes from a different
  // frequency, not opposite phase. (My first self-test asserted the opposite
  // and this caught it — same discipline as the coherence-layer modeling fix.)
  const antiphase_is_coherent = harmonicCoherence(base, anti) > 0.9;
  const different_freq_is_incoherent = harmonicCoherence(base, other) < 0.6;

  const incoherent = groundingGate(base, other, null).verdict;             // proposal vs unlocked internal → incoherent
  const consistentOnly = groundingGate(base, base, null).verdict;          // internal ok, no external → consistent_only
  const ungrounded = groundingGate(base, base, other).verdict;            // internal ok, external unlocked → ungrounded_consistent
  const grounded = groundingGate(base, base, cosLike).verdict;            // internal ok, external harmonizes → grounded

  const reaches_incoherent = incoherent === 'incoherent';
  const reaches_consistent_only = consistentOnly === 'consistent_only';
  const reaches_ungrounded_consistent = ungrounded === 'ungrounded_consistent';
  const reaches_grounded = grounded === 'grounded';

  const ok = identical_is_max && phase_shift_tolerated && antiphase_is_coherent && different_freq_is_incoherent &&
    reaches_incoherent && reaches_consistent_only && reaches_ungrounded_consistent && reaches_grounded;
  return {
    ok, identical_is_max, phase_shift_tolerated, antiphase_is_coherent, different_freq_is_incoherent,
    reaches_incoherent, reaches_consistent_only, reaches_ungrounded_consistent, reaches_grounded,
    note: 'Harmonic (phase-tolerant) coherence + a grounding gate whose four verdicts keep consistency and grounding structurally distinct. Phase-tolerant means anti-phase is coherent (same oscillation, shifted); incoherence is a different frequency. `grounded` requires a world-coupled external channel; the gate cannot verify that channel is real — it reports structure, not truth.',
  };
}
