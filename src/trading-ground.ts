// ============================================================
// TRADING GROUND — src/trading-ground.ts
//
// The history read-back. Before this module, the trading decision loop
// (src/trading.ts) saw exactly one cycle's numbers: current bars, current
// news, current positions + κ, active theses. Meanwhile Elle WRITES three
// kinds of history that nothing ever read back:
//
//   · trade attributions — writeAttribution's post-mortems literally end
//     with "the one lesson worth carrying forward," carried nowhere;
//   · the daily journal — hypothesis_for_tomorrow written every night,
//     never read the next morning;
//   · the coherence field — measured daily as "material ground," write-only.
//
// And the corpus/memory kernel — the thing that makes her HER — was never
// consulted at decision time. A decision loop with no access to its own
// history is pattern-matching numbers; this module is the fix:
//
//   gatherTradingGround()  — assembles the ground block for the decision
//     prompt: closed-trade lessons, the last journal, the measured
//     coherence field, and a semantic recall over corpus + memory keyed on
//     this cycle's actual market picture. memRecall itself appends the
//     co-recall facts to the atlas-events ledger, so from the first cycle
//     this runs, the device cartographer's atlas starts carrying
//     market-shaped co-recall structure — the enrichment path
//     WITNESS_GATES_INTEGRATED.md registered as future work.
//
//   recordTradeRationale() — the write half: every opened position's
//     rationale becomes a durable memory (elle_memory + Vectorize), and
//     the atlas ledger gets the pairings that make it findable later:
//     rationale ↔ market:<SYMBOL> (a stable per-symbol node — repeated
//     trades in the same name strengthen a real hub in the memory graph)
//     and rationale ↔ the memories it was grounded in (lineage).
//
// Honesty constraint, on record: this read-back is for the LIVE loop only.
// The corpus can never be wired into the 2013–2018 backtests — a corpus
// written in 2025-26 knows how those stories ended (NVDA most of all);
// that is terminal lookahead bias. History informs the next decision; it
// cannot be retrofitted into old ones.
//
// Everything here is best-effort: an empty ground block never blocks a
// trading cycle, and a failed memory write never fails the order it
// annotates. Embedder is kept local (same model, '@cf/baai/bge-large-en-
// v1.5') rather than imported from index.ts — the atlas.ts precedent for
// avoiding a value-level circular import.
// ============================================================

import { memRecall, memWrite, type MemEnv } from './memory';
import { logAtlasEvents, logCoRecallEvents } from './atlas-events';

export interface GroundEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  SESSIONS: KVNamespace;
  AI: Ai;
}

async function groundEmbed(text: string, env: GroundEnv): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [text.slice(0, 2000)] }) as { data: number[][] };
  if (!result?.data?.[0]) throw new Error('ground embed returned no data');
  return result.data[0];
}

// ── the pure formatter (tested directly) ─────────────────────

export interface GroundInputs {
  lessons: Array<{ symbol: string; pnl_pct: number | null; attribution: string }>;
  journal: {
    journal_date: string;
    what_she_learned?: string | null;
    what_she_got_wrong?: string | null;
    hypothesis_for_tomorrow?: string | null;
  } | null;
  field: Array<{
    scope: string; name: string; mean_kappa: number | null; mean_dissonance: number | null;
    cross_coherence: number | null; dispersion: number | null; frac_firing: number | null;
    inter_area_coherence: number | null;
  }>;
  memories: Array<{ type: string; date: string; body: string }>;
}

const n2 = (x: number | null | undefined) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(2));

export function formatGroundBlock(g: GroundInputs, budget = 2800): string {
  const sections: string[] = [];

  if (g.lessons.length) {
    const lines = g.lessons.map(l =>
      `- ${l.symbol} (${l.pnl_pct == null ? 'P&L n/a' : `${l.pnl_pct >= 0 ? '+' : ''}${Number(l.pnl_pct).toFixed(1)}%`}): ${l.attribution.replace(/\s+/g, ' ').trim()}`.slice(0, 400));
    sections.push(`LESSONS FROM YOUR CLOSED TRADES (your own post-mortems — carry them):\n${lines.join('\n')}`);
  }

  if (g.journal) {
    const j = g.journal;
    const parts: string[] = [];
    if (j.hypothesis_for_tomorrow) parts.push(`Hypothesis you set for today: ${j.hypothesis_for_tomorrow}`);
    if (j.what_she_learned) parts.push(`What you learned: ${j.what_she_learned}`);
    if (j.what_she_got_wrong) parts.push(`What you got wrong: ${j.what_she_got_wrong}`);
    if (parts.length) sections.push(`YOUR LAST JOURNAL (${j.journal_date}):\n${parts.map(p => `- ${p.replace(/\s+/g, ' ').trim()}`.slice(0, 400)).join('\n')}`);
  }

  if (g.field.length) {
    const world = g.field.filter(f => f.scope === 'world');
    const areas = g.field.filter(f => f.scope === 'area');
    const lines = [
      ...world.map(w => `- WORLD: mean κ ${n2(w.mean_kappa)}, dissonance ${n2(w.mean_dissonance)}, within-area coherence ${n2(w.cross_coherence)}, inter-area ${n2(w.inter_area_coherence)}, firing ${n2(w.frac_firing)}`),
      ...areas.map(a => `- ${a.name}: κ ${n2(a.mean_kappa)}, dissonance ${n2(a.mean_dissonance)}, coherence ${n2(a.cross_coherence)}, dispersion ${n2(a.dispersion)}, firing ${n2(a.frac_firing)}`),
    ];
    sections.push(`COHERENCE FIELD (measured from real prices, daily — high dissonance/firing = regime change underway; low cross-coherence = idiosyncratic tape):\n${lines.join('\n')}`);
  }

  if (g.memories.length) {
    const lines = g.memories.map(m => `- (${m.type} · ${m.date}) ${m.body.replace(/\s+/g, ' ').trim()}`.slice(0, 420));
    sections.push(`FROM YOUR CORPUS AND MEMORY (recalled against this market):\n${lines.join('\n')}`);
  }

  let out = '';
  for (const s of sections) {
    if (out.length + s.length + 2 > budget) break;
    out += (out ? '\n\n' : '') + s;
  }
  return out;
}

