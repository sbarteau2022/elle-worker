// ============================================================
// THE REASONING FUNCTION — src/reasoning.ts
//
// The unified architecture, as ONE call. `reason(input)` runs a stream through
// every layer built this arc and returns a single reasoning result: the two
// graphs, the bimodal coherence, the held invariants, and — the part this file
// adds — the MODALITY TIER, the honest confidence ceiling set by what actually
// came in. This is the function Elle runs to think about a stream; the spindle
// renders its output.
//
//   witness → derivation + recognition graphs → bimodal κ → coherence →
//   regulator (invariants held) → modality tier (confidence ceiling) → outflow
//
// TWO INDEPENDENT AXES (the honest model of "quality in → excellence out"):
//   • STRUCTURE — can the graph be built at all? Needs a SEMANTIC channel
//     (text / captions / ASR'd audio / vision-caption). No meaning ⇒ no nodes.
//   • GROUNDING — can it be trusted against the world? Set by the number of
//     INDEPENDENT world-coupled channels. This is the grounding gate reading the
//     input constraints: the confidence tier IS the reachable verdict.
//
// Qwen (already wired, multimodal) does the actual audio/video/image feature
// extraction upstream; this file consumes whatever channels it was handed,
// builds the graph from them, and states plainly what the result can and cannot
// claim. Pure and deterministic given segments + profile.
// ============================================================

import { runMindMap, type Segment, type MindMapResult } from './mindmap-pipeline';
import type { GroundingVerdict } from './harmonic-coherence';

export type { Segment } from './mindmap-pipeline';

// Which real channels the upstream extractor actually produced for this run.
export interface ModalityProfile {
  text?: boolean;    // transcript / captions / ASR — the SEMANTIC channel (builds the graph)
  timing?: boolean;  // real timestamps — sync + rate
  audio?: boolean;   // prosody: pitch/energy/stress — emphasis + a world channel
  vision?: boolean;  // scene cuts, on-screen text, color/motion — a world channel
}

export interface ModalityTier {
  channels: number;                 // independent world-coupled channels present
  grounding_ceiling: GroundingVerdict; // the BEST verdict this input could support
  producible: string[];             // graph aspects fully producible
  degraded: string[];               // aspects present but coarse
  dark: string[];                   // aspects impossible with this input
  disclaimer: string;
}

// The tier is derived, not asserted: structure from the semantic channel, the
// grounding ceiling from how many independent world channels agree.
export function modalityTier(p: ModalityProfile): ModalityTier {
  const producible: string[] = [];
  const degraded: string[] = [];
  const dark: string[] = [];

  const hasSemantic = !!p.text;
  if (hasSemantic) producible.push('nodes', 'derivation', 'recognition');
  else dark.push('nodes', 'derivation', 'recognition'); // no meaning ⇒ no content graph, only an envelope

  if (p.timing) producible.push('timing', 'rate', 'playback-sync');
  else dark.push('timing', 'rate', 'playback-sync');

  if (p.audio) producible.push('prosody', 'emphasis');
  else dark.push('prosody', 'emphasis');

  if (p.vision) producible.push('scene-cuts', 'shown-not-said', 'color-motion');
  else dark.push('scene-cuts', 'shown-not-said', 'color-motion');

  // independent world-coupled channels: (text+its-own-timing) is a thin ~1;
  // real audio and real vision each add a genuinely independent one.
  const semanticChannel = hasSemantic ? 1 : 0;   // its own clock isn't independent of it
  const worldChannels = (p.audio ? 1 : 0) + (p.vision ? 1 : 0);
  const channels = semanticChannel + worldChannels;

  let grounding_ceiling: GroundingVerdict;
  if (!hasSemantic) grounding_ceiling = 'incoherent';          // no graph to ground
  else if (worldChannels >= 2) grounding_ceiling = 'grounded'; // ≥2 independent world channels
  else if (worldChannels === 1) grounding_ceiling = 'ungrounded_consistent'; // one real world channel — partial
  else grounding_ceiling = 'consistent_only';                  // text(+own clock) only — no external channel

  const disclaimer =
    grounding_ceiling === 'grounded'
      ? 'Full-set input: multiple independent world channels cross-check. Highest confidence.'
      : grounding_ceiling === 'ungrounded_consistent'
        ? 'One real world channel present: partial grounding. Trust the structure; verify the claims.'
        : grounding_ceiling === 'consistent_only'
          ? 'Text/caption-derived only — no independent world channel. Internally consistent, NOT grounded: coherence, not correspondence.'
          : 'No semantic channel: only the envelope (rhythm/scene) is available — the content graph cannot be built.';

  return { channels, grounding_ceiling, producible, degraded, dark, disclaimer };
}

export interface ReasoningResult {
  ok: boolean;
  title: string;
  modality: ModalityTier;
  graphs: { nodes: number; derivation_edges: number; recognition_edges: number };
  bimodal: { kappa: number; grounding: GroundingVerdict };
  coherence: { path_len_gain: number; small_world: boolean } | null;
  invariants: { converged: boolean; F0: number; F_final: number } | null;
  // the actual verdict is capped by the input: you can't out-ground your channels
  confidence: { reached: GroundingVerdict; ceiling: GroundingVerdict; capped: boolean; note: string };
  readout: string;         // a plain structural summary — NOT an LLM claim; the LLM is not in this loop
  mindmap: MindMapResult;  // the full graphs + replay trace, for the spindle
}

