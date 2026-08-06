// ============================================================
// THE GRANT INTELLIGENCE ENGINE — src/grant-intelligence.ts
// Module 1 (Research/Fit) + the NECAI-F donor sub-engine
//
// Spec: corpus/engines/03-grant-intelligence.md (Engine #3, verbatim).
// Unification across the nonprofit and small-business tracks:
// docs/GRANT_INTELLIGENCE_SUITE_MAP.md. Schema: src/db/schema.ts (grant_*).
//
// The grant DATA layer — ingestion, verification, dedup, and maintenance of
// grant_opportunities and grant_funder_990_overview, plus multimodal
// (vision) intake — lives entirely in the GrantIntelligence repo's
// grant-worker now (workers/grant-worker/), NOT here. This file only
// REASONS over that data: it reads grant_opportunities via a direct D1
// binding (env.GRANT_DB, wrangler.toml — same native-binding pattern as
// RAPID_DB) and writes its own analysis to elle-worker's OWN tables
// (grant_organizations, grant_fit_analyses, grant_necaif_evaluations,
// grant_reasoning_log). Nothing here ingests, seeds, or fetches external
// grant data — that would reintroduce exactly the cross-worker dependency
// this split was built to eliminate. See docs/GRANT_INTELLIGENCE_SUITE_MAP.md
// for the full history of what moved and why.
//
// What this file builds, in spec order:
//   - runFitAnalysis      — the Statistical Fit Index (spec §V), reasoning
//     over the applicant profile + opportunity + past recipient rows
//     already on file. No live web search here: the opportunity/recipient
//     data IS the material ground for a fit read.
//   - runNecaifEvaluation — the NECAI-F donor sub-engine (spec §III), gated
//     to funder_type IN ('foundation','corporate') per the map doc's rule
//     (federal agencies/accelerators are never NECAI-F-evaluated). THIS one
//     DOES need real grounding — the six criteria are documented-fact
//     questions about the funder — so it runs one 'research' (search-
//     grounded) sweep before synthesis, and explicitly flags unknowns
//     rather than inventing evidence if the sweep comes back empty.
//
// Every reasoning chain writes to grant_reasoning_log (spec §IV — the
// primary training corpus): factual premises separate from the
// philosophical framework, alternatives considered and rejected, what
// would change the conclusion. No `recommendation` field anywhere — the
// engine presents, the applicant decides (spec's explicit design rule).
// ============================================================

import { z } from 'zod';
import { ensureAllSchemas } from './db/schema';
import { callLLM, jsonLLM, type LLMEnv } from './llm';