// ── the read half ────────────────────────────────────────────

export interface TradingGround { block: string; recalledIds: string[] }

export async function gatherTradingGround(
  env: GroundEnv,
  market: { symbols: Record<string, unknown>; news: Array<{ headline: string; symbols: string[] }> },
): Promise<TradingGround> {
  const g: GroundInputs = { lessons: [], journal: null, field: [], memories: [] };
  const recalledIds: string[] = [];

  try {
    const r = await env.DB.prepare(
      `SELECT symbol, pnl_pct, attribution FROM elle_trades
       WHERE status = 'closed' AND attribution IS NOT NULL AND attribution != ''
       ORDER BY closed_at DESC LIMIT 5`,
    ).all();
    g.lessons = ((r.results || []) as Array<Record<string, unknown>>).map(x => ({
      symbol: String(x.symbol), pnl_pct: x.pnl_pct == null ? null : Number(x.pnl_pct), attribution: String(x.attribution),
    }));
  } catch (e) { console.error('[GROUND] lessons read failed:', (e as Error).message); }

  try {
    const r = await env.DB.prepare(
      `SELECT journal_date, what_she_learned, what_she_got_wrong, hypothesis_for_tomorrow
       FROM elle_trading_journal ORDER BY journal_date DESC LIMIT 1`,
    ).first() as GroundInputs['journal'];
    if (r) g.journal = r;
  } catch (e) { console.error('[GROUND] journal read failed:', (e as Error).message); }

  try {
    const r = await env.DB.prepare(
      `SELECT scope, name, mean_kappa, mean_dissonance, cross_coherence, dispersion, frac_firing, inter_area_coherence
       FROM elle_coherence_field ORDER BY scope DESC, name ASC`,
    ).all();
    g.field = ((r.results || []) as unknown as GroundInputs['field']);
  } catch (e) { console.error('[GROUND] coherence field read failed:', (e as Error).message); }

  try {
    // The recall query is this cycle's actual market picture, so what comes
    // back is the corpus/memory most relevant to TODAY's tape — and the
    // co-recall of that set is logged to the atlas ledger by memRecall itself.
    const movers = Object.entries(market.symbols)
      .map(([sym, v]) => `${sym} ${String((v as Record<string, unknown>)?.change_pct ?? '')}%`)
      .join(', ');
    const headlines = market.news.slice(0, 3).map(x => x.headline).join(' · ');
    const query = `market state: ${movers}. news: ${headlines}`.slice(0, 800);
    const mems = await memRecall(env as unknown as MemEnv, groundEmbed as (t: string, e: unknown) => Promise<number[]>, query, 5);
    for (const m of mems) {
      recalledIds.push(m.id);
      g.memories.push({
        type: m.memory_type,
        date: String(m.created_at || '').slice(0, 10),
        body: (m.content || m.summary || ''),
      });
    }
  } catch (e) { console.error('[GROUND] memory recall failed:', (e as Error).message); }

  return { block: formatGroundBlock(g), recalledIds };
}

// ── the write half ───────────────────────────────────────────

export interface TradeRationale {
  symbol: string;
  action: string;         // buy | short | (option) buy
  reasoning?: unknown;
  testing?: unknown;
  catalyst?: unknown;
}

// Every opened position becomes a durable memory and an atlas fact. The
// memory makes the rationale semantically recallable by future cycles (the
// read half above will surface it when the tape rhymes); the atlas events
// make the trade part of the memory GRAPH: rationale ↔ market:<SYMBOL> is a
// stable hub that strengthens with every trade in the same name, and
// rationale ↔ grounding memories is the lineage of where the theory came
// from. Best-effort throughout — never fails the order it annotates.
export async function recordTradeRationale(
  env: GroundEnv, t: TradeRationale, groundedIn: string[],
): Promise<void> {
  const symbol = String(t.symbol || '').toUpperCase().trim();
  const reasoning = String(t.reasoning || '').trim();
  if (!symbol || !reasoning) return;
  try {
    const content =
      `Trade opened — ${t.action} ${symbol}. Theory: ${reasoning}` +
      (t.testing ? ` Testing: ${String(t.testing)}` : '') +
      (t.catalyst ? ` Expected catalyst: ${String(t.catalyst)}` : '');
    const { id } = await memWrite(
      env as unknown as MemEnv,
      groundEmbed as (t2: string, e: unknown) => Promise<number[]>,
      { content: content.slice(0, 3000), type: 'trade_rationale', sourceEngine: 'trading', importance: 0.7, tags: ['trading', symbol] },
    );
    await logAtlasEvents(env, [{ kind: 'trade', src: id, dst: `market:${symbol}` }]);
    if (groundedIn.length) await logCoRecallEvents(env, [id, ...groundedIn]);
  } catch (e) {
    console.error(`[GROUND] rationale record failed for ${symbol}:`, (e as Error).message);
  }
}
