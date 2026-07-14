// ============================================================
// THE SPINE — Unified Falcon Decision Engine  —  SHADOW / NOT VALIDATED
//
// The user's architecture, built:
//
//   Tier 1 fires → COLLAPSES.   (collapse 1)
//   collapse 1 feeds Tier 2 → COLLAPSES.   (collapse 2)
//   collapse 2 feeds Tier 3 → COLLAPSES.   (collapse 3)
//   DISSENT holds all three — it does NOT collapse them. It observes where
//     they cohere and where they split, and reports the HELD field.
//   AXIS 17 — the Future Axis — is the ONLY thing that collapses the decision:
//     it reads the held field + the dissent report and produces a PREDICTION.
//     That prediction, gated by κ, is the decision signal across the board.
//
// This inverts the standing Falcon (falcon.ts), which collapses ONCE at the
// Rupture. Here each tier earns its own collapse in proper order, and the
// decision-collapse is deferred to Axis 17 — so "never collapse prematurely"
// (NECAI-F Type 3) is preserved at the level that matters: dissent keeps the
// field open until the prediction is earned.
//
// THE UNIFICATION WITH κ (the point of the whole exercise):
//   ONE spine run = ONE observation on the decision regulator — exactly
//   parallel to one trading-cron cycle being one observation on the position
//   regulator. The three tiers set that observation's DIRECTION (does the
//   field cohere up or down) and WEIGHT (agreement × confidence); the
//   conviction κ = logistic(z) is earned across REPEATED coherent runs,
//   never one. Same stepAsymmetricZ, same φ²-asymmetry (a credible dissent
//   costs ~2.6 confirmations), same single-step-no-collapse invariant. The
//   drawdown-shaper that sizes a trade and the regulator that gates a
//   decision are now literally the same instrument, over different streams.
//
// STATUS: SHADOW. Nothing routes a real decision through this yet. The pure
// core (holdField / dissent / observeField / axis17) is fully tested; the
// LLM orchestrator (runSpine) is best-effort and clearly advisory. Predictive
// VALUE is unmeasured — Axis 17's accuracy must be scored against realized
// outcomes with the same pre-registration discipline the trading lane used
// before this gates anything. The κ here rides the field's internal
// coherence, which is a real signal; whether coherence PREDICTS is the open,
// falsifiable question — deliberately not assumed.
// ============================================================
import { callLLM, type LLMEnv } from './llm';
import {
  createAsymmetricRegulator, asymmetricKappa, stepAsymmetricZ,
  PHI, ASYM_Z_MAX,
} from './recovery';
import { TIER1_AXES, TIER2_AXES, parseFirstJson } from './falcon';

export interface SpineEnv extends LLMEnv {
  DB: D1Database;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const clampSigned = (x: number) => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);

// ── the held field ───────────────────────────────────────────
// A tier's collapse: its resolved thesis reduced to a signed conviction and a
// strength. direction ∈ [−1,1] (which way this tier points), confidence ∈
// [0,1] (how hard it holds). The prose lives in `claims`/`thesis`; the numbers
// are what the regulator reads.
export interface TierCollapse {
  tier: 1 | 2 | 3;
  thesis: string;
  direction: number;
  confidence: number;
  claims: string[];
}

export interface DecisionField {
  collapses: TierCollapse[];  // held SEPARATELY — never merged into one answer
  meanDirection: number;      // confidence-weighted, for reference only
  agreement: number;          // [0,1] — do the tiers point the same way
  heldOpen: true;             // marker: this is a HELD field, not a collapse
}

// Coherence of the field: |Σ w·d| / Σ w·|d| — 1 when the tiers all point one
// way, 0 when they cancel. Confidence-weighted, sign-based; magnitude-robust.
export function fieldAgreement(collapses: TierCollapse[]): number {
  let signed = 0, mag = 0;
  for (const c of collapses) {
    const w = clamp01(c.confidence), d = clampSigned(c.direction);
    signed += w * d; mag += w * Math.abs(d);
  }
  return mag > 0 ? Math.abs(signed) / mag : 0;
}

export function meanConfidence(collapses: TierCollapse[]): number {
  if (collapses.length === 0) return 0;
  return collapses.reduce((s, c) => s + clamp01(c.confidence), 0) / collapses.length;
}

