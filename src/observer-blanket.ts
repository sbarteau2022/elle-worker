// ============================================================
// THE BLANKET STRUCTURE EXTRACTOR — src/observer-blanket.ts
//
// The two-models correction, made operational. Trajectory coherence (the κ seam)
// measures fidelity to the reasoner's OWN model; it does not predict accuracy,
// because accuracy is fidelity to the WORLD's model. The world is predictable to
// the degree you model it as nested self-optimizing agents (Markov blankets),
// each minimizing surprise toward its own boundary, and MISALIGNED when a
// sub-blanket optimizes against the system it is nested in (capture / cancer).
// Every Observer docket is such a case.
//
// So we extract, per run, the nested-Markov-blanket MODEL it inferred, and score
// its COMPLETENESS at prediction time — did it name the agents, their target
// states and defensive behaviours, the collisions (with a risk class), the
// suppressed signal and who bears its cost, and the systemic alignment verdict.
//
// HYPOTHESIS, NOT A VALIDATION. An offline reading of n=10 hand-extractions put
// completeness→fidelity at rho≈+0.61 against +0.08 for trajectory coherence. That
// number does not survive its own siege (docs/observer_blanket_siege.cjs, results
// in docs/OBSERVER_BLANKET_SIEGE_RESULTS.txt) and must not be quoted as settled:
//   · the scored n=10 set is not in this repository — nothing here can check it,
//     and no tie-handling convention for the scoring is recorded anywhere (A4);
//   · exact permutation over all 10! pairings gives two-sided p = 0.063–0.067,
//     with a 5% critical value of 0.6364–0.6442 depending on tie pattern, so
//     +0.61 clears none of them — and this repo's own pre-registered alpha is
//     0.01 (observer-falsifier.ts holds that permutation null, POWER_FLOOR=8);
//   · the 95% interval (Bonett–Wright, the Spearman se) is [-0.076, +0.904];
//     +0.08's is [-0.608, +0.699]. Both contain zero and overlap across most
//     of their length, so "7× lift" is a ratio of two estimates neither of
//     which is distinguishable from zero;
//   · and the study was RETROSPECTIVE, which is the exact shape observer-live.ts
//     exists to escape (see its header: every retrospective test of κ NULLed
//     because the weights had already memorized the dockets' endings).
//
// What the score actually measures is SCHEMA COVERAGE, not modelling quality.
// Every predicate is still a STRUCTURAL test — it now has a syntactic substance
// floor under it (see A3 below), so a content-free extraction ('.' in every
// field) no longer scores the maximum, but a plausible invented reading and a
// true one still score alike. Treat a high completeness as "the run filled the
// form, with something in it", and note the confound the claim needs ruled out
// and this repo does not rule out: eager form-filling may simply track richer
// dockets.
//
// The instrument that CAN settle this is already here and already running:
// observer-live.ts scores completeness against gated forward-sim fidelity on
// post-cutoff cases only, and observer-falsifier.ts holds the permutation null.
// It is a clock — UNDERPOWERED until POWER_FLOOR=8 admissible cases resolve. Read
// its verdict, not this comment, before relying on the relationship.
//
// Read-only as to behaviour: it ranks and gates NOTHING. Best-effort throughout —
// an extraction failure returns null and never fails or slows a run.
// ============================================================

import { callLLM, type LLMEnv } from './llm';
import { parseFirstJson } from './falcon';
import { axisProse } from './observer';

export interface BlanketEnv extends LLMEnv { DB: D1Database; }

// The operator's NestedMarkovBlanketExtraction schema (the shape callLLM fills).
export interface BlanketModel {
  blankets: Array<{
    blanket_id?: string; name?: string;
    scale?: 'individual' | 'sub_organization' | 'institution' | 'super_system';
    nested_within?: string | null;
    boundary_mechanism?: string;
    internal_target_states?: string[];
    defensive_behaviors?: string[];
  }>;
  collisions: Array<{
    collision_id?: string; sub_blanket_id?: string; target_blanket_id?: string;
    collision_mechanism?: string;
    risk_classification?: 'institutional_capture' | 'parasitic_cancer' | 'epistemic_suppression' | 'structural_rupture';
    dissent_trough_signature?: string;
  }>;
  epistemic_suppression?: { suppressed_signal?: string; beneficiary_blanket_id?: string; cost_bearer_blanket_id?: string };
  systemic_alignment_verdict?: { status?: 'nested_compatible' | 'locally_optimized_parasitic' | 'systemically_fragile'; reasoning?: string };
}

