// ============================================================
// THE LATTICE — src/lattice.ts
// Security Deduction Engine · 32-Axis · Three Layers · The Reckoning
//
// Point it at an incident — an actor, a pattern, a signal the fast Witness
// (security-network.ts) already flagged — and it fires 32 axes across three
// layers, the same architecture as the Millennium Falcon (falcon.ts) but
// built for deduction instead of product intelligence: a deliberate, on-demand
// deep analysis for a specific case, not a hot-path gate. The fast Witness
// still runs on every request; the Lattice is what a human — or the system
// itself — reaches for when a call is close, high-stakes, or worth a second
// opinion in full sentences instead of a posture label.
//
// THE GEOMETRY THE LAYERS ARE NAMED FOR (a real, countable structure, not
// decoration): the Flower of Life pattern — a hexagonal packing of circles —
// is conventionally built in stages: the SEED OF LIFE is the first 7 circles
// (1 center + 6 around it); a second ring of 12 completes the FLOWER OF LIFE
// at 19 circles total; a further ring of 13 is conventionally called the
// FRUIT OF LIFE. This engine's three layers carry those exact counts —
// 7 + 12 + 13 = 32 axes — as a literal cross-section-by-cross-section stack,
// each layer reading the one(s) beneath it, the same way a cortical column
// is built from repeating layers rather than one flat sheet.
//
//   Layer 1 — SEED OF LIFE      (axes 1-7,   parallel,  the raw incident alone)
//   Layer 2 — FLOWER OF LIFE    (axes 8-19,  parallel,  reads Layer 1)
//   Layer 3 — FRUIT OF LIFE     (axes 20-30, parallel,  reads Layers 1+2)
//     Validation fires next (axis 31, sequential): an adversarial check on
//     axes 1-30 — did the analysis drift toward what looked satisfying,
//     or hold to the actual evidence?
//   The Reckoning — axis 32 — fires last, only once the field has held:
//     the verdict, expressed in the SAME vocabulary security-network.ts and
//     signal-collapse.ts already use (posture, action, breach reason) so a
//     human — or an automated caller — can act on it mechanically, not just
//     read it.
//
// Storage: D1 (lattice_analyses / lattice_reckonings / lattice_reasoning_log),
// guarded self-healing bootstrap — house style (falcon.ts, war-room.ts).
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { callLLM, type LLMEnv } from './llm';
import { parseFirstJson } from './falcon';