// Hold the three collapses. Keeps them separate; computes reference metrics.
// Never reduces them to a single verdict — that is Axis 17's job, later.
export function holdField(collapses: TierCollapse[]): DecisionField {
  const valid = collapses.filter(c => Number.isFinite(c.direction) && Number.isFinite(c.confidence));
  const wsum = valid.reduce((s, c) => s + clamp01(c.confidence), 0);
  const meanDirection = wsum > 0
    ? valid.reduce((s, c) => s + clampSigned(c.direction) * clamp01(c.confidence), 0) / wsum
    : 0;
  return { collapses: valid, meanDirection, agreement: fieldAgreement(valid), heldOpen: true };
}

// ── dissent — holds, observes, reports; NEVER collapses ──────
export interface DissentReport {
  agreement: number;
  fieldDirection: 'up' | 'down' | 'flat';
  aligned: number[];    // tiers pointing with the field
  contested: number[];  // tiers pointing against it — the split
  holds: true;          // structural guarantee: dissent does not resolve
  note: string;
}

export function dissent(field: DecisionField): DissentReport {
  const s = Math.sign(field.meanDirection);
  const fieldDirection = s > 0 ? 'up' : s < 0 ? 'down' : 'flat';
  const dir = s || 1;
  const aligned: number[] = [], contested: number[] = [];
  for (const c of field.collapses) {
    const cs = Math.sign(clampSigned(c.direction));
    (cs === dir || cs === 0 ? aligned : contested).push(c.tier);
  }
  return {
    agreement: field.agreement, fieldDirection, aligned, contested, holds: true,
    note: contested.length
      ? `tiers ${contested.join(',')} dissent from the ${fieldDirection} field — held open, not overruled`
      : 'field coheres across all tiers',
  };
}

// ── the decision regulator: one spine run = one observation ──
// A coherent field CONFIRMS (recover); a contested/incoherent one STRAINS.
// Weight = agreement × mean confidence, so a weak or split field barely moves
// κ. This is the same stepAsymmetricZ the trading lane uses — conviction is
// earned across repeated runs, and a single run (however coherent) cannot
// cross into "charged" by itself (single-step-no-collapse, carried over).
export function observeField(zPrev: number, field: DecisionField, dis: DissentReport): number {
  const coheres = dis.contested.length === 0 && field.agreement > 0.5;
  const weight = clamp01(field.agreement * meanConfidence(field.collapses));
  return stepAsymmetricZ(zPrev, coheres ? 'recover' : 'strain', weight);
}

export const kappaOf = (z: number) => asymmetricKappa(z);

// The "charged" rail from recovery.ts: z > zMaxRecover/2, zMaxRecover = Z/φ².
const CHARGED_Z = ASYM_Z_MAX / (PHI * PHI) / 2;
export const chargedKappa = kappaOf(CHARGED_Z);   // ≈ 0.639 — the act threshold

// ── Axis 17 — the Future Axis: the only decision-collapse ────
export interface Prediction {
  direction: number;   // predicted signed move, [−1,1]
  confidence: number;  // instantaneous field coherence (this run)
  kappa: number;       // persistent conviction (regulator, across runs)
  gate: 'act' | 'hold';
  act: boolean;
  reason: string;
  shadow: true;
}

// z is the CURRENT regulator state (after observeField). The prediction is
// always produced; the ACT gate fires only when the field coheres now AND
// conviction has been earned (κ charged) AND no tier is in dissent. Anything
// short of that HOLDS — dissent keeps the field open. No premature collapse.
export function axis17(field: DecisionField, dis: DissentReport, z: number): Prediction {
  const kappa = kappaOf(z);
  const confidence = dis.contested.length === 0
    ? field.agreement
    : field.agreement * (1 - dis.contested.length / Math.max(1, field.collapses.length));
  const charged = z > CHARGED_Z;
  const coherent = dis.contested.length === 0 && field.agreement > 0.5;
  const act = charged && coherent;
  const reasons: string[] = [];
  if (!charged) reasons.push('conviction not yet earned (κ below charged rail)');
  if (dis.contested.length) reasons.push(`tiers ${dis.contested.join(',')} dissent`);
  if (dis.contested.length === 0 && field.agreement <= 0.5) reasons.push('field too incoherent');
  return {
    direction: field.meanDirection,
    confidence, kappa,
    gate: act ? 'act' : 'hold',
    act,
    reason: act ? 'field coheres and conviction is charged — prediction earned' : `held: ${reasons.join('; ')}`,
    shadow: true,
  };
}