// The extraction instruction — keyed to the schema. JSON-only (house style).
const EXTRACTION_SYSTEM =
`You are a nested-Markov-blanket structural analyst. Given an Observer analysis of a case, extract the nested self-optimizing-agent structure it inferred.
For EACH agent (Markov blanket): blanket_id, name, scale (individual | sub_organization | institution | super_system), nested_within (parent blanket_id or null), boundary_mechanism (what defines its membrane — credentials, legal entity, capital, peer review), internal_target_states (what it minimizes surprise around — prestige, solvency, authority), and defensive_behaviors (actions to preserve the boundary under pushback).
Then: collisions — where a sub-blanket's local optimization exports surprise onto a host — each with sub_blanket_id, target_blanket_id, collision_mechanism, risk_classification (institutional_capture | parasitic_cancer | epistemic_suppression | structural_rupture), and dissent_trough_signature (the anomaly generated at that surface).
Then: epistemic_suppression {suppressed_signal, beneficiary_blanket_id, cost_bearer_blanket_id}.
Then: systemic_alignment_verdict {status (nested_compatible | locally_optimized_parasitic | systemically_fragile), reasoning}.
Extract ONLY what the analysis actually articulated; do not invent structure it did not infer.
Respond ONLY with valid JSON: {"blankets":[...],"collisions":[...],"epistemic_suppression":{...},"systemic_alignment_verdict":{...}}. No commentary.`;

// ============================================================
// COMPLETENESS SCORING — weights, saturation, and the substance floor.
//
// Three of the numbers below were changed in response to
// docs/observer_blanket_siege.cjs (probes A1, A2, A3); the fourth change (A7)
// is structural. Each constant carries the reason for its value.
//
// A1 — THE SCALE IS NOW REACHABLE. The weight blocks sum to EXACTLY 1.00, so
// the reachable maximum of completenessFromExtraction is 1.0000 and the closing
// Math.min(..., 1) is a live guard on the arithmetic rather than dead code.
// Before this revision the blocks summed to 0.96: a flawless extraction scored
// 0.9600 and could never reach the 1.0 that every consumer reads the number
// against. The new weights are the old calibration with +0.01 added to each of
// the four substantive blocks; no block's rank order changed.
//
// THE REACHABLE MAXIMUM IS 1.0000 EXACTLY, and it is attained only by an
// extraction that fills every block AND names BLANKET_SATURATION or more
// well-formed agents. Asserted in observer-blanket.test.ts.
const W_BLANKETS    = 0.31;  // well-formed agents named (with diminishing returns)
const W_NESTING     = 0.04;  // at least one well-formed agent placed INSIDE another
const W_COLLISION   = 0.21;  // >=1 collision carrying a mechanism AND a risk class
const W_TROUGH      = 0.04;  // >=1 collision carrying a dissent-trough signature
const W_SUPPRESSION = 0.23;  // the three epistemic_suppression fields, pro rata
const W_VERDICT     = 0.17;  // systemic alignment status (half) + reasoning (half)
// 0.31 + 0.04 + 0.21 + 0.04 + 0.23 + 0.17 = 1.00

// A2 — DIMINISHING RETURNS INSTEAD OF A HARD CAP. The old term was
// 0.30 * Math.min(nWf, 3) / 3: the fourth agent and the thirtieth each carried
// exactly zero bits, so a docket naming three parties and one naming thirty
// were indistinguishable on the term whose whole job is to measure how much
// structure the run saw. The replacement is the harmonic partial sum — agent k
// adds 1/k of what the first agent added — normalised so that
// BLANKET_SATURATION agents earn the full weight. It is monotone, strictly
// increasing up to saturation, and bounded, which is what the cap was there to
// guarantee and the only thing it did right.
//
// BLANKET_SATURATION = 8 is a modelling judgement, not a measured optimum, and
// is stated as one. It has to be large enough that the 4th through 8th agent
// still carry information (the defect A2 names) and small enough that the top
// of the scale is reachable by an extraction a real docket can support. Eight
// is roughly the cast an institutional-capture docket names before the next
// agent is a sub-branch of one already named: captured body, its parent system,
// the sponsor, the dissenter, the funder, the reviewer, the cost-bearer, the
// public. Past that the marginal agent is nearly always a re-description.
const BLANKET_SATURATION = 8;

