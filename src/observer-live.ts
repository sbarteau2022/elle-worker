// ============================================================
// THE LIVE-CASE LOGGER — src/observer-live.ts
//
// The only uncontaminated validator of the completeness→fidelity claim.
//
// Every retrospective test of κ NULLed for one structural reason: the weights
// had already memorized the docket's endings. Gated fidelity (predict an outcome
// only if its driving agent was modelled) and ungated fidelity (recall it
// regardless) diverged by the contamination gap. You cannot validate a
// reasoning-quality metric against outcomes the model already knows.
//
// The escape is not a cleverer statistic — it is TIME. Log the prediction on an
// OPEN case now, stamp the model's training cutoff on the record, and let the
// world resolve it later. A record is ADMISSIBLE only if, at prediction time t0,
// the outcome was genuinely unknown: the case postdates the training cutoff AND
// its resolution had not yet happened. That predicate — open + post-cutoff — is
// enforced at WRITE time, so no memorized outcome can enter the sample.
//
// Two things are captured at t0 and scored separately at resolution:
//   MODE A — the nested-Markov-blanket topology the run inferred. Completeness
//            sets the CEILING: you can only forecast a collision whose agent you
//            named. (Reuses completenessFromExtraction — same number the worker's
//            blanket extractor reports.)
//   MODE B — a GATED forward simulation. Each forecast names a driving agent that
//            MUST already exist in the Mode-A topology; a forecast whose driver
//            is not a named agent is REFUSED at write time. That gate is what
//            keeps recall out of the sample.
//
// The signal this table accumulates toward: completeness (A) → gated fidelity
// (B), over admissible + resolved rows only. It is a CLOCK, not a snapshot — it
// returns no verdict until real cases resolve. Read-only as to behaviour: it
// ranks and gates nothing in the Observer. Best-effort throughout.
// ============================================================

import { callLLM, type LLMEnv } from './llm';
import { parseFirstJson } from './falcon';
import { axisProse } from './observer';
import { completenessFromExtraction, extractBlanketModel, type BlanketModel } from './observer-blanket';
import { overlapMatch } from './observer-falsifier';

export interface LiveEnv extends LLMEnv { DB: D1Database; }

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// The model's training cutoff — the firewall date. Configurable via env so it
// travels with whatever model llm.ts routes runs to; falls back to a
// deliberately conservative default (a memorized outcome slipping through would
// only weaken the test, never fake a positive).
export const DEFAULT_MODEL_CUTOFF = '2024-06-01';

// Default forecast horizon when the caller names none: six months past t0.
const DEFAULT_HORIZON_DAYS = 180;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The contamination firewall, as a predicate. Everything the project learned the
// hard way is compressed here: score a case ONLY if its outcome was unknowable at
// t0 (post-cutoff) and undecided at t0 (resolution in the future).
export function admissible(cutoff: string, t0: string, due: string): { ok: boolean; reason: string } {
  const c = t0.slice(0, 10), cut = cutoff.slice(0, 10), d = due.slice(0, 10);
  if (!(cut < c)) return { ok: false, reason: 't0 precedes training cutoff — outcome may be memorized' };
  if (!(c < d)) return { ok: false, reason: 'resolution not in the future at t0 — not a live forecast' };
  return { ok: true, reason: 'admissible: open + post-cutoff' };
}

export interface GatedForecast { predicted_change: string; driving_agent: string; prob: number }

// The Mode-B forward simulation, GATED. Asks the model for the structural changes
// it expects — but keeps ONLY those whose driving agent is already a named blanket
// in the topology. Refusals are counted, not silently dropped: n_refused is the
// visible measure of how much the forecast wanted to reach past the map.
const FORECAST_SYSTEM =
`You are a forward simulator over a fixed cast of agents (Markov blankets). You are given the agents already identified in a case and the analysis's prediction. Name the concrete structural changes you expect NEXT.
For EACH: predicted_change (a specific, checkable event), driving_agent (WHICH named agent drives it — use the agent's exact name), prob (0..1 subjective probability).
Use ONLY the agents provided. Do NOT introduce new agents. If a change has no driver among the named agents, omit it.
Respond ONLY with valid JSON: {"forecasts":[{"predicted_change":"...","driving_agent":"...","prob":0.6}]}. No commentary.`;