// The full pure pipeline over three tier collapses + a prior regulator state.
// This is the whole spine in one call, no LLM — the testable heart.
export interface SpineOutcome {
  field: DecisionField;
  dissent: DissentReport;
  z: number;            // new regulator state to persist
  prediction: Prediction;
}
export function runSpinePure(collapses: TierCollapse[], zPrior = 0): SpineOutcome {
  const field = holdField(collapses);
  const dis = dissent(field);
  const z = observeField(zPrior, field, dis);
  const prediction = axis17(field, dis, z);
  return { field, dissent: dis, z, prediction };
}

// ── LLM orchestrator (best-effort, SHADOW) ───────────────────
// Fires the real Falcon axes tier by tier, collapsing each in order, then
// holds them in dissent and predicts with Axis 17. Persists to elle_spine_runs.
// Nothing here gates a real decision.
const COLLAPSE_SYSTEM = (tier: number) =>
  `You are the COLLAPSE of Tier ${tier} in the Spine decision engine. You receive this tier's axis outputs${tier > 1 ? ' and the prior tier collapse' : ''}. Resolve them into ONE earned tier-collapse: the single thesis this tier's evidence supports, a signed direction (−1 strongly bearish/against … +1 strongly bullish/for the proposition), and a confidence in [0,1]. Do not hedge into neutrality unless the evidence is genuinely balanced.
Respond ONLY with JSON: {"thesis":"2-3 sentences","direction":0.0,"confidence":0.0,"claims":["3-4 load-bearing claims"]}`;

const AXIS17_SYSTEM =
  `You are AXIS 17 — the Future Axis of the Spine. You receive three tier-collapses held in dissent (NOT merged) and the dissent report. Do not re-collapse them by fiat. PREDICT: given how the field coheres and where it splits, what happens next, and on what horizon. Name what would confirm or break the prediction. The numeric gate is computed separately from the regulator — you supply the narrative and the horizon only.
Respond ONLY with JSON: {"prediction":"3-4 sentences of what happens next","horizon":"the timescale","confirms_if":"what would confirm it","breaks_if":"what would break it"}`;

async function runTierCollapse(
  env: SpineEnv, tier: 1 | 2 | 3, axisSummary: string, priorCollapse: TierCollapse | null,
): Promise<TierCollapse> {
  const user = priorCollapse
    ? `Tier ${tier} axis outputs:\n${axisSummary}\n\nPrior tier collapse:\n${JSON.stringify(priorCollapse)}`
    : `Tier ${tier} axis outputs:\n${axisSummary}`;
  const res = await callLLM('reasoning', COLLAPSE_SYSTEM(tier), [{ role: 'user', content: user }], 700, env);
  const p = parseFirstJson(res.content) || {};
  return {
    tier,
    thesis: String((p as Record<string, unknown>).thesis || '').slice(0, 800),
    direction: clampSigned(Number((p as Record<string, unknown>).direction)),
    confidence: clamp01(Number((p as Record<string, unknown>).confidence)),
    claims: Array.isArray((p as Record<string, unknown>).claims) ? ((p as Record<string, unknown>).claims as unknown[]).map(String).slice(0, 6) : [],
  };
}