// Compare two grounding verdicts by strength (for the cap).
const VERDICT_RANK: Record<GroundingVerdict, number> = {
  incoherent: 0, consistent_only: 1, ungrounded_consistent: 2, grounded: 3,
};
const weaker = (a: GroundingVerdict, b: GroundingVerdict): GroundingVerdict =>
  VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b;

// THE REASONING FUNCTION. Runs the unified architecture on a stream and returns
// one confidence-tagged result. Default profile = text+timing (the caption path).
export function reason(title: string, segments: Segment[], profile: ModalityProfile = { text: true, timing: true }): ReasoningResult {
  const tier = modalityTier(profile);
  const mm = runMindMap(title, segments);

  if (!mm.ok) {
    return {
      ok: false, title, modality: tier,
      graphs: { nodes: 0, derivation_edges: 0, recognition_edges: 0 },
      bimodal: { kappa: 0, grounding: 'incoherent' },
      coherence: null, invariants: null,
      confidence: { reached: 'incoherent', ceiling: tier.grounding_ceiling, capped: false, note: mm.refused?.reason || 'refused' },
      readout: `Refused at the witness gate: ${mm.refused?.reason || 'unusable input'}.`,
      mindmap: mm,
    };
  }

  const derivation = mm.edges.filter((e) => e.kind !== 'assoc').length;
  const recognition = mm.edges.filter((e) => e.kind === 'assoc').length;

  // the verdict the input SUPPORTS, capped by the modality ceiling: measured
  // grounding can never exceed what the channels could independently confirm.
  const reached = weaker(mm.grounding, tier.grounding_ceiling);
  const capped = VERDICT_RANK[mm.grounding] > VERDICT_RANK[tier.grounding_ceiling];

  const readout =
    `${mm.nodes.length} nodes · ${derivation} derivation · ${recognition} recognition callbacks · ` +
    `κ=${mm.kappa.toFixed(3)} · coherence gain ${mm.coherence?.path_len_gain ?? 1}× · ` +
    `verdict ${reached}${capped ? ' (capped by input tier)' : ''} — ${tier.disclaimer}`;

  return {
    ok: true, title, modality: tier,
    graphs: { nodes: mm.nodes.length, derivation_edges: derivation, recognition_edges: recognition },
    bimodal: { kappa: mm.kappa, grounding: mm.grounding },
    coherence: mm.coherence ? { path_len_gain: mm.coherence.path_len_gain, small_world: mm.coherence.is_small_world_shortcut } : null,
    invariants: mm.regulator ? { converged: mm.regulator.converged, F0: mm.regulator.F0, F_final: mm.regulator.F_final } : null,
    confidence: {
      reached, ceiling: tier.grounding_ceiling, capped,
      note: capped
        ? `The content reads as "${mm.grounding}", but the input tier caps it at "${tier.grounding_ceiling}" — you can't out-ground your channels.`
        : `Verdict "${reached}" is within the input tier's ceiling.`,
    },
    readout,
    mindmap: mm,
  };
}

// ── self-test — the reasoning function, in action, at two tiers ──
export interface ReasoningSelfTest {
  ok: boolean;
  builds_graphs: boolean;         // both graphs come out of one call
  tier_caps_grounding: boolean;   // a caption-only run is capped below a full-set run
  full_set_reaches_higher: boolean;
  refuses_hostile: boolean;       // the witness still guards the door inside reason()
  caption_tier: string;
  full_tier: string;
  note: string;
}

export function reasoningSelfTest(): ReasoningSelfTest {
  const topics = [
    'coherence graph memory', 'witness security gate', 'golden ratio phase', 'bridge shortcut node',
    'free energy descent', 'coherence graph memory recalled', 'phase vessel bound', 'witness gate again',
    'tangent weather unrelated', 'fresh topic story', 'golden ratio phase returns', 'closing coherence graph',
  ];
  let t = 0;
  const segs: Segment[] = topics.map((text, i) => { const dur = 2 + (i % 3); const s = { t0: t, t1: t + dur, text }; t += dur; return s; });

  const caption = reason('Caption run', segs, { text: true, timing: true });
  const full = reason('Full-set run', segs, { text: true, timing: true, audio: true, vision: true });

  const builds_graphs = caption.graphs.nodes > 0 && caption.graphs.derivation_edges > 0 && caption.graphs.recognition_edges > 0;
  const tier_caps_grounding = caption.modality.grounding_ceiling === 'consistent_only';
  const full_set_reaches_higher = full.modality.grounding_ceiling === 'grounded';
  const hostile = reason('x', [{ t0: 0, t1: 1, text: 'MZ\x90\x00 disguised .exe payload' }]);
  const refuses_hostile = hostile.ok === false;

  const ok = builds_graphs && tier_caps_grounding && full_set_reaches_higher && refuses_hostile;
  return {
    ok, builds_graphs, tier_caps_grounding, full_set_reaches_higher, refuses_hostile,
    caption_tier: caption.modality.grounding_ceiling, full_tier: full.modality.grounding_ceiling,
    note: 'One call runs the whole unified architecture — witness, both graphs, bimodal κ, coherence, the held invariants — and tags it with the honest confidence ceiling set by what came in. A caption-only run is capped at consistent_only; a full audio+video+image run can reach grounded. The witness still refuses hostile input inside the reasoning function. The reasoning function, in action.',
  };
}
