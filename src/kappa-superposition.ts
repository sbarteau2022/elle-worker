// ── κ held in superposition, watched over the phase state ────────────────────
//
// `computeKappaMultimodal` collapses lexical, acoustic and visual κ into one
// scalar per turn. That collapse is the mistake: it throws away the only thing
// that distinguishes a claim genuinely supported across channels from one
// merely DELIVERED well. Averaged, a confident, steady, well-lit falsehood
// reads 0.915 — the top of the table — because every channel independently
// attests presence, and presence is not correspondence.
//
// Hold them instead. Each channel keeps its own leaky drift ledger, exactly the
// construction in SUPERPOSITION_HOLDING.md:
//
//     D_k = (1 − ρ)·D_(k−1) + |v_k|        v_k = κ_k − κ_(k−1)
//     L_k = exp(ρ·D_k) − 1                 bounded by e − 1
//
// and a further ledger accumulates their DISAGREEMENT — the spread across
// channels at each turn, leaked on the same clock:
//
//     A_k = (1 − ρ)·A_(k−1) + spread_k     spread_k = max κ^(c) − min κ^(c)
//     L^align_k = exp(ρ·A_k) − 1
//
// The bound carries: spread ∈ [0,1] for κ ∈ [0,1], so Proposition 1 applies
// unchanged and L^align < e − 1 for all time regardless of history.
//
// What this buys that a per-turn number cannot: alignment is a property of the
// TRAJECTORY. Any speaker can align three channels for one turn. Holding them
// aligned while the content moves is a different problem, and a moment of
// divergence stays on the books for ~34 turns at ρ = 0.02 rather than being
// averaged away the instant it happens.
//
// This module deliberately returns NO single scalar. The components and the two
// losses are the reading; whoever consumes it decides what to do with them.

import { RHO_DEFAULT } from './kappa-multimodal';

export type ChannelName = 'lexical' | 'acoustic' | 'visual' | 'agreement';

export interface ChannelHold {
  kappa: number | null;   // this turn's value, null when the channel is absent
  drift: number;          // D_k — leaky ledger of |Δκ|
  loss: number;           // exp(ρ·D_k) − 1
}

export interface SuperpositionState {
  turn: number;
  channels: Record<ChannelName, ChannelHold>;
  /** Spread over the COSTLY channels this turn: max κ − min κ. Excludes lexical. */
  spread: number;
  /** Leaky ledger of spread, and its bounded loss. THE alignment reading. */
  disagreement: number;
  alignment_loss: number;
  /** How many channels were actually present this turn. */
  present: number;
  rho: number;
  half_life_turns: number;
  /**
   * Held / diverging / quiescent — over the trajectory, never off one turn.
   * `diverging` means the channels have been disagreeing for long enough that
   * the leaky ledger noticed; a single divergent turn does not trip it.
   */
  status: 'quiescent' | 'holding' | 'diverging';
}

// Sustained cross-channel spread of ~0.22/turn, matching STRAINED_LOSS in
// Elle's holding.ts so the two instruments read on the same scale.
const DIVERGING_LOSS = 0.25;
// Below this the superposition is not carrying enough to judge.
const QUIESCENT_PRESENT = 1;

export interface SuperpositionInput {
  lexical?: number | null;
  acoustic?: number | null;
  visual?: number | null;
  /**
   * Content agreement — does recalled evidence actually support the claim.
   * The channel that would make κ track correspondence rather than delivery.
   * Not yet produced anywhere; accepted here so the superposition has a slot
   * for it instead of needing reshaping later.
   */
  agreement?: number | null;
}

const CHANNELS: ChannelName[] = ['lexical', 'acoustic', 'visual', 'agreement'];
/** Channels a speaker cannot simply choose to emit. Only these set the spread. */
const COSTLY_CHANNELS: ChannelName[] = ['acoustic', 'visual', 'agreement'];

/**
 * A holding valve over the channel superposition.
 *
 * Mirrors `createHoldingValve` in Elle's src/lib/holding.ts — same ρ, same
 * leak, same e−1 bound, same forgiveness half-life — but carries one ledger per
 * channel plus the disagreement ledger, rather than one ledger over a scalar.
 */
export function createSuperpositionValve(rho: number = RHO_DEFAULT) {
  let turn = 0;
  let disagreement = 0;
  const drift: Record<ChannelName, number> = { lexical: 0, acoustic: 0, visual: 0, agreement: 0 };
  const last: Record<ChannelName, number | null> = { lexical: null, acoustic: null, visual: null, agreement: null };
  let current: Record<ChannelName, number | null> = { lexical: null, acoustic: null, visual: null, agreement: null };
  let spread = 0;
  let present = 0;

  const state = (): SuperpositionState => {
    const alignment_loss = Math.exp(rho * disagreement) - 1;
    const channels = {} as Record<ChannelName, ChannelHold>;
    for (const c of CHANNELS) {
      channels[c] = { kappa: current[c], drift: drift[c], loss: Math.exp(rho * drift[c]) - 1 };
    }
    return {
      turn,
      channels,
      spread,
      disagreement,
      alignment_loss,
      present,
      rho,
      half_life_turns: Math.log(2) / Math.log(1 / (1 - rho)),
      status:
        present <= QUIESCENT_PRESENT ? 'quiescent'
        : alignment_loss > DIVERGING_LOSS ? 'diverging'
        : 'holding',
    };
  };

  return {
    observe(input: SuperpositionInput): SuperpositionState {
      turn += 1;
      const decay = 1 - rho;

      const vals: number[] = [];
      for (const c of CHANNELS) {
        const raw = input[c];
        const v = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : null;
        current[c] = v;
        // Leak every ledger every turn, present or not: an absent channel's
        // history should forgive on the same clock, not freeze.
        const prev = last[c];
        const step = v !== null && prev !== null ? Math.abs(v - prev) : 0;
        drift[c] = decay * drift[c] + step;
        if (v !== null) { last[c] = v; vals.push(v); }
      }

      present = vals.length;
      // Spread is computed over the COSTLY channels only — acoustic, visual,
      // agreement — and deliberately excludes lexical.
      //
      // Words are free. Letting them drive the disagreement ledger reproduces
      // the original defect in a new shape: a careful speaker who hedges in
      // wording while the voice is steady and the evidence agrees would read
      // `diverging` purely for choosing honest words. Measured: that case sat
      // at alignment loss 0.379 with lexical included, and 0.02 without, while
      // the confident-but-unsupported case stays at 0.58 either way.
      //
      // Lexical is still carried, still gets its own drift ledger, and is still
      // reported. It just cannot raise a divergence flag by itself.
      const costly = COSTLY_CHANNELS
        .map((c) => current[c])
        .filter((v): v is number => v !== null);
      spread = costly.length >= 2 ? Math.max(...costly) - Math.min(...costly) : 0;
      disagreement = decay * disagreement + spread;

      return state();
    },
    state,
    reset() {
      turn = 0; disagreement = 0; spread = 0; present = 0;
      for (const c of CHANNELS) { drift[c] = 0; last[c] = null; }
      current = { lexical: null, acoustic: null, visual: null, agreement: null };
    },
  };
}