export async function runSpine(env: SpineEnv, direction: string, zPrior = 0): Promise<{
  collapses: TierCollapse[]; outcome: SpineOutcome; narrative: unknown;
}> {
  const base = `Proposition / direction under decision: "${direction}"`;

  // Tier 1 — Material Ground → collapse 1.
  const t1 = await Promise.all(TIER1_AXES.map(async a => {
    const r = await callLLM('fast', a.system, [{ role: 'user', content: base }], 500, env);
    return `AXIS ${a.n} — ${a.label}: ${JSON.stringify(parseFirstJson(r.content) || { raw: r.content.slice(0, 200) })}`;
  }));
  const c1 = await runTierCollapse(env, 1, t1.join('\n\n'), null);

  // Tier 2 — Observer Reading (reads collapse 1) → collapse 2.
  const t2Prompt = `${base}\n\nCollapse 1 (Material Ground):\n${JSON.stringify(c1)}`;
  const t2 = await Promise.all(TIER2_AXES.map(async a => {
    const r = await callLLM('fast', a.system, [{ role: 'user', content: t2Prompt }], 550, env);
    return `AXIS ${a.n} — ${a.label}: ${JSON.stringify(parseFirstJson(r.content) || { raw: r.content.slice(0, 200) })}`;
  }));
  const c2 = await runTierCollapse(env, 2, t2.join('\n\n'), c1);

  // Tier 3 — Validation (reads collapse 2) → collapse 3.
  const c3 = await runTierCollapse(env, 3,
    `Adversarially validate collapses 1 and 2, then resolve Tier 3.\nCollapse 1: ${JSON.stringify(c1)}\nCollapse 2: ${JSON.stringify(c2)}`, c2);

  const collapses = [c1, c2, c3];
  const outcome = runSpinePure(collapses, zPrior);

  // Axis 17 narrative (the numbers already came from runSpinePure).
  const a17 = await callLLM('reasoning', AXIS17_SYSTEM,
    [{ role: 'user', content: `Held field (dissent, not merged):\n${JSON.stringify(collapses)}\n\nDissent report:\n${JSON.stringify(outcome.dissent)}\n\nRegulator κ=${outcome.prediction.kappa.toFixed(3)}, gate=${outcome.prediction.gate}.` }],
    900, env).catch(() => null);
  const narrative = a17 ? (parseFirstJson(a17.content) || { raw: a17.content.slice(0, 400) }) : null;

  await ensureSpineSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO elle_spine_runs (id, direction, collapses_json, dissent_json, z, kappa, gate, prediction_json, created_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
  ).bind(
    crypto.randomUUID().replace(/-/g, '').slice(0, 16), direction.slice(0, 500),
    JSON.stringify(collapses).slice(0, 40000), JSON.stringify(outcome.dissent).slice(0, 8000),
    outcome.z, outcome.prediction.kappa, outcome.prediction.gate,
    JSON.stringify({ ...outcome.prediction, narrative }).slice(0, 20000),
  ).run().catch(() => {});

  return { collapses, outcome, narrative };
}

export async function ensureSpineSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_spine_runs (
       id TEXT PRIMARY KEY, direction TEXT,
       collapses_json TEXT, dissent_json TEXT,
       z REAL, kappa REAL, gate TEXT, prediction_json TEXT,
       created_at TEXT
     )`,
  ).run();
}

// Persistent regulator state per decision domain, so conviction accrues across
// runs (parallel to elle_conviction for positions). Read the last z for a
// domain, run the spine, persist the new z. Best-effort.
export async function domainZ(db: D1Database, domain: string): Promise<number> {
  const row = await db.prepare(
    `SELECT z FROM elle_spine_runs WHERE direction = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(domain).first().catch(() => null) as { z?: number } | null;
  return row && Number.isFinite(Number(row.z)) ? Number(row.z) : 0;
}

// A convenience for callers that want the regulator to be a fresh, in-memory
// instrument (e.g. a batch of collapses stepped at once).
export function freshDecisionRegulator() {
  return createAsymmetricRegulator();
}

// ── the handler — /api/spine (SHADOW; analysis + prediction, gates nothing) ──
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

export async function handleSpine(body: Record<string, unknown>, env: SpineEnv, _userId: string): Promise<Response> {
  const action = String(body.action || 'run');

  if (action === 'run') {
    const direction = String(body.direction || '').trim();
    if (!direction) return json({ error: 'direction required — the proposition to decide on (a market, a trade, a question)' }, 400);
    if (direction.length > 2000) return json({ error: 'direction too long (2000 char max)' }, 400);
    // Conviction accrues across runs on the same proposition (parallel to a
    // position's regulator persisting across cron cycles): resume the last z.
    const zPrior = await domainZ(env.DB, direction);
    const { collapses, outcome, narrative } = await runSpine(env, direction, zPrior);
    return json({
      direction,
      collapses,
      dissent: outcome.dissent,
      prediction: outcome.prediction,
      narrative,
      note: 'SHADOW — Axis 17 predicts; conviction κ accrues across repeated runs on this proposition. Gates no real decision until measured.',
    });
  }

  if (action === 'history') {
    await ensureSpineSchema(env.DB);
    const direction = String(body.direction || '').trim();
    const rows = direction
      ? await env.DB.prepare(`SELECT id, direction, z, kappa, gate, created_at FROM elle_spine_runs WHERE direction = ? ORDER BY created_at DESC LIMIT 50`).bind(direction).all().catch(() => ({ results: [] }))
      : await env.DB.prepare(`SELECT id, direction, z, kappa, gate, created_at FROM elle_spine_runs ORDER BY created_at DESC LIMIT 50`).all().catch(() => ({ results: [] }));
    return json({ runs: rows.results || [] });
  }

  return json({ error: `unknown action "${action}" (run|history)` }, 400);
}