// A3 — A SUBSTANCE FLOOR UNDER THE PRESENCE TESTS. Every predicate used to be
// a truthiness test (!!b.name, .length >= 1), so an extraction with "." in
// every string field scored the maximum — identical to a rich reading and 2.88x
// a deep-but-narrow one. The checks below are deliberately SYNTACTIC. They
// reject degenerate values; they do not judge meaning, and they cannot tell a
// true reading from a plausible invented one. All they separate is "a field was
// filled" from "a field was filled with a character".
const MIN_LABEL_CHARS = 2;
// 2 and no higher: agent names and list entries are legitimately short in real
// dockets ("HHS", "IRS", "the board"), but one character cannot name an agent.
const MIN_PHRASE_CHARS = 4;
// 4 and no higher: these fields describe a MECHANISM ("credentials", "capital",
// "exports risk"), and the shortest honest English mechanism word is about four
// characters. Higher starts rejecting real content; lower re-admits the
// single-token filler this floor exists to catch.
const PLACEHOLDER_VALUES = new Set(
  ['n/a', 'na', 'none', 'null', 'nil', 'undefined', 'tbd', 'todo', 'unknown', 'unspecified']);
// Single letters are deliberately NOT placeholders. Blanket ids and short
// signal handles are one or two characters in genuine extractions, so treating
// them as filler would put the top of the scale out of reach for real input —
// a false negative that would be worse than the false positive it prevents.

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
// The one non-negotiable floor: a value must carry at least one letter or digit.
// This is what kills "", " ", ".", "...", "-", "?" — the shapes a schema-filler
// emits when the material gave it nothing.
const hasContent = (v: unknown): boolean => {
  const s = asText(v);
  return s.length > 0 && /[\p{L}\p{N}]/u.test(s) && !PLACEHOLDER_VALUES.has(s.toLowerCase());
};
const isLabel  = (v: unknown): boolean => hasContent(v) && asText(v).length >= MIN_LABEL_CHARS;
const isPhrase = (v: unknown): boolean => hasContent(v) && asText(v).length >= MIN_PHRASE_CHARS;
const someLabel = (v: unknown): boolean => Array.isArray(v) && v.some(isLabel);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
// Distinctness is required only where identity is definitionally degenerate: a
// collision is between TWO blankets, so sub == target is not a collision. Only
// applied when BOTH ids are present — they are optional in the schema, and an
// absent id is missing information, not a contradiction. Deliberately NOT
// applied to epistemic_suppression: a party can benefit at one scale and bear
// the cost at another, so beneficiary == cost_bearer is unusual, not degenerate.
const partiesDistinct = (a: unknown, b: unknown): boolean => {
  const x = asText(a).toLowerCase(), y = asText(b).toLowerCase();
  return !(x.length > 0 && y.length > 0 && x === y);
};

// Harmonic saturation: agent k contributes 1/k of the first agent's credit, and
// BLANKET_SATURATION agents earn exactly 1 (the loop divides identical sums, so
// this is 1.0 exactly in floating point, not 0.9999...).
function blanketCoverage(nWellformed: number): number {
  const n = Math.min(Math.max(nWellformed, 0), BLANKET_SATURATION);
  let earned = 0, total = 0;
  for (let k = 1; k <= BLANKET_SATURATION; k++) {
    const term = 1 / k;
    total += term;
    if (k <= n) earned += term;
  }
  return total > 0 ? earned / total : 0;
}

const wellformedBlanket = (b: unknown): boolean =>
  isRecord(b) &&
  isLabel(b.name) &&                    // an agent needs a nameable name
  hasContent(b.scale) &&                // a closed enum — content check only
  isPhrase(b.boundary_mechanism) &&     // what defines its membrane, described
  someLabel(b.internal_target_states) &&
  someLabel(b.defensive_behaviors);

const goodCollision = (c: unknown): boolean =>
  isRecord(c) &&
  isPhrase(c.collision_mechanism) &&
  hasContent(c.risk_classification) &&  // closed enum
  partiesDistinct(c.sub_blanket_id, c.target_blanket_id);

