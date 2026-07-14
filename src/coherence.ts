// ============================================================
// COHERENCE FIELD — src/coherence.ts  —  SHADOW / the material ground
//
// Tier 1 of the spine is "Material Ground." Today it is GENERATED — the Falcon's
// LLM axes produce prose with a number attached. That is the confabulation the
// whole system is built to refuse. This is the measured replacement: real ground
// the analysis can stand on, day to day, computed not theorized.
//
// The one principle: material ground is MEASURED or RETRIEVED, never generated.
// This module is the MEASURED half — a coherence field over real prices:
//
//   · per INSTRUMENT: its own coherence state — κ (conviction level, the fast
//     clock) and dissonance (the two-clock beat) — warmed on real history.
//   · per AREA (sector): the aggregate — mean κ and mean dissonance (temporal,
//     "an aggregate of the mean"), AND the cross-sectional coherence: do the
//     members move TOGETHER right now (a coherent macro regime) or are they
//     dispersing (a stock-specific regime). Cross-sectional coherence is
//     dissonance applied across SPACE instead of time — the same primitive.
//   · the WORLD MAP: the areas aggregated, plus inter-area coherence — are the
//     areas themselves moving as a bloc (risk-on/off) or decoupled.
//
// Two orthogonal coherence axes, both measured:
//   TEMPORAL  — each instrument vs its own past (κ, dissonance)
//   SPATIAL   — instruments vs each other (cross-sectional correlation)
// High temporal + high spatial coherence = a strongly-regimed field; low spatial
// = a broken-up, idiosyncratic one. Neither is generated; both fall out of price.
//
// Honest scope (the empiricist's caveat, on record): this measures the STATE and
// RISK of the field — where it is coherent, where it is churning — not its
// DIRECTION. Consistent with every backtest: a coherence/risk instrument, not an
// oracle. Its job is to make Tier 1 TRUE, not prophetic.
//
// STATUS: SHADOW. Gates nothing. Refreshed daily from the cron; writes
// elle_coherence_field for the spine's Tier 1 (and anything) to READ as ground.
// ============================================================
import { pearson, std, fetchYears, type BtEnv } from './backtest';
import { freshDissonance, stepDissonance } from './dissonance';

// The areas. Liquid names/ETFs reachable on the IEX feed; some symbols
// intentionally recur across areas (NVDA in semis) — real membership overlaps.
export const AREAS: Record<string, string[]> = {
  broad_market: ['SPY', 'QQQ', 'IWM', 'DIA'],
  megacap_tech: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'],
  semis: ['NVDA', 'AMD', 'AVGO', 'MU', 'INTC'],
  energy: ['XLE', 'XOM', 'CVX', 'COP'],
  financials: ['XLF', 'JPM', 'BAC', 'GS'],
  safe_haven: ['GLD', 'TLT', 'SLV'],
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// ── per-instrument coherence (pure) ──────────────────────────
export interface MemberCoherence {
  symbol: string;
  kappa: number;     // conviction level (fast clock), warmed on real history — not 0.5
  dissMag: number;   // two-clock beat magnitude now
  dissSign: number;  // −1 = fast strained below slow (early warning), +1, or 0
  fired: boolean;
  returns: number[]; // recent daily returns, for cross-sectional coherence
}

export function memberCoherence(symbol: string, closes: number[], tail = 20): MemberCoherence | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 30) return null;
  let s = freshDissonance(c[0]);
  let last = stepDissonance(s, c[1], 'long');
  for (let i = 1; i < c.length; i++) { last = stepDissonance(s, c[i], 'long'); s = last.state; }
  const returns: number[] = [];
  const n = Math.min(tail, c.length - 1);
  for (let i = c.length - n; i < c.length; i++) returns.push((c[i] - c[i - 1]) / c[i - 1]);
  return {
    symbol, kappa: last.kappaFast, dissMag: last.mag,
    dissSign: Math.sign(last.d), fired: last.fired, returns,
  };
}

// ── cross-sectional coherence (pure) ─────────────────────────
// Mean pairwise return correlation across members — the SPATIAL coherence.
// 1 = the area moves as one bloc; ~0 = idiosyncratic; <0 = actively opposing.
export function meanPairwiseCorr(seriesList: number[][]): number {
  const series = seriesList.filter(s => s && s.length >= 3);
  if (series.length < 2) return 0;
  const L = Math.min(...series.map(s => s.length));
  const trimmed = series.map(s => s.slice(s.length - L)); // align to shortest, most-recent
  const corrs: number[] = [];
  for (let i = 0; i < trimmed.length; i++)
    for (let j = i + 1; j < trimmed.length; j++)
      corrs.push(pearson(trimmed[i], trimmed[j]));
  return mean(corrs);
}

// Cross-sectional dispersion: per bar, the spread of member returns; averaged.
// High dispersion = the members are pulling apart (a breaking-up regime).
export function crossSectionalDispersion(seriesList: number[][]): number {
  const series = seriesList.filter(s => s && s.length >= 2);
  if (series.length < 2) return 0;
  const L = Math.min(...series.map(s => s.length));
  const perBar: number[] = [];
  for (let t = 0; t < L; t++) perBar.push(std(series.map(s => s[s.length - L + t])));
  return mean(perBar);
}

// ── area coherence (pure) ────────────────────────────────────
export interface AreaCoherence {
  area: string;
  nMembers: number;
  meanKappa: number;       // temporal: aggregate conviction of the members
  meanDissonance: number;  // temporal: aggregate regime-change activity
  crossCoherence: number;  // spatial: do the members move together
  dispersion: number;      // spatial: how far they pull apart
  fracFiring: number;      // fraction of members whose dissonance is firing now
  meanReturnSeries: number[]; // per-bar mean return across members (for the world map)
}

