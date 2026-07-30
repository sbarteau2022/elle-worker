// ============================================================
// GRANT FUNDER 990 OVERVIEW — src/grant-990.ts
//
// Spec: corpus/engines/03-grant-intelligence.md §II Module 1 — "Foundation:
// 990-PF analysis of every major private foundation — what they actually
// fund vs what they say." This delivers the financial-overview slice of
// that: revenue, expenses, assets, contributions/grants received, pulled
// from ProPublica's Nonprofit Explorer API (public, no key needed) for every
// foundation/corporate funder already seeded in grant_opportunities.
//
// Scope, honestly: ProPublica's organization endpoint exposes SUMMARY
// financial figures per filing year, not itemized grants-paid recipient
// lists (that lives in Schedule I/XV of the actual 990-PF, which ProPublica
// doesn't structure). "What they actually fund vs what they say" at the
// recipient-list level is a further step (parsing the real 990-PF XML/PDF
// per foundation) — not built here. This module is the overview layer: does
// this funder's revenue/spending pattern match its stated mission scale, at
// a glance, before anyone reads a single grant listing.
//
// A private foundation that only files on paper has NO structured data on
// ProPublica (filings_without_data — PDF link only). That is surfaced
// explicitly (pdfOnlyFilingYears), never silently treated as "no data means
// zero revenue."
// ============================================================

const PROPUBLICA_SEARCH_URL = 'https://projects.propublica.org/nonprofits/api/v2/search.json';
const propublicaOrgUrl = (ein: string) => `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`;
const USER_AGENT = 'elle-worker/grant-intelligence-990-overview (+https://github.com/sbarteau2022/elle-worker)';

interface ProPublicaSearchOrg {
  ein: number;
  name: string;
  city?: string;
  state?: string;
  ntee_code?: string | null;
}
interface ProPublicaSearchResponse {
  organizations?: ProPublicaSearchOrg[];
}
interface ProPublicaFiling {
  tax_prd_yr?: number;
  totrevenue?: number;
  totfuncexpns?: number;
  totassetsend?: number;
  totliabend?: number;
  totcntrbgfts?: number;
  totprgmrevn?: number;
}
interface ProPublicaFilingNoData {
  tax_prd_yr?: number;
  pdf_url?: string;
}
interface ProPublicaOrgResponse {
  organization?: { name: string; ein: number; city?: string; state?: string; ntee_code?: string | null };
  filings_with_data?: ProPublicaFiling[];
  filings_without_data?: ProPublicaFilingNoData[];
}

export interface Funder990Overview {
  funderName: string;
  ein: string;
  nteeCode: string | null;
  city: string | null;
  state: string | null;
  mostRecentFilingYear: number | null;
  totalRevenueCents: number | null;
  totalExpensesCents: number | null;
  totalAssetsEndCents: number | null;
  totalLiabilitiesEndCents: number | null;
  contributionsGiftsGrantsCents: number | null;
  programRevenueCents: number | null;
  pdfOnlyFilingYears: number[];
  sourceUrl: string;
  fetchedAt: string;
}

function dollarsToCents(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Resolves a funder name to an EIN via ProPublica's search endpoint. Exact
// case-insensitive name match wins over ProPublica's own relevance ranking —
// a foundation named for our purposes should resolve to itself, not to a
// same-ish-named org with a stronger health score.
export async function resolveFunderEin(funderName: string): Promise<{ ein: string } | { error: string }> {
  const url = `${PROPUBLICA_SEARCH_URL}?q=${encodeURIComponent(funderName)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  } catch (e) {
    return { error: `ProPublica search request failed: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: `ProPublica search failed: HTTP ${res.status}` };
  const data = (await res.json().catch(() => null)) as ProPublicaSearchResponse | null;
  const orgs = data?.organizations ?? [];
  if (!orgs.length) return { error: `no ProPublica match for "${funderName}"` };
  const exact = orgs.find((o) => o.name?.toLowerCase() === funderName.toLowerCase());
  const best = exact ?? orgs[0];
  return { ein: String(best.ein) };
}

export async function fetch990Overview(
  funderName: string, einOverride?: string,
): Promise<Funder990Overview | { error: string }> {
  let ein = einOverride;
  if (!ein) {
    const resolved = await resolveFunderEin(funderName);
    if ('error' in resolved) return resolved;
    ein = resolved.ein;
  }

  const orgUrl = propublicaOrgUrl(ein);
  let res: Response;
  try {
    res = await fetch(orgUrl, { headers: { 'user-agent': USER_AGENT } });
  } catch (e) {
    return { error: `ProPublica organization request failed: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: `ProPublica organization lookup failed: HTTP ${res.status}` };
  const data = (await res.json().catch(() => null)) as ProPublicaOrgResponse | null;
  const org = data?.organization;
  if (!org) return { error: `ProPublica returned no organization for EIN ${ein}` };

  const filings = [...(data?.filings_with_data ?? [])].sort((a, b) => (b.tax_prd_yr ?? 0) - (a.tax_prd_yr ?? 0));
  const latest = filings[0];

  return {
    funderName: org.name ?? funderName,
    ein: String(org.ein ?? ein),
    nteeCode: org.ntee_code ?? null,
    city: org.city ?? null,
    state: org.state ?? null,
    mostRecentFilingYear: latest?.tax_prd_yr ?? null,
    totalRevenueCents: dollarsToCents(latest?.totrevenue),
    totalExpensesCents: dollarsToCents(latest?.totfuncexpns),
    totalAssetsEndCents: dollarsToCents(latest?.totassetsend),
    totalLiabilitiesEndCents: dollarsToCents(latest?.totliabend),
    contributionsGiftsGrantsCents: dollarsToCents(latest?.totcntrbgfts),
    programRevenueCents: dollarsToCents(latest?.totprgmrevn),
    pdfOnlyFilingYears: (data?.filings_without_data ?? []).map((f) => f.tax_prd_yr).filter((y): y is number => typeof y === 'number'),
    sourceUrl: orgUrl,
    fetchedAt: new Date().toISOString(),
  };
}
