// ============================================================
// LIVE GRANT OPPORTUNITY INGEST — src/grant-ingest.ts
//
// Module 1's "next real work" per docs/GRANT_INTELLIGENCE_SUITE_MAP.md's own
// "Not built" list: a scheduled ingest that keeps grant_opportunities
// current from real sources, instead of the one-time manual seed
// (seedOpportunities in grant-intelligence.ts, hand-copied from
// corpus/business/grant-strategy-map.md).
//
// Two free, keyless federal sources, narrowed to the funders/topics
// grant-strategy-map.md actually names — this is NOT a full-catalog pull:
//   - Grants.gov search2 API  — VA, HHS/SAMHSA, NSF; veteran/recovery/AI terms
//   - SBIR.gov public solicitations API — NSF, open only (map doc names NSF
//     SBIR's AI/HCI track specifically)
//
// Neither source covers the private foundations/accelerators the map doc
// also names (Bob Woodruff, Arch Grants, Mozilla, McGovern, Open
// Philanthropy) — those have no public opportunity-search API at all and
// stay sourced by hand (seedOpportunities) or via RAPIDAi's atlas-capture
// browser extension's grants plugin (operator-driven, by design not
// automated — see apps/atlas-capture in the RAPIDAi repo).
//
// "Maintainer of the db," not just an inserter: each run also closes any
// previously-open row from a source that fetched cleanly this run but no
// longer contains that row (it closed/expired/withdrew upstream). A source
// that errored this run is left alone entirely — a transient API outage
// must never read as "everything from that source just closed."
//
// This sandbox's outbound network policy blocks both api.grants.gov and
// api.www.sbir.gov, so these request/response shapes are best-effort from
// public API documentation, NOT verified against a live response.
// Normalization is deliberately defensive (every field optional, nothing
// throws on an unexpected shape) so a documentation mismatch degrades to
// "fewer fields populated," never a thrown error that takes the whole
// ingest down. Verify field names against a real response from the
// deployed Worker (unrestricted egress) before trusting amounts/deadlines.
// ============================================================

import { ensureAllSchemas } from './db/schema';

export interface GrantIngestEnv {
  DB: D1Database;
}

const USER_AGENT = 'elle-worker/grant-intelligence-live-ingest (+https://github.com/sbarteau2022/elle-worker)';

export type FunderType = 'federal' | 'state' | 'foundation' | 'corporate' | 'international' | 'accelerator';
export type LiveSource = 'grants.gov' | 'sbir.gov';

export interface NormalizedLiveOpportunity {
  id: string; // stable — derived from the source's own opportunity/solicitation number, so re-ingestion upserts rather than duplicates
  source: LiveSource;
  funder_name: string;
  funder_type: FunderType;
  program_name: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  stated_priorities: string | null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

// ── Grants.gov search2 ──────────────────────────────────────────────────
// Public POST endpoint, no key: https://www.grants.gov/api (search2).
// One query per named agency/topic slice rather than one broad pull, so a
// single slow/failing query doesn't take the others down with it.
const GRANTS_GOV_URL = 'https://api.grants.gov/v1/api/search2';
const GRANTS_GOV_QUERIES: Array<{ agencies: string; keyword: string }> = [
  { agencies: 'VA', keyword: 'veteran suicide prevention' },
  { agencies: 'HHS-SAMHSA', keyword: 'recovery support substance use' },
  { agencies: 'NSF', keyword: 'artificial intelligence human-computer interaction' },
];

interface GrantsGovHit {
  id?: number | string;
  number?: string;
  title?: string;
  agencyCode?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
}

export function normalizeGrantsGovHit(hit: GrantsGovHit): NormalizedLiveOpportunity | null {
  const number = str(hit.number) ?? (hit.id != null ? String(hit.id) : null);
  const title = str(hit.title);
  if (!number || !title) return null;
  return {
    id: `grants-gov-${number}`,
    source: 'grants.gov',
    funder_name: str(hit.agency) ?? str(hit.agencyCode) ?? 'Unknown federal agency',
    funder_type: 'federal', // every Grants.gov listing is a federal agency by construction
    program_name: title,
    // search2's hit list carries no award-ceiling figure — that lives in the
    // per-opportunity synopsis detail (a second subrequest per hit, not made
    // here to keep this a bounded, small number of calls per run).
    amount_min: null,
    amount_max: null,
    deadline: str(hit.closeDate),
    stated_priorities: null,
  };
}

export async function fetchGrantsGovOpportunities(): Promise<{ opportunities: NormalizedLiveOpportunity[]; errors: string[] }> {
  const opportunities: NormalizedLiveOpportunity[] = [];
  const errors: string[] = [];
  for (const q of GRANTS_GOV_QUERIES) {
    try {
      const res = await fetch(GRANTS_GOV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ keyword: q.keyword, agencies: q.agencies, oppStatuses: 'posted', rows: 25, startRecordNum: 0 }),
      });
      if (!res.ok) { errors.push(`grants.gov ${q.agencies}: HTTP ${res.status}`); continue; }
      const data = (await res.json().catch(() => null)) as { data?: { oppHits?: GrantsGovHit[] } } | null;
      const hits = Array.isArray(data?.data?.oppHits) ? data!.data!.oppHits! : [];
      for (const hit of hits) {
        const norm = normalizeGrantsGovHit(hit);
        if (norm) opportunities.push(norm);
      }
    } catch (e) {
      errors.push(`grants.gov ${q.agencies}: ${(e as Error).message}`);
    }
  }
  return { opportunities, errors };
}