export interface GrantEnv extends LLMEnv {
  DB: D1Database;
  GRANT_DB?: D1Database;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

type FunderType = 'federal' | 'state' | 'foundation' | 'corporate' | 'international' | 'accelerator';

// grant-worker's D1 binding is optional in the type (Cloudflare bindings are
// always technically "configurable or not"), but every action below needs
// it — fail with a clear, specific error rather than a null-deref if it's
// ever missing from wrangler.toml.
function requireGrantDb(env: GrantEnv): D1Database {
  if (!env.GRANT_DB) throw new Error('GRANT_DB binding not configured — see wrangler.toml (grant-intelligence-db)');
  return env.GRANT_DB;
}

// ── Module 1: Statistical Fit Index (spec §V) ──────────────────────────────
const FitAnalysisSchema = z.object({
  fit_index: z.number().min(0).max(1),
  confidence_interval: z.string(),
  features: z.object({
    mission_area_overlap: z.string(),
    org_type_match: z.string(),
    budget_range_fit: z.string(),
    geographic_scope_fit: z.string(),
    prior_relationship: z.string(),
  }),
  disclosure: z.object({
    methodology: z.string(),
    data_sources: z.string(),
    what_this_does_not_capture: z.string(),
    decision_belongs_to_org: z.string(),
  }),
  reasoning: z.object({
    factual_premises: z.array(z.string()),
    factual_gaps: z.array(z.string()),
    philosophical_framework: z.string(),
    philosophical_chain: z.string(),
    synthesis: z.string(),
    alternatives_considered: z.array(z.string()),
    what_would_change_this: z.string(),
  }),
});
type FitAnalysis = z.infer<typeof FitAnalysisSchema>;

const FIT_SYSTEM = `You are the Grant Intelligence Engine's Fit Analysis module (corpus/engines/03-grant-intelligence.md §V — the Statistical Fit Index). You are given an applicant organization profile, a grant opportunity, and whatever past-recipient data is on file for that opportunity.

Score fit across five documented features: mission-area overlap, org-type match, budget-range fit, geographic-scope fit, and prior-relationship history. The fit_index (0-1) describes HISTORICAL PATTERNS ONLY — it does not predict this organization's outcome. Say so explicitly in the disclosure, along with the data sources used and what the index does not capture.

There is no "recommendation" field and you must not write one — you present a structural reading; the organization decides (this is a hard constraint of the spec, not a style preference). Every reasoning chain shows its factual premises separately from the philosophical/structural framework applied (NECAI-F discipline, spec §IV), names at least one alternative conclusion you considered and rejected, and states what evidence would change this conclusion. If past-recipient data is empty or thin, say so plainly in factual_gaps rather than inferring a confident score from nothing.`;

export async function runFitAnalysis(
  env: GrantEnv, orgId: string, opportunityId: string,
): Promise<{ fitAnalysisId: string; reasoningLogId: string; data: FitAnalysis }> {
  await ensureAllSchemas(env.DB);
  const grantDb = requireGrantDb(env);
  const org = await env.DB.prepare(`SELECT * FROM grant_organizations WHERE id = ?`).bind(orgId).first();
  if (!org) throw new Error(`grant_organizations: no row for id "${orgId}"`);
  const opp = await grantDb.prepare(`SELECT * FROM grant_opportunities WHERE id = ?`).bind(opportunityId).first();
  if (!opp) throw new Error(`grant_opportunities: no row for id "${opportunityId}"`);
  const recipients = await grantDb.prepare(
    `SELECT recipient_type_profile, award_amount, award_year FROM grant_recipients WHERE opportunity_id = ? ORDER BY award_year DESC LIMIT 20`
  ).bind(opportunityId).all().catch(() => ({ results: [] }));
  const recipientRows = recipients.results || [];

  const prompt = `APPLICANT ORGANIZATION:\n${JSON.stringify(org)}\n\nOPPORTUNITY:\n${JSON.stringify(opp)}\n\nPAST RECIPIENT DATA (${recipientRows.length} rows — the statistical ground; empty means no recipient data is on file yet, not that fit is zero):\n${JSON.stringify(recipientRows)}\n\nProduce the fit analysis.`;

  const { data } = await jsonLLM(env, prompt, FitAnalysisSchema, { system: FIT_SYSTEM, task: 'reasoning', maxTokens: 1700 });

  const fitAnalysisId = id();
  const reasoningLogId = id();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO grant_fit_analyses (id, org_id, opportunity_id, fit_index, confidence_interval, sample_size, reasoning_log_id) VALUES (?,?,?,?,?,?,?)`
    ).bind(fitAnalysisId, orgId, opportunityId, data.fit_index, data.confidence_interval, recipientRows.length, reasoningLogId),
    env.DB.prepare(
      `INSERT INTO grant_reasoning_log (id, subject_id, subject_type, conclusion, factual_premises_json, factual_gaps, philosophical_framework, philosophical_chain, synthesis, alternatives_considered, what_would_change_this)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      reasoningLogId, fitAnalysisId, 'grant_fit_analysis',
      `fit_index=${data.fit_index} for org ${orgId} × opportunity ${opportunityId}`,
      JSON.stringify(data.reasoning.factual_premises), JSON.stringify(data.reasoning.factual_gaps),
      data.reasoning.philosophical_framework, data.reasoning.philosophical_chain, data.reasoning.synthesis,
      JSON.stringify(data.reasoning.alternatives_considered), data.reasoning.what_would_change_this,
    ),
  ]);

  return { fitAnalysisId, reasoningLogId, data };
}

// ── The NECAI-F donor sub-engine (spec §III) ────────────────────────────────
// Gated to foundation/corporate funders only (map doc: federal agencies, state
// programs, and accelerators are never evaluated for donor-ethics risk).
const NECAIF_FUNDER_TYPES: FunderType[] = ['foundation', 'corporate'];

const NecaifSchema = z.object({
  revenue_mechanism: z.string(),
  narrative_capture_history: z.string(),
  editorial_conditions: z.string(),
  mission_alignment: z.string(),
  trust_of_affected_populations: z.string(),
  documented_networks: z.string(),
  observer_position: z.string(),
  unknowns: z.string(),
});
type NecaifEvaluation = z.infer<typeof NecaifSchema>;

const NECAIF_SYSTEM = `You are the NECAI-F donor sub-engine (corpus/engines/03-grant-intelligence.md §III). Evaluate ONE funder against six structural criteria, sourced to public documents:
1. Revenue mechanism — does primary revenue operate a documented corpus mechanism?
2. Narrative capture history — documented use of philanthropy to shape public narrative?
3. Editorial conditions — any strings attached to awards?
4. Mission alignment — genuine governance and values alignment?
5. Trust of affected populations — would people submitting threshold accounts trust this funder?
6. Documented networks — any documented Epstein-network, intelligence-funding, or reputation-management-foundation connections?

You make NO legal judgments. Present documented structural information with sources for each criterion. If the evidence gathered below is thin or absent for a criterion, say exactly that in that criterion's answer AND in "unknowns" — never invent a source or a connection that was not actually surfaced. The Observer position is your read of what both the funder's own narrative and its critics suppress, not a verdict.`;