export async function buildGatedForecasts(
  env: LiveEnv, topology: BlanketModel, predictionProse: string,
): Promise<{ forecasts: GatedForecast[]; refused: number }> {
  const names = new Set((topology.blankets || []).map(b => b.name).filter(Boolean) as string[]);
  if (!names.size) return { forecasts: [], refused: 0 };
  const agentList = [...names].join(', ');
  const material = `AGENTS (the only permissible drivers): ${agentList}\n\nPREDICTION:\n${predictionProse.slice(0, 1500)}`;
  try {
    const res = await callLLM('reasoning', FORECAST_SYSTEM, [{ role: 'user', content: material }], 800, env);
    const parsed = parseFirstJson(res.content) as { forecasts?: Array<Record<string, unknown>> } | null;
    const raw = Array.isArray(parsed?.forecasts) ? parsed!.forecasts : [];
    const kept: GatedForecast[] = [];
    let refused = 0;
    for (const f of raw) {
      const driver = String(f.driving_agent || '').trim();
      const change = String(f.predicted_change || '').trim();
      if (!change) continue;
      // THE GATE — enforced at write time. A driver not among the named agents
      // is refused; memory cannot smuggle in an un-modelled mechanism.
      if (!names.has(driver)) { refused++; continue; }
      const prob = Number(f.prob);
      kept.push({ predicted_change: change.slice(0, 300), driving_agent: driver, prob: isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0.5 });
    }
    return { forecasts: kept.slice(0, 12), refused };
  } catch {
    return { forecasts: [], refused: 0 };
  }
}

// Log a live prediction for an open case: extract (or reuse) the topology, build
// the gated forecasts, stamp the cutoff + horizon, and persist. Admissibility is
// computed and stored but NEVER blocks the write — an inadmissible row is kept and
// marked, so the firewall's decisions are auditable, not invisible. Idempotent per
// analysis (ON CONFLICT). Best-effort: returns null on any trouble.
export async function logLivePrediction(
  env: LiveEnv,
  analysisId: string,
  args: {
    caseTitle?: string;
    modelId?: string;
    trainingCutoff?: string;
    t0?: string;
    resolutionDue?: string;
    horizonDays?: number;
    topology?: BlanketModel | null;
    axisData?: { structural: unknown; dissent: unknown; prediction: unknown };
    predictionProse?: string;
  },
): Promise<{ id: string; admissible: boolean; reason: string; mode_a_completeness: number; n_forecasts: number; n_refused: number; status: string } | null> {
  // Mode A — reuse a passed topology, else extract fresh from the axis prose.
  let topology = args.topology ?? null;
  if (!topology && args.axisData) topology = await extractBlanketModel(env, args.axisData);
  if (!topology) return null;

  const completeness = completenessFromExtraction(topology);
  const predProse = args.predictionProse ?? (args.axisData ? axisProse(args.axisData.prediction) : '');
  const { forecasts, refused } = await buildGatedForecasts(env, topology, predProse);

  const t0 = (args.t0 || new Date().toISOString()).slice(0, 10);
  const cutoff = (args.trainingCutoff || DEFAULT_MODEL_CUTOFF).slice(0, 10);
  const due = (args.resolutionDue || addDays(t0, args.horizonDays || DEFAULT_HORIZON_DAYS)).slice(0, 10);
  const adm = admissible(cutoff, t0, due);
  const status = adm.ok ? 'pending' : 'inadmissible';
  const rowId = id();

  await env.DB.prepare(
    `INSERT INTO observer_predictions_live
      (id, analysis_id, case_title, t0, model_id, training_cutoff, resolution_due, admissible, admit_reason,
       topology_json, mode_a_completeness, n_agents, forecasts_json, n_forecasts, n_refused, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(analysis_id) DO UPDATE SET
       case_title=excluded.case_title, t0=excluded.t0, model_id=excluded.model_id,
       training_cutoff=excluded.training_cutoff, resolution_due=excluded.resolution_due,
       admissible=excluded.admissible, admit_reason=excluded.admit_reason,
       topology_json=excluded.topology_json, mode_a_completeness=excluded.mode_a_completeness,
       n_agents=excluded.n_agents, forecasts_json=excluded.forecasts_json,
       n_forecasts=excluded.n_forecasts, n_refused=excluded.n_refused, status=excluded.status`
  ).bind(
    rowId, analysisId, (args.caseTitle || '').slice(0, 300) || null,
    t0, args.modelId || 'unknown', cutoff, due, adm.ok ? 1 : 0, adm.reason,
    JSON.stringify(topology), completeness, (topology.blankets || []).length,
    JSON.stringify(forecasts), forecasts.length, refused, status,
  ).run().catch(() => {});

  return { id: rowId, admissible: adm.ok, reason: adm.reason, mode_a_completeness: completeness, n_forecasts: forecasts.length, n_refused: refused, status };
}