// ── SBIR.gov public solicitations ───────────────────────────────────────
// Public GET endpoint, no key. Narrowed to NSF, open solicitations only —
// the map doc names NSF SBIR's AI/HCI track specifically, and a paused
// federal SBIR program (see the seed's own "Paused — reauthorization
// pending" row) should read as absent from an "open" filter, not an error.
const SBIR_URL = 'https://api.www.sbir.gov/public/api/solicitations?agency=NSF&open=1';

interface SbirSolicitation {
  solicitation_number?: string;
  solicitation_title?: string;
  agency?: string;
  branch?: string;
  close_date?: string;
  open_date?: string;
  current_status?: string;
}

export function normalizeSbirSolicitation(s: SbirSolicitation): NormalizedLiveOpportunity | null {
  const number = str(s.solicitation_number);
  const title = str(s.solicitation_title);
  if (!number || !title) return null;
  return {
    id: `sbir-gov-${number}`,
    source: 'sbir.gov',
    funder_name: str(s.agency) ?? 'National Science Foundation',
    funder_type: 'federal',
    program_name: title,
    amount_min: null,
    amount_max: null,
    deadline: str(s.close_date),
    stated_priorities: str(s.branch),
  };
}

export async function fetchSbirOpportunities(): Promise<{ opportunities: NormalizedLiveOpportunity[]; errors: string[] }> {
  try {
    const res = await fetch(SBIR_URL, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return { opportunities: [], errors: [`sbir.gov: HTTP ${res.status}`] };
    const data = (await res.json().catch(() => null)) as SbirSolicitation[] | null;
    const opportunities: NormalizedLiveOpportunity[] = [];
    for (const s of Array.isArray(data) ? data : []) {
      const norm = normalizeSbirSolicitation(s);
      if (norm) opportunities.push(norm);
    }
    return { opportunities, errors: [] };
  } catch (e) {
    return { opportunities: [], errors: [`sbir.gov: ${(e as Error).message}`] };
  }
}

// ── Orchestration: ingest + maintain ────────────────────────────────────
export interface GrantIngestResult {
  fetched: number;
  inserted: number;
  updated: number;
  closed: number;
  errors: string[];
}

export async function runGrantIngest(env: GrantIngestEnv): Promise<GrantIngestResult> {
  await ensureAllSchemas(env.DB);

  const [grantsGov, sbir] = await Promise.all([fetchGrantsGovOpportunities(), fetchSbirOpportunities()]);
  const opportunities = [...grantsGov.opportunities, ...sbir.opportunities];
  const errors = [...grantsGov.errors, ...sbir.errors];

  let inserted = 0;
  let updated = 0;
  const seenIds = new Set<string>();
  for (const o of opportunities) {
    seenIds.add(o.id);
    const existing = await env.DB.prepare(`SELECT id FROM grant_opportunities WHERE id = ?`).bind(o.id).first();
    // necaif_applicable is always 0 here — both sources are exclusively
    // federal agencies, and NECAI-F only ever evaluates foundation/corporate
    // funders (grant-intelligence.ts's runNecaifEvaluation enforces the same
    // gate on the other side).
    await env.DB.prepare(
      `INSERT INTO grant_opportunities (id, source, funder_name, funder_type, program_name, amount_min, amount_max, deadline, stated_priorities, necaif_applicable, status)
       VALUES (?,?,?,?,?,?,?,?,?, 0, 'open')
       ON CONFLICT(id) DO UPDATE SET
         funder_name=excluded.funder_name, funder_type=excluded.funder_type, program_name=excluded.program_name,
         amount_min=excluded.amount_min, amount_max=excluded.amount_max, deadline=excluded.deadline,
         stated_priorities=excluded.stated_priorities, status='open', updated_at=datetime('now')`
    ).bind(
      o.id, o.source, o.funder_name, o.funder_type, o.program_name,
      o.amount_min, o.amount_max, o.deadline, o.stated_priorities,
    ).run();
    if (existing) updated++; else inserted++;
  }

  // Maintain: close any previously-open row owned by a source that fetched
  // cleanly this run but no longer contains that row. A source with ANY
  // error this run is skipped entirely for closing — an outage on one of
  // three grants.gov queries must never read as "the other two queries'
  // rows all closed."
  let closed = 0;
  const cleanSources: LiveSource[] = [];
  if (grantsGov.errors.length === 0) cleanSources.push('grants.gov');
  if (sbir.errors.length === 0) cleanSources.push('sbir.gov');
  for (const source of cleanSources) {
    const openRows = await env.DB.prepare(
      `SELECT id FROM grant_opportunities WHERE source = ? AND status = 'open'`
    ).bind(source).all<{ id: string }>().catch(() => ({ results: [] }));
    for (const row of openRows.results ?? []) {
      if (!seenIds.has(row.id)) {
        await env.DB.prepare(
          `UPDATE grant_opportunities SET status = 'closed', updated_at = datetime('now') WHERE id = ?`
        ).bind(row.id).run();
        closed++;
      }
    }
  }

  return { fetched: opportunities.length, inserted, updated, closed, errors };
}