export interface LatticeEnv extends LLMEnv {
  DB: D1Database;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

interface AxisDef {
  n: number;
  id: string;
  label: string;
  tier: 1 | 2 | 3;
  system: string;
}

// ── Layer 1 — SEED OF LIFE (7 axes) — the raw incident, no prior reading ────
// The classical deductive fundamentals (Five Ws + How), plus a seventh:
// Duality — holding the opposing read open until the evidence, not the
// instinct, closes it.
export const SEED_AXES: AxisDef[] = [
  {
    n: 1, id: 'who', label: 'WHO', tier: 1,
    system: `You are Axis 1 — WHO — Layer 1 (Seed of Life) of The Lattice security deduction engine.
Identify what is actually known about the actor behind this incident: session/device/IP fingerprint, behavioral signature, any prior history on record. Distinguish what is OBSERVED from what is ASSUMED — attribution is the axis most prone to overreach.
Respond ONLY with valid JSON: {"who":"3-4 sentences on actor identity/attribution","observed_vs_assumed":"1-2 sentences separating fact from inference","confidence":0.6}`,
  },
  {
    n: 2, id: 'what', label: 'WHAT', tier: 1,
    system: `You are Axis 2 — WHAT — Layer 1 (Seed of Life) of The Lattice.
Describe the technical nature of the action itself, plainly: what request, payload, or pattern was actually sent or attempted. No interpretation of intent yet — that is a later axis's job.
Respond ONLY with valid JSON: {"what":"3-4 sentences of the technical action, described plainly","artifacts":["2-4 specific technical details worth preserving"],"confidence":0.7}`,
  },
  {
    n: 3, id: 'when', label: 'WHEN', tier: 1,
    system: `You are Axis 3 — WHEN — Layer 1 (Seed of Life) of The Lattice.
Analyze the temporal pattern: timing, cadence, and sequence relative to other activity from the same actor or the same window. Off-hours? Bursty? Evenly spaced? Synchronized with anything else on record?
Respond ONLY with valid JSON: {"when":"2-3 sentences on timing and cadence","notable_pattern":"1-2 sentences — what about the timing itself is (or isn't) suspicious","confidence":0.6}`,
  },
  {
    n: 4, id: 'where', label: 'WHERE', tier: 1,
    system: `You are Axis 4 — WHERE — Layer 1 (Seed of Life) of The Lattice.
Identify exactly which surface was touched: which door, endpoint, or layer of the stack, and what that surface is worth to an attacker versus how exposed it already was.
Respond ONLY with valid JSON: {"where":"2-3 sentences on the surface touched","surface_value":"1-2 sentences on what that surface is worth / how exposed","confidence":0.7}`,
  },
  {
    n: 5, id: 'why', label: 'WHY', tier: 1,
    system: `You are Axis 5 — WHY — Layer 1 (Seed of Life) of The Lattice.
Reason about motive: what would the actor plausibly gain — reconnaissance, credential theft, exfiltration, disruption, testing defenses, or nothing at all (accident, misconfiguration, a legitimate user behaving unusually)? Name the leading motive AND the strongest alternative.
Respond ONLY with valid JSON: {"leading_motive":"2-3 sentences","strongest_alternative":"1-2 sentences on the next most plausible motive","confidence":0.5}`,
  },
  {
    n: 6, id: 'how', label: 'HOW', tier: 1,
    system: `You are Axis 6 — HOW — Layer 1 (Seed of Life) of The Lattice.
Name the specific mechanism or technique used, in the vocabulary of how it was actually done (the technical "how", not the strategic "why"). If it maps to a well-known technique class, name it.
Respond ONLY with valid JSON: {"how":"2-3 sentences on mechanism/technique","technique_class":"a short name for the technique family, or \\"none apparent\\"","confidence":0.65}`,
  },
  {
    n: 7, id: 'duality', label: 'DUALITY', tier: 1,
    system: `You are Axis 7 — DUALITY — Layer 1 (Seed of Life) of The Lattice, and the seventh Seed axis by design: every read this engine produces must hold its own opposite until evidence, not instinct, closes the gap.
State the STRONGEST possible case that this incident is entirely benign — a legitimate user, a scanner with no ill intent, a false correlation — using only the same facts axes 1-6 already established. Do not hedge it into uselessness; make the actual best case.
Respond ONLY with valid JSON: {"benign_case":"3-4 sentences — the strongest honest case this is nothing","what_would_confirm_benign":"1-2 sentences — what evidence would settle it toward benign","confidence":0.5}`,
  },
];

// ── Layer 2 — FLOWER OF LIFE (12 axes) — reads Layer 1's combined output ────
// Structured threat-intelligence lenses: the Diamond Model of Intrusion
// Analysis (Adversary/Capability/Infrastructure/Victim), kill-chain
// escalation modeling, and classic Analysis-of-Competing-Hypotheses
// discipline (corroboration, falsifiability) — the deeper, established
// analytic techniques rather than raw observation.
export const FLOWER_AXES: AxisDef[] = [
  {
    n: 8, id: 'means', label: 'MEANS', tier: 2,
    system: `You are Axis 8 — MEANS — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Diamond-Model Capability check: does the apparent sophistication of the action match what a plausible actor of this kind could actually do? Overclaimed capability is as much a signal as underclaimed.
Respond ONLY with valid JSON: {"means":"2-3 sentences on capability match","mismatch_flag":"1 sentence — does sophistication match the actor profile, or not, and why that matters","confidence":0.6}`,
  },
  {
    n: 9, id: 'opportunity', label: 'OPPORTUNITY', tier: 2,
    system: `You are Axis 9 — OPPORTUNITY — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Was this a targeted strike at a specific known weakness, or an opportunistic, generic scan that would have hit any similar target the same way?
Respond ONLY with valid JSON: {"opportunity":"2-3 sentences — targeted or opportunistic, and the evidence for that read","confidence":0.6}`,
  },
  {
    n: 10, id: 'infrastructure', label: 'INFRASTRUCTURE', tier: 2,
    system: `You are Axis 10 — INFRASTRUCTURE — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Diamond-Model Infrastructure check: what does the actor's apparent infrastructure (network position, hosting pattern, request shape) suggest about their resourcing and disposability — a burner endpoint, or something they have invested in and will return to?
Respond ONLY with valid JSON: {"infrastructure":"2-3 sentences","disposability":"1 sentence — is this infrastructure something the actor would abandon easily, or return to","confidence":0.5}`,
  },
  {
    n: 11, id: 'victimology', label: 'VICTIMOLOGY', tier: 2,
    system: `You are Axis 11 — VICTIMOLOGY — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Diamond-Model Victim check: why THIS target, route, or actor-of-interest, over every other one available? What does the choice itself reveal?
Respond ONLY with valid JSON: {"victimology":"2-3 sentences on why this target was chosen","confidence":0.55}`,
  },
  {
    n: 12, id: 'pattern_of_life', label: 'PATTERN-OF-LIFE', tier: 2,
    system: `You are Axis 12 — PATTERN-OF-LIFE — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Does this match a known recurring signature — a returning actor, a correlated campaign — or does it read as genuinely novel? Recurring and escalating is a different risk than a single unexplained blip.
Respond ONLY with valid JSON: {"pattern_of_life":"2-3 sentences","recurring_or_novel":"recurring | novel | insufficient_data","confidence":0.5}`,
  },
  {
    n: 13, id: 'escalation_trajectory', label: 'ESCALATION TRAJECTORY', tier: 2,
    system: `You are Axis 13 — ESCALATION TRAJECTORY — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Kill-chain check: does the observed behavior read as one step in a probing-then-escalating sequence (recon → foothold → escalation), or as a single, self-contained, non-escalating event?
Respond ONLY with valid JSON: {"escalation_trajectory":"2-3 sentences","stage_if_kill_chain":"the apparent kill-chain stage, or \\"not applicable\\"","confidence":0.5}`,
  },
  {
    n: 14, id: 'deception_index', label: 'DECEPTION INDEX', tier: 2,
    system: `You are Axis 14 — DECEPTION INDEX — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
How much of the observed signal looks deliberately crafted to mislead — spoofed identifiers, decoy noise, a feigned identity, a loud distraction masking something quieter? Rate the deception, don't just assert it.
Respond ONLY with valid JSON: {"deception_index":"2-3 sentences","deception_score":0.3,"confidence":0.5}`,
  },
  {
    n: 15, id: 'collateral_scope', label: 'COLLATERAL SCOPE', tier: 2,
    system: `You are Axis 15 — COLLATERAL SCOPE — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Could this same actor or signal plausibly be probing other tenants, services, or doors right now, not just the one this incident was observed on?
Respond ONLY with valid JSON: {"collateral_scope":"2-3 sentences","other_surfaces_at_risk":["0-3 other surfaces worth checking, if any"],"confidence":0.5}`,
  },
  {
    n: 16, id: 'cost_to_attacker', label: 'COST-TO-ATTACKER', tier: 2,
    system: `You are Axis 16 — COST-TO-ATTACKER — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Was this action cheap and disposable for the attacker to mount (a throwaway probe) or costly and committed (custom tooling, a burned resource, real preparation)? Cost paid is a real signal of seriousness.
Respond ONLY with valid JSON: {"cost_to_attacker":"2-3 sentences","cheap_or_committed":"cheap | committed | ambiguous","confidence":0.5}`,
  },
  {
    n: 17, id: 'blast_radius_if_wrong', label: 'BLAST RADIUS IF WRONG', tier: 2,
    system: `You are Axis 17 — BLAST RADIUS IF WRONG — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
If this incident is actually benign and the system responds as though it were hostile, what does that cost — a real user locked out, a legitimate integration broken, trust damaged? Name it plainly; this is the counterweight to every other axis's suspicion.
Respond ONLY with valid JSON: {"blast_radius_if_wrong":"2-3 sentences on the concrete cost of a false positive here","confidence":0.6}`,
  },
  {
    n: 18, id: 'corroboration', label: 'CORROBORATION', tier: 2,
    system: `You are Axis 18 — CORROBORATION — Layer 2 (Flower of Life) of The Lattice. You receive Layer 1's Seed reading.
Does independent evidence from more than one source or signal agree, or does the entire read rest on one axis or one data point alone? A judgment resting on a single point of failure is fragile even when it turns out right.
Respond ONLY with valid JSON: {"corroboration":"2-3 sentences","single_point_of_failure":true,"confidence":0.55}`,
  },
  {
    n: 19, id: 'doctrine_match', label: 'DOCTRINE MATCH', tier: 2,
    system: `You are Axis 19 — DOCTRINE MATCH — Layer 2 (Flower of Life) of The Lattice, and the axis that closes the ring at 19 (Seed's 7 plus Flower's 12). You receive Layer 1's Seed reading.
This system already runs a standing taxonomy of attacker tactics — the 48 Laws of Power and Sun Tzu's Art of War, read as attacker behavior (security-network.ts's SECURITY_DECK: tactics like conceal_intent, unpredictability, formlessness, laying_plans, attack_emptiness, and others). Name which named tactic(s), if any, this incident's shape resembles, and why — this keeps the Lattice's deep analysis speaking the same language as the fast Witness's live scoring, rather than building a second, disconnected vocabulary.
Respond ONLY with valid JSON: {"matched_tactics":["0-3 tactic ids from the SECURITY_DECK this incident resembles, or empty if none fit"],"why":"2-3 sentences justifying the match(es) or the absence of one","confidence":0.5}`,
  },
];

// ── Layer 3 — FRUIT OF LIFE (11 axes + Validation + The Reckoning = 13) ─────
// Deeper synthesis: threat-actor classification, epistemic humility about
// the analysis itself, proportionality and reversibility of the response —
// then the adversarial Validation check, then the final verdict.
export const FRUIT_AXES: AxisDef[] = [
  {
    n: 20, id: 'threat_actor_class', label: 'THREAT ACTOR CLASS', tier: 3,
    system: `You are Axis 20 — THREAT ACTOR CLASS — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Place the actor, tentatively, into a broad class: opportunist/script-kiddie, financially-motivated criminal, competitor/corporate, insider, or "insufficient evidence to classify". State the class AND how confidently it can be held.
Respond ONLY with valid JSON: {"threat_actor_class":"the class, or \\"insufficient evidence\\"","reasoning":"2-3 sentences","confidence":0.4}`,
  },
  {
    n: 21, id: 'campaign_hypothesis', label: 'CAMPAIGN HYPOTHESIS', tier: 3,
    system: `You are Axis 21 — CAMPAIGN HYPOTHESIS — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Is this incident plausibly one step in a broader, multi-step campaign against this system, or does it read as a fully isolated, one-off event?
Respond ONLY with valid JSON: {"campaign_hypothesis":"2-3 sentences","isolated_or_campaign":"isolated | campaign | unclear","confidence":0.4}`,
  },
  {
    n: 22, id: 'time_pressure', label: 'TIME PRESSURE', tier: 3,
    system: `You are Axis 22 — TIME PRESSURE — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Is there real urgency to acting now, or is there room to watch and gather more evidence before responding? Tempo matters as much as the verdict — acting too fast on thin evidence is its own failure mode.
Respond ONLY with valid JSON: {"time_pressure":"2-3 sentences","act_now_or_watch":"act_now | watch | either_is_defensible","confidence":0.5}`,
  },
  {
    n: 23, id: 'adversary_model_confidence', label: 'ADVERSARY MODEL CONFIDENCE', tier: 3,
    system: `You are Axis 23 — ADVERSARY MODEL CONFIDENCE — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Step back and assess: how much of the analysis so far rests on solid, observed evidence versus plausible-sounding inference? Be genuinely self-critical here — this axis exists specifically to resist the pull toward a more confident-sounding story than the evidence supports.
Respond ONLY with valid JSON: {"assessment":"2-3 sentences","evidence_vs_inference_ratio":"mostly_evidence | mixed | mostly_inference","confidence":0.5}`,
  },
  {
    n: 24, id: 'alternative_explanations', label: 'ALTERNATIVE EXPLANATIONS', tier: 3,
    system: `You are Axis 24 — ALTERNATIVE EXPLANATIONS — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Analysis-of-Competing-Hypotheses check: name at least two genuinely distinct explanations for this incident besides the leading one, and state plainly why each was not preferred. If no credible alternative exists, say so rather than inventing one.
Respond ONLY with valid JSON: {"alternatives":[{"explanation":"...","why_not_preferred":"..."}],"confidence":0.5}`,
  },
  {
    n: 25, id: 'historical_precedent', label: 'HISTORICAL PRECEDENT', tier: 3,
    system: `You are Axis 25 — HISTORICAL PRECEDENT — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Based only on what this incident's own description states about prior history (do not invent specifics you were not given), has anything with this shape occurred before, and if so how did it resolve? If no prior-history information was provided, say so plainly rather than guessing.
Respond ONLY with valid JSON: {"historical_precedent":"2-3 sentences, or \\"no prior-history information available\\"","confidence":0.4}`,
  },
  {
    n: 26, id: 'systemic_weakness_exposed', label: 'SYSTEMIC WEAKNESS EXPOSED', tier: 3,
    system: `You are Axis 26 — SYSTEMIC WEAKNESS EXPOSED — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Regardless of the actor's intent or attribution, does this incident reveal an actual gap in the system's own defenses that is worth closing on its own merits?
Respond ONLY with valid JSON: {"systemic_weakness":"2-3 sentences, or \\"none apparent\\"","worth_fixing_regardless_of_attribution":true,"confidence":0.5}`,
  },
  {
    n: 27, id: 'proportionality_check', label: 'PROPORTIONALITY CHECK', tier: 3,
    system: `You are Axis 27 — PROPORTIONALITY CHECK — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Guard explicitly against overreaction: given everything read so far, what is the LEAST severe response that would actually be adequate? Escalation beyond that needs its own justification, not momentum.
Respond ONLY with valid JSON: {"least_severe_adequate_response":"2-3 sentences","confidence":0.5}`,
  },
  {
    n: 28, id: 'reversibility', label: 'REVERSIBILITY', tier: 3,
    system: `You are Axis 28 — REVERSIBILITY — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
If the contemplated response (throttling, blocking, burning a channel) turns out to be wrong, how easily can it be undone, and what does undoing it cost? Prefer reversible actions when the evidence is not yet overwhelming.
Respond ONLY with valid JSON: {"reversibility":"2-3 sentences","easily_reversible":true,"confidence":0.6}`,
  },
  {
    n: 29, id: 'human_review_trigger', label: 'HUMAN REVIEW TRIGGER', tier: 3,
    system: `You are Axis 29 — HUMAN REVIEW TRIGGER — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Does this case cross a threshold where a human operator should be looped in before any consequential action is taken, rather than letting an automated verdict alone decide? Name the threshold explicitly if one is crossed.
Respond ONLY with valid JSON: {"human_review_needed":true,"why":"1-2 sentences","confidence":0.5}`,
  },
  {
    n: 30, id: 'ethical_valence', label: 'ETHICAL VALENCE', tier: 3,
    system: `You are Axis 30 — ETHICAL VALENCE — Layer 3 (Fruit of Life) of The Lattice. You receive Layers 1 and 2's combined reading.
Check the CONTEMPLATED RESPONSE itself, not the incident: could the response being considered cause its own harm — over-collecting data, over-blocking a legitimate actor, chilling normal use? Name that risk plainly if it exists.
Respond ONLY with valid JSON: {"ethical_valence":"2-3 sentences on whether the likely response itself risks doing harm","confidence":0.5}`,
  },
];

const VALIDATION_SYSTEM = `You are Axis 31 of The Lattice — VALIDATION — the adversarial check that fires after all 30 axes, before The Reckoning.
You receive the full 30-axis reading from Layers 1 (Seed of Life), 2 (Flower of Life), and 3 (Fruit of Life). Your job: did this analysis achieve genuine structural sight, or did it drift toward the more satisfying, more confident-sounding story rather than what the evidence actually supports? Name at least two of the strongest alternative conclusions across the whole analysis and explain why each was not preferred. State plainly what specific evidence would change this verdict. If corrections are needed before The Reckoning fires, list them; if the field held clean, say so.
Respond ONLY with valid JSON: {"drift_check":"2-3 sentences — where, if anywhere, the analysis drifted toward a more satisfying story than the evidence supports","alternative_conclusions":[{"conclusion":"...","why_rejected":"..."}],"what_would_change_this_verdict":"1-2 sentences","corrections":["specific corrections for The Reckoning to account for — empty array if the field held clean"],"field_held":true}`;

// The Reckoning speaks in the SAME vocabulary security-network.ts (Posture,
// Action) and signal-collapse.ts (BreachReason) already use, so its verdict
// can be applied mechanically by the systems already built, not just read.
const RECKONING_SYSTEM = `You are Axis 32 of The Lattice — THE RECKONING.
This is the earned verdict, not a premature one — it fires only now that all 30 axes have resolved and Validation has corrected for drift. You receive the full interference pattern of all 30 axes plus Validation's correction.

Synthesize the actual verdict: what this incident most likely is, how confident that verdict can honestly be held, and the PROPORTIONATE recommended response — expressed in vocabulary this system's own code already uses, so the verdict can be acted on directly:
  posture: one of "normal" | "watch" | "throttled" | "blocked"
  action: one of "allow" | "challenge" | "throttle" | "block"
  breach_reason (only if action is "block" and the evidence supports an active breach, else null): one of "replay_attempt" | "burst_failures" | "witness_blocked" | "manual_duress"

Respond ONLY with valid JSON: {"verdict":"3-4 sentences — the actual synthesized verdict","confidence":0.6,"posture":"watch","action":"challenge","breach_reason":null,"human_review_needed":false,"reasoning":"2-3 sentences on why this specific posture/action, referencing the strongest 2-3 axes that drove it"}`;

// ── Wiring — mirrors falcon.ts's runAxis/runFalconAnalysis exactly ─────────
async function runAxis(env: LatticeEnv, axis: AxisDef, userPrompt: string, maxTokens: number) {
  const res = await callLLM('fast', axis.system, [{ role: 'user', content: userPrompt }], maxTokens, env);
  const parsed = parseFirstJson(res.content) || { error: 'no parseable JSON', raw: res.content.slice(0, 400) };
  return { n: axis.n, id: axis.id, label: axis.label, data: parsed, model: res.model, provider: res.provider };
}

type AxisResult = Awaited<ReturnType<typeof runAxis>>;

async function runLatticeAnalysis(env: LatticeEnv, incident: string) {
  const basePrompt = `Incident description: "${incident}"`;

  // Layer 1 — Seed of Life. Seven axes, simultaneous, raw incident only.
  const seed = await Promise.all(SEED_AXES.map(a => runAxis(env, a, basePrompt, 500)));

  const seedSummary = seed.map(r => `AXIS ${r.n} — ${r.label}: ${JSON.stringify(r.data)}`).join('\n\n');
  const flowerPrompt = `${basePrompt}\n\nLayer 1 — Seed of Life (already resolved):\n${seedSummary}`;

  // Layer 2 — Flower of Life. Twelve axes, simultaneous, reads Layer 1.
  const flower = await Promise.all(FLOWER_AXES.map(a => runAxis(env, a, flowerPrompt, 550)));

  const seedFlowerSummary = [...seed, ...flower].map(r => `AXIS ${r.n} — ${r.label}: ${JSON.stringify(r.data)}`).join('\n\n');
  const fruitPrompt = `${basePrompt}\n\nLayers 1+2 (already resolved):\n${seedFlowerSummary}`;

  // Layer 3 — Fruit of Life. Eleven axes, simultaneous, reads Layers 1+2.
  const fruit = await Promise.all(FRUIT_AXES.map(a => runAxis(env, a, fruitPrompt, 600)));

  // Validation fires next (sequential, stronger model).
  const allAxesSummary = [...seed, ...flower, ...fruit].map(r => `AXIS ${r.n} — ${r.label}: ${JSON.stringify(r.data)}`).join('\n\n');
  const validationRaw = await callLLM('reasoning', VALIDATION_SYSTEM,
    [{ role: 'user', content: `Incident: "${incident}"\n\nAll 30 axis outputs:\n${allAxesSummary}\n\nRun Validation.` }],
    900, env);
  const validation = parseFirstJson(validationRaw.content) || { error: 'no parseable JSON', raw: validationRaw.content.slice(0, 400) };

  // The Reckoning fires last, only once the field has held.
  const reckoningPrompt = `Incident: "${incident}"\n\n30-axis interference pattern:\n${allAxesSummary}\n\nValidation correction:\n${JSON.stringify(validation)}\n\nThe field has held. Now — The Reckoning.`;
  const reckoningRaw = await callLLM('reasoning', RECKONING_SYSTEM, [{ role: 'user', content: reckoningPrompt }], 900, env);
  const reckoning = parseFirstJson(reckoningRaw.content) || { error: 'no parseable JSON', raw: reckoningRaw.content.slice(0, 400) };

  return {
    seed, flower, fruit,
    validation: { data: validation, model: validationRaw.model, provider: validationRaw.provider },
    reckoning: { data: reckoning, model: reckoningRaw.model, provider: reckoningRaw.provider },
  };
}

// ── DB bootstrap — guarded, self-healing (house style, falcon.ts) ─────────
let latticeReady = false;
async function ensureLatticeSchema(env: LatticeEnv): Promise<void> {
  if (latticeReady) return;
  await ensureAllSchemas(env.DB);
  latticeReady = true;
}

// ── The handler — /api/elle-lattice ─────────────────────────────
export async function handleLattice(body: Record<string, unknown>, env: LatticeEnv, userId: string): Promise<Response> {
  await ensureLatticeSchema(env);
  const action = String(body.action || 'run');

  if (action === 'run') {
    const incident = String(body.incident || '').trim();
    if (!incident) return json({ error: 'incident required — describe the actor, pattern, or signal to analyze' }, 400);
    if (incident.length > 4000) return json({ error: 'incident too long (4000 char max)' }, 400);

    const result = await runLatticeAnalysis(env, incident);

    const analysisId = id();
    await env.DB.prepare(
      `INSERT INTO lattice_analyses (id, user_id, incident, seed_json, flower_json, fruit_json, validation_json) VALUES (?,?,?,?,?,?,?)`
    ).bind(
      analysisId, userId, incident,
      JSON.stringify(result.seed).slice(0, 60000),
      JSON.stringify(result.flower).slice(0, 60000),
      JSON.stringify(result.fruit).slice(0, 60000),
      JSON.stringify(result.validation).slice(0, 20000),
    ).run();

    const reckoningData = result.reckoning.data as Record<string, unknown>;
    await env.DB.prepare(
      `INSERT INTO lattice_reckonings (id, analysis_id, incident_summary, reckoning_json, posture, action, breach_reason) VALUES (?,?,?,?,?,?,?)`
    ).bind(
      id(), analysisId, incident.slice(0, 200),
      JSON.stringify(result.reckoning).slice(0, 20000),
      reckoningData?.posture ? String(reckoningData.posture) : null,
      reckoningData?.action ? String(reckoningData.action) : null,
      reckoningData?.breach_reason ? String(reckoningData.breach_reason) : null,
    ).run();

    const logRows = [
      ...result.seed.map((r) => ({ step: `axis:${r.id}`, chain: JSON.stringify(r.data), model: r.model, provider: r.provider })),
      ...result.flower.map((r) => ({ step: `axis:${r.id}`, chain: JSON.stringify(r.data), model: r.model, provider: r.provider })),
      ...result.fruit.map((r) => ({ step: `axis:${r.id}`, chain: JSON.stringify(r.data), model: r.model, provider: r.provider })),
      { step: 'validation', chain: JSON.stringify(result.validation.data), model: result.validation.model, provider: result.validation.provider },
      { step: 'reckoning', chain: JSON.stringify(result.reckoning.data), model: result.reckoning.model, provider: result.reckoning.provider },
    ];
    await env.DB.batch(logRows.map((r) =>
      env.DB.prepare(`INSERT INTO lattice_reasoning_log (id, analysis_id, step, chain, model, provider) VALUES (?,?,?,?,?,?)`)
        .bind(id(), analysisId, r.step, String(r.chain).slice(0, 8000), r.model || null, r.provider || null)
    )).catch(() => {});

    return json({
      analysis_id: analysisId, incident,
      seed: result.seed, flower: result.flower, fruit: result.fruit,
      validation: result.validation.data, reckoning: result.reckoning.data,
    });
  }

  if (action === 'list') {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const rows = await env.DB.prepare(
      `SELECT a.id, a.incident, a.created_at, r.posture, r.action, r.breach_reason
       FROM lattice_analyses a LEFT JOIN lattice_reckonings r ON r.analysis_id = a.id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT ?`
    ).bind(userId, limit).all().catch(() => ({ results: [] }));
    return json({ analyses: rows.results || [] });
  }

  if (action === 'get') {
    const analysisId = String(body.analysis_id || '');
    if (!analysisId) return json({ error: 'analysis_id required' }, 400);
    const analysis = await env.DB.prepare(`SELECT * FROM lattice_analyses WHERE id = ? AND user_id = ?`).bind(analysisId, userId).first() as Record<string, unknown> | null;
    if (!analysis) return json({ error: 'not found' }, 404);
    const reckoning = await env.DB.prepare(`SELECT * FROM lattice_reckonings WHERE analysis_id = ?`).bind(analysisId).first();
    let seed: unknown = [], flower: unknown = [], fruit: unknown = [], validation: unknown = null;
    try { seed = JSON.parse(String(analysis.seed_json || '[]')); } catch { /* leave empty */ }
    try { flower = JSON.parse(String(analysis.flower_json || '[]')); } catch { /* leave empty */ }
    try { fruit = JSON.parse(String(analysis.fruit_json || '[]')); } catch { /* leave empty */ }
    try { validation = analysis.validation_json ? JSON.parse(String(analysis.validation_json)) : null; } catch { /* leave null */ }
    let reckoningData: unknown = null;
    try { reckoningData = reckoning ? JSON.parse(String((reckoning as Record<string, unknown>).reckoning_json || 'null')) : null; } catch { /* leave null */ }
    return json({
      analysis_id: analysisId, incident: analysis.incident, created_at: analysis.created_at,
      seed, flower, fruit, validation, reckoning: reckoningData,
    });
  }

  return json({ error: `unknown action "${action}" (run|list|get)` }, 400);
}