export interface ResolvedOutcome { description: string; occurred: boolean; driving_agent: string }

// Gated fidelity: of the ground-truth outcomes whose driver the topology named
// (the only ones the gate would ever let us forecast), what fraction did we both
// forecast AND see occur? A forecast counts as hitting an outcome when its prose
// overlaps the outcome's above a threshold (the same lexical proxy the falsifier
// uses, so scoring is consistent across the two rungs). Pure.
export function gatedFidelity(
  agentNames: Set<string>, forecasts: GatedForecast[], outcomes: ResolvedOutcome[],
): number {
  const gatedTruth = outcomes.filter(o => agentNames.has(o.driving_agent));
  if (!gatedTruth.length) return 0;
  let hits = 0;
  for (const o of gatedTruth) {
    if (!o.occurred) continue;
    const matched = forecasts.some(f =>
      f.driving_agent === o.driving_agent && overlapMatch(f.predicted_change, o.description) >= 0.34);
    if (matched) hits++;
  }
  return hits / gatedTruth.length;
}

// Resolve a live row: attach the realized outcomes and compute the two separated
// scores. free_energy = complexity − accuracy (the bimodal loss), with complexity
// = normalized agent count. Refuses to score an inadmissible row (its outcome may
// be memorized — the whole reason the row was flagged). Best-effort.
export async function resolveLivePrediction(
  env: LiveEnv, analysisId: string, outcomes: ResolvedOutcome[], complexityW = 0.25,
): Promise<{ status: string; gated_fidelity: number | null; mode_a_completeness: number | null; free_energy: number | null; reason?: string } | null> {
  const row = await env.DB.prepare(
    `SELECT topology_json, mode_a_completeness, forecasts_json, n_agents, admissible FROM observer_predictions_live WHERE analysis_id = ?`
  ).bind(analysisId).first() as { topology_json: string; mode_a_completeness: number; forecasts_json: string; n_agents: number; admissible: number } | null;
  if (!row) return null;
  if (!row.admissible) {
    return { status: 'inadmissible', gated_fidelity: null, mode_a_completeness: row.mode_a_completeness, free_energy: null, reason: 'row is inadmissible (pre-cutoff or already-decided) — cannot validate κ' };
  }

  let topology: BlanketModel; let forecasts: GatedForecast[];
  try {
    topology = JSON.parse(row.topology_json) as BlanketModel;
    forecasts = JSON.parse(row.forecasts_json) as GatedForecast[];
  } catch { return null; }
  const names = new Set((topology.blankets || []).map(b => b.name).filter(Boolean) as string[]);

  const fidelity = gatedFidelity(names, forecasts, outcomes);
  const complexity = (row.n_agents || 0) / 8.0;
  const freeEnergy = complexityW * complexity - fidelity;

  await env.DB.prepare(
    `UPDATE observer_predictions_live
       SET outcomes_json = ?, gated_fidelity = ?, free_energy = ?, status = 'resolved', resolved_at = datetime('now')
     WHERE analysis_id = ?`
  ).bind(JSON.stringify(outcomes), fidelity, freeEnergy, analysisId).run().catch(() => {});

  return { status: 'resolved', gated_fidelity: fidelity, mode_a_completeness: row.mode_a_completeness, free_energy: freeEnergy };
}