export function areaCoherence(area: string, members: (MemberCoherence | null)[]): AreaCoherence | null {
  const valid = members.filter((m): m is MemberCoherence => m !== null);
  if (valid.length === 0) return null;
  const L = Math.min(...valid.map(m => m.returns.length));
  const meanReturnSeries: number[] = [];
  for (let t = 0; t < L; t++) meanReturnSeries.push(mean(valid.map(m => m.returns[m.returns.length - L + t])));
  return {
    area, nMembers: valid.length,
    meanKappa: mean(valid.map(m => m.kappa)),
    meanDissonance: mean(valid.map(m => m.dissMag)),
    crossCoherence: meanPairwiseCorr(valid.map(m => m.returns)),
    dispersion: crossSectionalDispersion(valid.map(m => m.returns)),
    fracFiring: valid.filter(m => m.fired).length / valid.length,
    meanReturnSeries,
  };
}

// ── the world map (pure) ─────────────────────────────────────
export interface WorldCoherence {
  nAreas: number;
  meanKappa: number;
  meanDissonance: number;
  meanCrossCoherence: number;   // average within-area coherence
  interAreaCoherence: number;   // do the AREAS move as a bloc (risk-on/off)
  fracFiring: number;
}

export function worldCoherence(areas: (AreaCoherence | null)[]): WorldCoherence | null {
  const valid = areas.filter((a): a is AreaCoherence => a !== null);
  if (valid.length === 0) return null;
  const wsum = valid.reduce((s, a) => s + a.nMembers, 0);
  const wmean = (f: (a: AreaCoherence) => number) => valid.reduce((s, a) => s + f(a) * a.nMembers, 0) / wsum;
  return {
    nAreas: valid.length,
    meanKappa: wmean(a => a.meanKappa),
    meanDissonance: wmean(a => a.meanDissonance),
    meanCrossCoherence: wmean(a => a.crossCoherence),
    interAreaCoherence: meanPairwiseCorr(valid.map(a => a.meanReturnSeries)),
    fracFiring: wmean(a => a.fracFiring),
  };
}

// The whole field in one pure call, given each area's members' closes.
export interface CoherenceField { areas: AreaCoherence[]; world: WorldCoherence | null; }
export function computeField(areaCloses: Record<string, Record<string, number[]>>): CoherenceField {
  const areas: AreaCoherence[] = [];
  for (const [area, members] of Object.entries(areaCloses)) {
    const memberCoh = Object.entries(members).map(([sym, cl]) => memberCoherence(sym, cl));
    const ac = areaCoherence(area, memberCoh);
    if (ac) areas.push(ac);
  }
  return { areas, world: worldCoherence(areas) };
}

// ── persistence + orchestrator ───────────────────────────────
export async function ensureCoherenceSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_coherence_field (
       scope TEXT, name TEXT, n_members INTEGER,
       mean_kappa REAL, mean_dissonance REAL, cross_coherence REAL,
       dispersion REAL, frac_firing REAL, inter_area_coherence REAL,
       updated_at TEXT,
       PRIMARY KEY (scope, name)
     )`,
  ).run();
}

export async function runCoherenceField(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensureCoherenceSchema(env.DB);
  const startISO = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10); // ~130 daily bars

  // Fetch each unique symbol once.
  const uniq = Array.from(new Set(Object.values(AREAS).flat()));
  const closesBySymbol: Record<string, number[]> = {};
  for (const sym of uniq) {
    try { closesBySymbol[sym] = await fetchYears(env, sym, startISO); }
    catch (e) { console.error(`[COHERENCE] ${sym} fetch failed:`, (e as Error).message); }
  }

  const areaCloses: Record<string, Record<string, number[]>> = {};
  for (const [area, syms] of Object.entries(AREAS)) {
    areaCloses[area] = {};
    for (const sym of syms) if (closesBySymbol[sym]?.length) areaCloses[area][sym] = closesBySymbol[sym];
  }

  const field = computeField(areaCloses);
  let written = 0;
  for (const a of field.areas) {
    await env.DB.prepare(
      `INSERT INTO elle_coherence_field (scope, name, n_members, mean_kappa, mean_dissonance, cross_coherence, dispersion, frac_firing, inter_area_coherence, updated_at)
       VALUES ('area',?,?,?,?,?,?,?, NULL, datetime('now'))
       ON CONFLICT(scope,name) DO UPDATE SET n_members=excluded.n_members, mean_kappa=excluded.mean_kappa,
         mean_dissonance=excluded.mean_dissonance, cross_coherence=excluded.cross_coherence,
         dispersion=excluded.dispersion, frac_firing=excluded.frac_firing, updated_at=excluded.updated_at`,
    ).bind(a.area, a.nMembers, a.meanKappa, a.meanDissonance, a.crossCoherence, a.dispersion, a.fracFiring).run();
    written++;
  }
  if (field.world) {
    const w = field.world;
    await env.DB.prepare(
      `INSERT INTO elle_coherence_field (scope, name, n_members, mean_kappa, mean_dissonance, cross_coherence, dispersion, frac_firing, inter_area_coherence, updated_at)
       VALUES ('world','WORLD',?,?,?,?, NULL,?,?, datetime('now'))
       ON CONFLICT(scope,name) DO UPDATE SET n_members=excluded.n_members, mean_kappa=excluded.mean_kappa,
         mean_dissonance=excluded.mean_dissonance, cross_coherence=excluded.cross_coherence,
         frac_firing=excluded.frac_firing, inter_area_coherence=excluded.inter_area_coherence, updated_at=excluded.updated_at`,
    ).bind(w.nAreas, w.meanKappa, w.meanDissonance, w.meanCrossCoherence, w.fracFiring, w.interAreaCoherence).run();
    written++;
  }
  return written;
}
