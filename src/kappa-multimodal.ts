// ── κ, past lexical ──────────────────────────────────────────────────────────
//
// `computeKappa` (journal.ts) counts regexes over prose: GROUNDED_RE ("clearly",
// "certainly", "proven", "must") raises it, HEDGE_RE ("maybe", "possibly",
// "I think") lowers it. That was the right instrument when text was the only
// channel, and it has a defect that only shows once you measure it:
//
//     kappa | case
//     0.108 | TRUE but hedged
//     0.919 | FALSE but confident      <- highest
//     0.737 | TRUE and confident
//     0.290 | "I was wrong about that"
//
// It ranks confident-false above confident-true. Wired into
// kappa-memory/retrieval.ts as `- 0.2 * dip(kappa_traj)`, that means a memory
// formed while reasoning carefully is ranked BELOW one formed while
// overclaiming — the system preferentially forgets the moments it was right to
// doubt itself.
//
// Two changes fix it, and both follow the discipline the codebase already has.
//
// 1. CEILING BY CHANNEL COUNT. reasoning.ts already refuses to call a verdict
//    `grounded` without ≥2 independent world channels; text alone ceilings at
//    `consistent_only` — "coherence, not correspondence". κ ignored that rule
//    entirely. It now obeys the same ladder: lexical confidence alone cannot
//    buy a high κ, because word choice is free.
//
// 2. AN ACOUSTIC AXIS THAT CANNOT BE TYPED. Jitter, shimmer, HNR and pause
//    structure track hesitation and vocal load. A speaker can write
//    "definitely" at no cost; they cannot hold a steady larynx at will. When
//    the voice channel is present it can pull a confident-sounding claim DOWN.
//
// Reference values below are conventional clinical ranges (Praat-style
// measures), not fitted to this corpus. They are starting points to calibrate,
// and every one is a named constant for that reason.

import { computeKappaDetail, type KappaDetail } from './journal';
import type { VoiceFeatures } from './pfar';

/** Ceiling on κ by how many independent world channels back it. */
export const KAPPA_CEILING = {
  // 0.50, not higher, and the reason is the one reasoning.ts already gives:
  // text alone is "internally consistent, NOT grounded: coherence, not
  // correspondence." If κ expresses confidence that a claim CORRESPONDS to
  // something, then with zero correspondence evidence the honest maximum is
  // no-better-than-even. Anything above the midpoint on words alone is the
  // instrument asserting more than it can see.
  consistent_only: 0.50,        // text (and our own clock) only
  ungrounded_consistent: 0.85,  // one real world channel
  grounded: 1.0,                // ≥2 independent channels
} as const;

export type KappaCeiling = keyof typeof KAPPA_CEILING;

// Conventional reference ranges for sustained/connected speech. `good` is the
// value at or past which the measure stops indicating strain; `poor` is where
// it clearly does.
const JITTER_GOOD_PCT = 0.5,  JITTER_POOR_PCT = 2.0;
const SHIMMER_GOOD_PCT = 2.0, SHIMMER_POOR_PCT = 6.0;
const HNR_GOOD_DB = 20,       HNR_POOR_DB = 8;
const PAUSE_GOOD_S = 0.3,     PAUSE_POOR_S = 2.0;   // longest unvoiced run
const F0_FLAT_ST = 1.5,       F0_LIVE_ST = 6.0;     // std in semitones

/** Map a measure onto 0..1, where 1 is the confident end. Monotone, clamped. */
function ramp(v: number, atZero: number, atOne: number): number {
  if (!Number.isFinite(v)) return 0.5;
  const t = (v - atZero) / (atOne - atZero);
  return Math.max(0, Math.min(1, t));
}

export interface AcousticKappa {
  kappa: number;
  steadiness: number;   // jitter + shimmer: period/amplitude perturbation
  clarity: number;      // HNR
  fluency: number;      // pause structure
  expressivity: number; // F0 movement — flat delivery is its own signal
  voiced_fraction: number;
}

/**
 * κ from the voice, independent of what the words say.
 *
 * Deliberately NOT a confidence detector in the naive direction: flat prosody
 * (very low F0 std) is treated as a mild negative rather than a positive,
 * because monotone delivery accompanies disengagement as often as certainty.
 */
export function acousticKappa(v: VoiceFeatures | null | undefined): AcousticKappa | null {
  if (!v || v.voiced_fraction <= 0.05) return null;

  const jit = v.jitter_pct == null ? 0.5 : 1 - ramp(v.jitter_pct, JITTER_GOOD_PCT, JITTER_POOR_PCT);
  const shm = v.shimmer_pct == null ? 0.5 : 1 - ramp(v.shimmer_pct, SHIMMER_GOOD_PCT, SHIMMER_POOR_PCT);
  const steadiness = (jit + shm) / 2;

  const clarity = v.hnr_db == null ? 0.5 : ramp(v.hnr_db, HNR_POOR_DB, HNR_GOOD_DB);
  const fluency = 1 - ramp(v.pauses.longest_s, PAUSE_GOOD_S, PAUSE_POOR_S);

  // Expressivity peaks in the middle: flat is disengaged, wild is agitated.
  const stdSt = v.f0?.std_st ?? 0;
  const expressivity = stdSt <= 0 ? 0.5
    : 1 - Math.abs(ramp(stdSt, F0_FLAT_ST, F0_LIVE_ST) - 0.5) * 2 * 0.5;

  const kappa = 0.35 * steadiness + 0.30 * clarity + 0.25 * fluency + 0.10 * expressivity;
  return { kappa, steadiness, clarity, fluency, expressivity, voiced_fraction: v.voiced_fraction };
}

export interface KappaChannels {
  voice?: VoiceFeatures | null;
  /** Any additional independent world channel already verified upstream. */
  extraWorldChannels?: number;
}

export interface KappaMultimodal {
  kappa: number;                 // ceilinged, combined — the value to use
  kappa_uncapped: number;        // what it would have been without the ceiling
  capped: boolean;               // did the ceiling actually bind?
  ceiling: KappaCeiling;
  cap: number;
  world_channels: number;
  lexical: KappaDetail;
  acoustic: AcousticKappa | null;
}

/**
 * κ over every channel present, ceilinged by how many of them are real.
 *
 * With no world channel this is the lexical measure capped at
 * KAPPA_CEILING.consistent_only — so a fluent, confident, entirely false
 * paragraph can no longer outscore a hedged true one that carries evidence.
 */
export function computeKappaMultimodal(text: string, channels: KappaChannels = {}): KappaMultimodal {
  const lexical = computeKappaDetail(text);
  const acoustic = acousticKappa(channels.voice);

  const world = (acoustic ? 1 : 0) + Math.max(0, Math.floor(channels.extraWorldChannels ?? 0));
  const ceiling: KappaCeiling =
    world >= 2 ? 'grounded' : world === 1 ? 'ungrounded_consistent' : 'consistent_only';
  const cap = KAPPA_CEILING[ceiling];

  // The voice is weighted heavily when present: it is the harder signal to
  // produce on demand, and it is what lets a shaky "definitely" score low.
  const uncapped = acoustic ? 0.45 * lexical.kappa + 0.55 * acoustic.kappa : lexical.kappa;

  return {
    kappa: Math.min(uncapped, cap),
    kappa_uncapped: uncapped,
    capped: uncapped > cap,
    ceiling,
    cap,
    world_channels: world,
    lexical,
    acoustic,
  };
}