export async function runNecaifEvaluation(
  env: GrantEnv, opportunityId: string,
): Promise<{ evaluationId: string; data: NecaifEvaluation; alreadySealed: boolean }> {
  await ensureAllSchemas(env.DB);
  const grantDb = requireGrantDb(env);
  const opp = await grantDb.prepare(
    `SELECT id, funder_name, funder_type FROM grant_opportunities WHERE id = ?`
  ).bind(opportunityId).first() as { id: string; funder_name: string; funder_type: string } | null;
  if (!opp) throw new Error(`grant_opportunities: no row for id "${opportunityId}"`);
  if (!NECAIF_FUNDER_TYPES.includes(opp.funder_type as FunderType)) {
    throw new Error(`NECAI-F only evaluates foundation/corporate funders — "${opp.funder_name}" is funder_type="${opp.funder_type}"`);
  }

  // Immutable once sealed (spec §IX) — return the existing row rather than
  // re-running the sweep and LLM call.
  const existing = await env.DB.prepare(`SELECT * FROM grant_necaif_evaluations WHERE opportunity_id = ?`).bind(opportunityId).first();
  if (existing) {
    const row = existing as Record<string, unknown>;
    return {
      evaluationId: String(row.id),
      alreadySealed: true,
      data: {
        revenue_mechanism: String(row.revenue_mechanism || ''),
        narrative_capture_history: String(row.narrative_capture_history || ''),
        editorial_conditions: String(row.editorial_conditions || ''),
        mission_alignment: String(row.mission_alignment || ''),
        trust_of_affected_populations: String(row.trust_of_affected_populations || ''),
        documented_networks: String(row.documented_networks || ''),
        observer_position: String(row.observer_position || ''),
        unknowns: String(row.unknowns || ''),
      },
    };
  }

  // Real grounding: a search-task sweep for documented facts (spec §VII —
  // "sourced to public documents"). Best-effort — an outage doesn't block
  // the evaluation, it just means every criterion gets flagged unknown.
  let searchProse = '';
  try {
    const sweep = await callLLM(
      'research',
      `Gather documented, sourced, public facts about the funder "${opp.funder_name}" relevant to: its revenue mechanism, any narrative-capture history, editorial conditions attached to its grants, mission/governance alignment, trust among affected communities, and any documented Epstein-network, intelligence-funding, or reputation-management-foundation connections. Cite a source for every claim.`,
      [{ role: 'user', content: `Funder: ${opp.funder_name}` }],
      1400, env,
    );
    searchProse = (sweep.search_results?.trim() || sweep.content || '').slice(0, 6000);
  } catch { /* proceed ungrounded — NECAIF_SYSTEM instructs flagging unknowns */ }

  const prompt = `Funder: ${opp.funder_name} (${opp.funder_type})\n\nSearch-grounded evidence gathered:\n${searchProse || '(no search evidence returned — flag every criterion as unverified in "unknowns")'}\n\nEvaluate against the six criteria.`;
  const { data } = await jsonLLM(env, prompt, NecaifSchema, { system: NECAIF_SYSTEM, task: 'reasoning', maxTokens: 1800 });

  const evaluationId = id();
  const reasoningLogId = id();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO grant_necaif_evaluations (id, opportunity_id, revenue_mechanism, narrative_capture_history, editorial_conditions, mission_alignment, trust_of_affected_populations, documented_networks, observer_position, evidence_json, unknowns, sealed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(
      evaluationId, opportunityId, data.revenue_mechanism, data.narrative_capture_history, data.editorial_conditions,
      data.mission_alignment, data.trust_of_affected_populations, data.documented_networks, data.observer_position,
      searchProse, data.unknowns,
    ),
    env.DB.prepare(
      `INSERT INTO grant_reasoning_log (id, subject_id, subject_type, conclusion, factual_gaps, philosophical_framework, synthesis, necaif_self_check)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      reasoningLogId, evaluationId, 'grant_necaif_evaluation',
      `NECAI-F evaluation sealed for ${opp.funder_name}`, data.unknowns, 'NECAI-F v2', data.observer_position,
      'no legal judgment rendered; six criteria answered or explicitly flagged unknown',
    ),
  ]);

  return { evaluationId, data, alreadySealed: false };
}

// ── DB bootstrap — guarded, self-healing (house style, war-room.ts) ────────
let grantSchemaReady = false;
async function ensureGrantSchema(env: GrantEnv): Promise<void> {
  if (grantSchemaReady) return;
  await ensureAllSchemas(env.DB);
  grantSchemaReady = true;
}

// ── The handler — /api/elle-grants ──────────────────────────────────────────
export async function handleGrantIntelligence(body: Record<string, unknown>, env: GrantEnv, userId: string): Promise<Response> {
  await ensureGrantSchema(env);
  const action = String(body.action || '');

  if (action === 'create_organization') {
    const name = String(body.name || '').trim();
    if (!name) return json({ error: 'name required' }, 400);
    const track = body.track === 'business' ? 'business' : 'nonprofit';
    const orgId = id();
    await env.DB.prepare(
      `INSERT INTO grant_organizations (id, user_id, name, track, org_type, mission, budget_range, geographic_scope, entity_stage)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      orgId, userId, name.slice(0, 300), track,
      body.org_type ? String(body.org_type).slice(0, 100) : null,
      body.mission ? String(body.mission).slice(0, 2000) : null,
      body.budget_range ? String(body.budget_range).slice(0, 100) : null,
      body.geographic_scope ? String(body.geographic_scope).slice(0, 200) : null,
      body.entity_stage ? String(body.entity_stage).slice(0, 100) : null,
    ).run();
    return json({ org_id: orgId, track });
  }

  // Read-only — sourced from the grant-worker's D1 database (GRANT_DB), not
  // owned here. See requireGrantDb()'s comment.
  if (action === 'list_opportunities') {
    const grantDb = requireGrantDb(env);
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const funderType = body.funder_type ? String(body.funder_type) : null;
    const rows = funderType
      ? await grantDb.prepare(
          `SELECT id, source, funder_name, funder_type, program_name, amount_min, amount_max, deadline, necaif_applicable, status
           FROM grant_opportunities WHERE status = 'open' AND funder_type = ? ORDER BY deadline ASC LIMIT ?`
        ).bind(funderType, limit).all().catch(() => ({ results: [] }))
      : await grantDb.prepare(
          `SELECT id, source, funder_name, funder_type, program_name, amount_min, amount_max, deadline, necaif_applicable, status
           FROM grant_opportunities WHERE status = 'open' ORDER BY deadline ASC LIMIT ?`
        ).bind(limit).all().catch(() => ({ results: [] }));
    return json({ opportunities: rows.results || [] });
  }

  if (action === 'fit_analysis') {
    const orgId = String(body.org_id || '');
    const opportunityId = String(body.opportunity_id || '');
    if (!orgId || !opportunityId) return json({ error: 'org_id and opportunity_id required' }, 400);
    try {
      const { fitAnalysisId, data } = await runFitAnalysis(env, orgId, opportunityId);
      return json({ fit_analysis_id: fitAnalysisId, ...data });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }

  if (action === 'get_fit_analysis') {
    const fitAnalysisId = String(body.fit_analysis_id || '');
    if (!fitAnalysisId) return json({ error: 'fit_analysis_id required' }, 400);
    const row = await env.DB.prepare(`SELECT * FROM grant_fit_analyses WHERE id = ?`).bind(fitAnalysisId).first();
    if (!row) return json({ error: 'not found' }, 404);
    const logId = (row as Record<string, unknown>).reasoning_log_id as string | null;
    const reasoning = logId ? await env.DB.prepare(`SELECT * FROM grant_reasoning_log WHERE id = ?`).bind(logId).first() : null;
    return json({ fit_analysis: row, reasoning });
  }

  if (action === 'necaif_evaluation') {
    const opportunityId = String(body.opportunity_id || '');
    if (!opportunityId) return json({ error: 'opportunity_id required' }, 400);
    try {
      const { evaluationId, data, alreadySealed } = await runNecaifEvaluation(env, opportunityId);
      return json({ evaluation_id: evaluationId, already_sealed: alreadySealed, ...data });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }

  // Read-only — sourced from the grant-worker's D1 database. The FETCH from
  // ProPublica (and the write) now happens exclusively in the grant-worker
  // (see workers/grant-worker/src/grant-990.ts in the GrantIntelligence repo).
  if (action === 'get_990_overview') {
    const grantDb = requireGrantDb(env);
    const funderName = String(body.funder_name || '').trim();
    if (!funderName) return json({ error: 'funder_name required' }, 400);
    const row = await grantDb.prepare(`SELECT * FROM grant_funder_990_overview WHERE funder_name = ?`).bind(funderName).first();
    if (!row) return json({ error: 'not found' }, 404);
    return json({ overview: row });
  }

  return json({
    error: `unknown action "${action}" (create_organization|list_opportunities|fit_analysis|get_fit_analysis|necaif_evaluation|get_990_overview)`,
  }, 400);
}