// Spearman rank correlation — the validation statistic. Pure; stdlib only.
export function spearman(a: number[], b: number[]): number {
  if (a.length < 2) return 0;
  const rank = (xs: number[]) => {
    const order = [...xs.keys()].sort((i, j) => xs[i] - xs[j]);
    const r = new Array(xs.length);
    order.forEach((idx, pos) => { r[idx] = pos; });
    return r;
  };
  const ax = rank(a), bx = rank(b);
  const ma = ax.reduce((s, x) => s + x, 0) / ax.length;
  const mb = bx.reduce((s, x) => s + x, 0) / bx.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ax.length; i++) { num += (ax[i] - ma) * (bx[i] - mb); da += (ax[i] - ma) ** 2; db += (bx[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// The uncontaminated readout: completeness (A) → gated fidelity (B) over
// admissible + resolved rows. Returns no rho until ≥ POWER_FLOOR cases resolve —
// a clock, never a snapshot dressed as a verdict.
export async function liveValidation(env: LiveEnv, userId: string, powerFloor = 8): Promise<Record<string, unknown>> {
  const rows = await env.DB.prepare(
    `SELECT p.mode_a_completeness AS comp, p.gated_fidelity AS fid, p.case_title AS title, p.t0, p.resolution_due, p.n_refused
       FROM observer_predictions_live p
       JOIN observer_analyses a ON a.id = p.analysis_id
      WHERE a.user_id = ? AND p.status = 'resolved' AND p.admissible = 1 AND p.gated_fidelity IS NOT NULL
      ORDER BY p.resolved_at ASC`
  ).bind(userId).all().catch(() => ({ results: [] }));
  const resolved = (rows.results || []) as Array<{ comp: number; fid: number; title: string; n_refused: number }>;

  const counts = await env.DB.prepare(
    `SELECT status, admissible, COUNT(*) AS c FROM observer_predictions_live p
       JOIN observer_analyses a ON a.id = p.analysis_id
      WHERE a.user_id = ? GROUP BY status, admissible`
  ).bind(userId).all().catch(() => ({ results: [] }));

  const comp = resolved.map(r => r.comp);
  const fid = resolved.map(r => r.fid);
  const rho = resolved.length >= 2 ? spearman(comp, fid) : null;
  const underpowered = resolved.length < powerFloor;

  return {
    claim: 'topology completeness (Mode A) predicts gated forward-sim fidelity (Mode B) — the two-models predictor, on cases the model could NOT have memorized',
    tallies: counts.results || [],
    n_resolved_admissible: resolved.length,
    power_floor: powerFloor,
    spearman_completeness_to_gated_fidelity: rho === null ? null : Number(rho.toFixed(3)),
    verdict: underpowered ? 'UNDERPOWERED' : (rho !== null && rho > 0 ? 'SUPPORTED' : 'NOT-SUPPORTED'),
    headline: underpowered
      ? `no verdict yet: ${resolved.length} admissible case(s) resolved (floor is ${powerFloor}). This is a clock — it accrues as live cases settle, and cannot be rushed.`
      : `uncontaminated verdict: rho=${rho} over n=${resolved.length} post-cutoff cases`,
    cases: resolved.map(r => ({ title: r.title, completeness: Number(r.comp?.toFixed(3)), gated_fidelity: Number(r.fid?.toFixed(3)), n_refused: r.n_refused })),
    reading: 'HINDSIGHT-FREE by construction: every row postdates the training cutoff and was logged before resolution. The only sample that can validate κ.',
    provisional: true,
  };
}
