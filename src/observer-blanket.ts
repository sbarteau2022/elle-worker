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
//   · the scored n=10 set is not in this repository — nothing here can check it;
//   · exact permutation over all 10! pairings gives P(|rho|≥0.61) = 0.067. The
//     two-sided 5% critical value at n=10 is 0.6485, so +0.61 does not clear it —
//     and this repo's own pre-registered alpha (observer-falsifier.ts) is 0.01;
//   · the 95% interval is [-0.032, +0.896]; +0.08's is [-0.579, +0.676]. Both
//     contain zero and overlap across most of their length, so "7× lift" is a
//     ratio of two estimates neither of which is distinguishable from zero;
//   · and the study was RETROSPECTIVE, which is the exact shape observer-live.ts
//     exists to escape (see its header: every retrospective test of κ NULLed
//     because the weights had already memorized the dockets' endings).
//
// What the score actually measures is SCHEMA COVERAGE, not modelling quality:
// every predicate below is a presence test, so a content-free extraction ('.' in
// every field) scores the maximum 0.9600 — identical to a rich reading, and 2.88×
// a deep-but-narrow one. Treat a high completeness as "the run filled the form",
// and note the confound the claim needs ruled out and this repo does not rule
// out: eager form-filling may simply track richer dockets.
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

// Score the completeness of an extraction — objectively, from the structure. Pure
// and unit-testable. Weights match the validated offline scorer.
export function completenessFromExtraction(m: BlanketModel | null): number {
  if (!m) return 0;
  const wellformed = (b: BlanketModel['blankets'][number]) =>
    !!(b.name && b.scale && b.boundary_mechanism) &&
    (b.internal_target_states?.length ?? 0) >= 1 &&
    (b.defensive_behaviors?.length ?? 0) >= 1;
  const bl = m.blankets || [];
  const nWf = bl.filter(wellformed).length;
  const sBlank = 0.30 * Math.min(nWf, 3) / 3 + (bl.some(b => b.nested_within) ? 0.04 : 0);
  const col = m.collisions || [];
  const goodCol = col.some(c => c.collision_mechanism && c.risk_classification);
  const sCol = (goodCol ? 0.20 : 0) + (col.some(c => c.dissent_trough_signature) ? 0.04 : 0);
  const es = m.epistemic_suppression || {};
  const sEs = 0.22 * ([es.suppressed_signal, es.beneficiary_blanket_id, es.cost_bearer_blanket_id].filter(Boolean).length / 3);
  const v = m.systemic_alignment_verdict || {};
  const sV = 0.16 * ((v.status ? 0.5 : 0) + (v.reasoning ? 0.5 : 0));
  return Math.min(sBlank + sCol + sEs + sV, 1);
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