// Score the completeness of an extraction — objectively, from the structure.
// Pure, deterministic, and TOTAL: see A7 below.
//
// Returns a finite number in [0, 1]. 1.0000 is reachable (A1) and requires
// BLANKET_SATURATION well-formed agents plus every other block filled.
//
// A7 — TOTAL BY CONSTRUCTION. This is exported API whose input is a parsed LLM
// response, and the siege found two malformed inputs that made it THROW rather
// than score (blankets as a string, collisions as an object). The extractor
// happens to guard those today; the scorer must not depend on that, because a
// future caller that skips the extractor would get an exception instead of a
// number. Every field is now coerced at the boundary, the arithmetic is checked
// for finiteness, and the whole body is wrapped: any argument at all — null,
// undefined, a string, a proxy with throwing getters — returns a number in
// [0, 1]. It never throws, and it never returns NaN or undefined.
export function completenessFromExtraction(m: BlanketModel | null): number {
  try {
    if (!isRecord(m)) return 0;
    const model = m as Record<string, unknown>;

    const bl = asArray(model.blankets);
    const nWf = bl.filter(wellformedBlanket).length;
    const nested = bl.some(b => wellformedBlanket(b) && hasContent((b as Record<string, unknown>).nested_within));
    const sBlank = W_BLANKETS * blanketCoverage(nWf) + (nested ? W_NESTING : 0);

    const col = asArray(model.collisions);
    const sCol = (col.some(goodCollision) ? W_COLLISION : 0)
      + (col.some(c => isRecord(c) && isPhrase(c.dissent_trough_signature)) ? W_TROUGH : 0);

    const es = asRecord(model.epistemic_suppression);
    const sEs = W_SUPPRESSION *
      ([es.suppressed_signal, es.beneficiary_blanket_id, es.cost_bearer_blanket_id].filter(hasContent).length / 3);

    const v = asRecord(model.systemic_alignment_verdict);
    const sV = W_VERDICT * ((hasContent(v.status) ? 0.5 : 0) + (isPhrase(v.reasoning) ? 0.5 : 0));

    const total = sBlank + sCol + sEs + sV;
    if (!Number.isFinite(total)) return 0;
    return Math.min(Math.max(total, 0), 1);
  } catch {
    return 0;
  }
}

// Extract the blanket model from a run's structural + suppress + prediction prose.
// Returns null on any trouble (best-effort). callLLM('reasoning') → Gemini/steady.
export async function extractBlanketModel(env: BlanketEnv, axisData: { structural: unknown; dissent: unknown; prediction: unknown }): Promise<BlanketModel | null> {
  const material =
    `STRUCTURAL (what is happening beneath both, + what both suppress):\n${axisProse(axisData.structural).slice(0, 3000)}\n\n` +
    `DISSENT (self-audit):\n${axisProse(axisData.dissent).slice(0, 1500)}\n\n` +
    `PREDICTION:\n${axisProse(axisData.prediction).slice(0, 1500)}`;
  try {
    const res = await callLLM('reasoning', EXTRACTION_SYSTEM, [{ role: 'user', content: material }], 1400, env);
    const parsed = parseFirstJson(res.content) as BlanketModel | null;
    if (!parsed || !Array.isArray(parsed.blankets)) return null;
    parsed.collisions = Array.isArray(parsed.collisions) ? parsed.collisions : [];
    return parsed;
  } catch {
    return null;
  }
}

// Extract + persist for one analysis. Idempotent (ON CONFLICT). Best-effort.
export async function extractAndPersistBlanket(env: BlanketEnv, analysisId: string, axisData: { structural: unknown; dissent: unknown; prediction: unknown }): Promise<boolean> {
  const model = await extractBlanketModel(env, axisData);
  if (!model) return false;
  const completeness = completenessFromExtraction(model);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO observer_blankets (id, analysis_id, model_json, completeness, n_blankets, n_collisions, alignment_status) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(analysis_id) DO UPDATE SET model_json=excluded.model_json, completeness=excluded.completeness, n_blankets=excluded.n_blankets, n_collisions=excluded.n_collisions, alignment_status=excluded.alignment_status, created_at=datetime('now')`
  ).bind(
    id, analysisId, JSON.stringify(model), completeness,
    model.blankets.length, model.collisions.length,
    model.systemic_alignment_verdict?.status || null,
  ).run().catch(() => {});
  return true;
}
