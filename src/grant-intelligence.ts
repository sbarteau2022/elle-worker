// ============================================================
// THE GRANT INTELLIGENCE ENGINE — src/grant-intelligence.ts
// Module 1 (Research/Fit) + the NECAI-F donor sub-engine
//
// Spec: corpus/engines/03-grant-intelligence.md (Engine #3, verbatim).
// Unification across the nonprofit and small-business tracks:
// docs/GRANT_INTELLIGENCE_SUITE_MAP.md. Schema: src/db/schema.ts (grant_*).
//
// What this file builds, in spec order:
//   - seedOpportunities   — the manual Module 1 seed from Stewart's own
//     grant-strategy-map.md, both tracks (map doc's named first step, ahead
//     of any live Grants.gov/SBIR.gov ingest).
//   - runFitAnalysis      — the Statistical Fit Index (spec §V), reasoning
//     over the applicant profile + opportunity + past recipient rows
//     already on file. No live web search here: Module 1's own D1 data IS
//     the material ground for a fit read.
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
import { fetch990Overview, type Funder990Overview } from './grant-990';

export interface GrantEnv extends LLMEnv {
  DB: D1Database;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

// ── Seed: the opportunities already named in corpus/business/grant-strategy-map.md ──
// track_hint documents which applicant track the map named this opportunity
// under; it is NOT written to grant_opportunities (funder_type/necaif_applicable
// are the columns that actually gate behavior — see the map doc's table).
type FunderType = 'federal' | 'state' | 'foundation' | 'corporate' | 'international' | 'accelerator';
interface SeedOpportunity {
  id: string;
  funder_name: string;
  funder_type: FunderType;
  program_name: string;
  amount_min?: number;
  amount_max?: number;
  deadline?: string;
  stated_priorities?: string;
  necaif_applicable: 0 | 1;
  track_hint: 'nonprofit' | 'business';
}

export const SEED_OPPORTUNITIES: SeedOpportunity[] = [
  // Witness Model / Social Impact track (nonprofit) — grant-strategy-map.md
  { id: 'ssg-fox-fy26', funder_name: 'U.S. Dept. of Veterans Affairs', funder_type: 'federal', program_name: 'SSG Fox Suicide Prevention Grant', amount_min: 750000, amount_max: 750000, deadline: 'FY26 open', stated_priorities: 'Rural veteran focus; AI peer support in the gap between crisis and care; renewable', necaif_applicable: 0, track_hint: 'nonprofit' },
  { id: 'samhsa-recovery-fy26', funder_name: 'Substance Abuse & Mental Health Services Admin.', funder_type: 'federal', program_name: 'SAMHSA Recovery Support Grant', amount_min: 125000, deadline: 'FY26', stated_priorities: 'Substance-use recovery support tool; varies by program', necaif_applicable: 0, track_hint: 'nonprofit' },
  { id: 'bob-woodruff-rolling', funder_name: 'Bob Woodruff Foundation', funder_type: 'foundation', program_name: 'Veterans & Military Families (rolling)', deadline: 'Rolling', stated_priorities: 'Private foundation, faster than federal; no nonprofit required from the applicant', necaif_applicable: 1, track_hint: 'nonprofit' },
  // Groundwork / Commercial track (business) — grant-strategy-map.md
  { id: 'mtc-idea-jul26', funder_name: 'Missouri Technology Corporation', funder_type: 'state', program_name: 'MTC IDEA Fund — July 2026 cycle', amount_max: 5800000, deadline: '2026-05-05', stated_priorities: 'Missouri-based; provisional patent satisfies IP requirement; needs a lead investor', necaif_applicable: 0, track_hint: 'business' },
  { id: 'arch-grants-rolling', funder_name: 'Arch Grants', funder_type: 'accelerator', program_name: 'Arch Grants — St. Louis', amount_min: 75000, amount_max: 75000, deadline: 'Rolling', stated_priorities: 'Equity-free; no institutional requirements beyond LLC formation; St. Louis presence', necaif_applicable: 0, track_hint: 'business' },
  { id: 'mozilla-ai-2026', funder_name: 'Mozilla Foundation', funder_type: 'foundation', program_name: 'Mozilla Democracy × AI Incubator', amount_max: 300000, deadline: '2026', stated_priorities: 'Information ecosystem resilience; community-led AI governance; top 2 of 10 advance', necaif_applicable: 1, track_hint: 'business' },
  { id: 'mcgovern-emergent-ai', funder_name: 'Patrick J. McGovern Foundation', funder_type: 'foundation', program_name: 'Emergent AI', amount_min: 250000, deadline: 'Prep now — letter of inquiry', stated_priorities: 'Emergent AI for public benefit; prior awards $250k-$600k in this space in 2026', necaif_applicable: 1, track_hint: 'business' },
  { id: 'open-phil-ai-safety', funder_name: 'Open Philanthropy Project', funder_type: 'foundation', program_name: 'AI Safety RFP', amount_max: 40000000, deadline: 'Rolling', stated_priorities: '$40M committed across AI-safety directions (2025 cycle); theoretical-alignment track', necaif_applicable: 1, track_hint: 'business' },
  { id: 'nsf-sbir-ai', funder_name: 'National Science Foundation', funder_type: 'federal', program_name: 'NSF SBIR — AI Track', amount_max: 2000000, deadline: 'Paused — reauthorization pending', stated_priorities: 'Non-dilutive, no equity; Human-Computer Interaction track', necaif_applicable: 0, track_hint: 'business' },
];

// Idempotent upsert — safe to re-run as grant-strategy-map.md is updated by hand.
export async function seedOpportunities(env: GrantEnv): Promise<{ inserted: number; updated: number }> {
  await ensureAllSchemas(env.DB);
  let inserted = 0, updated = 0;
  for (const o of SEED_OPPORTUNITIES) {
    const existing = await env.DB.prepare(`SELECT id FROM grant_opportunities WHERE id = ?`).bind(o.id).first();
    await env.DB.prepare(
      `INSERT INTO grant_opportunities (id, source, funder_name, funder_type, program_name, amount_min, amount_max, deadline, stated_priorities, necaif_applicable, status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'open')
       ON CONFLICT(id) DO UPDATE SET
         funder_name=excluded.funder_name, funder_type=excluded.funder_type, program_name=excluded.program_name,
         amount_min=excluded.amount_min, amount_max=excluded.amount_max, deadline=excluded.deadline,
         stated_priorities=excluded.stated_priorities, necaif_applicable=excluded.necaif_applicable,
         updated_at=datetime('now')`
    ).bind(
      o.id, 'grant-strategy-map', o.funder_name, o.funder_type, o.program_name,
      o.amount_min ?? null, o.amount_max ?? null, o.deadline ?? null, o.stated_priorities ?? null, o.necaif_applicable,
    ).run();
    if (existing) updated++; else inserted++;
  }
  return { inserted, updated };
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
  const org = await env.DB.prepare(`SELECT * FROM grant_organizations WHERE id = ?`).bind(orgId).first();
  if (!org) throw new Error(`grant_organizations: no row for id "${orgId}"`);
  const opp = await env.DB.prepare(`SELECT * FROM grant_opportunities WHERE id = ?`).bind(opportunityId).first();
  if (!opp) throw new Error(`grant_opportunities: no row for id "${opportunityId}"`);
  const recipients = await env.DB.prepare(
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
  const opp = await env.DB.prepare(
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

// ── 990-PF financial overview (spec §II Module 1) ──────────────────────────
// One row per funder_name, replaced on re-fetch — a filing-year snapshot, not
// an append-only series (grant_reasoning_log is where history-of-conclusions
// belongs; this is just the current picture).
async function persist990Overview(env: GrantEnv, overview: Funder990Overview): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO grant_funder_990_overview
       (funder_name, ein, ntee_code, city, state, most_recent_filing_year,
        total_revenue_cents, total_expenses_cents, total_assets_end_cents, total_liabilities_end_cents,
        contributions_gifts_grants_cents, program_revenue_cents, pdf_only_filing_years, source_url, fetched_at, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(funder_name) DO UPDATE SET
       ein=excluded.ein, ntee_code=excluded.ntee_code, city=excluded.city, state=excluded.state,
       most_recent_filing_year=excluded.most_recent_filing_year,
       total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
       total_assets_end_cents=excluded.total_assets_end_cents, total_liabilities_end_cents=excluded.total_liabilities_end_cents,
       contributions_gifts_grants_cents=excluded.contributions_gifts_grants_cents,
       program_revenue_cents=excluded.program_revenue_cents, pdf_only_filing_years=excluded.pdf_only_filing_years,
       source_url=excluded.source_url, fetched_at=excluded.fetched_at, error=NULL`
  ).bind(
    overview.funderName, overview.ein, overview.nteeCode, overview.city, overview.state, overview.mostRecentFilingYear,
    overview.totalRevenueCents, overview.totalExpensesCents, overview.totalAssetsEndCents, overview.totalLiabilitiesEndCents,
    overview.contributionsGiftsGrantsCents, overview.programRevenueCents,
    JSON.stringify(overview.pdfOnlyFilingYears), overview.sourceUrl, overview.fetchedAt,
  ).run();
}

async function persist990Error(env: GrantEnv, funderName: string, errorMessage: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO grant_funder_990_overview (funder_name, fetched_at, error) VALUES (?,?,?)
     ON CONFLICT(funder_name) DO UPDATE SET fetched_at=excluded.fetched_at, error=excluded.error`
  ).bind(funderName, new Date().toISOString(), errorMessage).run();
}

// Run + persist for one funder. Returns the overview (or the error) so both
// the single-funder and the "all named foundations" actions share one path.
export async function run990Overview(
  env: GrantEnv, funderName: string, einOverride?: string,
): Promise<Funder990Overview | { error: string }> {
  const result = await fetch990Overview(funderName, einOverride);
  if ('error' in result) { await persist990Error(env, funderName, result.error); return result; }
  await persist990Overview(env, result);
  return result;
}

// The spec's "every major private foundation" — every DISTINCT funder_name
// already seeded under funder_type IN ('foundation','corporate') (the only
// types NECAI-F/990 analysis applies to; see the map doc's rule). Runs
// sequentially (ProPublica has no documented bulk endpoint and this is a
// handful of funders, not hundreds) so one slow/failing lookup doesn't race
// another's write to the same PRIMARY KEY-per-name row.
export async function run990OverviewForAllFunders(
  env: GrantEnv,
): Promise<{ funderName: string; result: Funder990Overview | { error: string } }[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT funder_name FROM grant_opportunities WHERE funder_type IN ('foundation','corporate') ORDER BY funder_name`
  ).all<{ funder_name: string }>().catch(() => ({ results: [] }));
  const out: { funderName: string; result: Funder990Overview | { error: string } }[] = [];
  for (const row of rows.results ?? []) {
    out.push({ funderName: row.funder_name, result: await run990Overview(env, row.funder_name) });
  }
  return out;
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

  if (action === 'seed_opportunities') {
    return json(await seedOpportunities(env));
  }

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

  if (action === 'list_opportunities') {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const funderType = body.funder_type ? String(body.funder_type) : null;
    const rows = funderType
      ? await env.DB.prepare(
          `SELECT id, source, funder_name, funder_type, program_name, amount_min, amount_max, deadline, necaif_applicable, status
           FROM grant_opportunities WHERE status = 'open' AND funder_type = ? ORDER BY deadline ASC LIMIT ?`
        ).bind(funderType, limit).all().catch(() => ({ results: [] }))
      : await env.DB.prepare(
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

  if (action === 'funder_990_overview') {
    const funderName = String(body.funder_name || '').trim();
    if (!funderName) return json({ error: 'funder_name required' }, 400);
    const ein = body.ein ? String(body.ein) : undefined;
    const result = await run990Overview(env, funderName, ein);
    if ('error' in result) return json({ funder_name: funderName, ...result }, 502);
    return json({ overview: result });
  }

  if (action === 'funder_990_overview_all') {
    const results = await run990OverviewForAllFunders(env);
    return json({
      funders: results.length,
      succeeded: results.filter((r) => !('error' in r.result)).length,
      results,
    });
  }

  if (action === 'get_990_overview') {
    const funderName = String(body.funder_name || '').trim();
    if (!funderName) return json({ error: 'funder_name required' }, 400);
    const row = await env.DB.prepare(`SELECT * FROM grant_funder_990_overview WHERE funder_name = ?`).bind(funderName).first();
    if (!row) return json({ error: 'not found' }, 404);
    return json({ overview: row });
  }

  return json({
    error: `unknown action "${action}" (seed_opportunities|create_organization|list_opportunities|fit_analysis|get_fit_analysis|necaif_evaluation|funder_990_overview|funder_990_overview_all|get_990_overview)`,
  }, 400);
}
