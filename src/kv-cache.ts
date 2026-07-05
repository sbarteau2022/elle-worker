// ============================================================
// ELLE DYNAMIC KV CACHE — src/kv-cache.ts
//
// The memory kernel (memory.ts) already gives us a tiered substrate and a
// context assembler. What it does NOT do is make the working set *dynamic*:
// assembleContext loads a fixed 1600-char budget every turn, re-embeds and
// re-queries Vectorize + D1 from scratch each time, and keeps no account of
// what it did. This module is the dynamic layer on top of it — the piece the
// "KV OS" essays keep circling, translated down to the substrate we own:
//
//   dynamicBudget   — size the working set to the DEMAND of the turn, not a
//                     constant. A bare "hi" pulls nothing (silence is free);
//                     a dense, multi-clause, recall-cued question warms a
//                     wider set. The budget is a function of the query, so
//                     the cache breathes with the conversation.
//
//   assembleWorkingSet — the amortization layer. A turn's assembled context is
//                     written back to KV keyed by (session · normalized query).
//                     A near-identical follow-up inside the window REUSES the
//                     computed set instead of paying the embed + Vectorize + D1
//                     round-trip again. This is the "hot memory / amortized
//                     computation across time" claim, made concrete: repeated
//                     reasoning over the same ground gets cheaper.
//
//   a bounded per-session LRU index gives the cache an eviction policy and
//   makes its behavior observable (hits, misses, evictions) instead of relying
//   on raw TTL alone.
//
// Non-breaking by construction: assembleWorkingSet delegates the actual recall
// to memory.ts::assembleContext, so the ranking/decay logic stays in one place.
// The cache is best-effort — a KV miss or error degrades cleanly to a live
// assemble, never to a failed turn.
// ============================================================

import { assembleContext, type MemEnv } from './memory';

type EmbedFn = (text: string, env: any) => Promise<number[]>;

// Working set is warm, not durable: a short window bounds staleness (a memory
// written mid-session becomes visible on the next cache-missing query, and in
// all cases within the TTL). Long enough to catch the "keep going" / rephrase
// follow-ups that actually repeat the recall; short enough that the set tracks
// a moving conversation.
const WS_TTL_S = 120;
const WS_INDEX_TTL_S = 3600;   // the per-session LRU index outlives any one entry
const WS_MAX_ENTRIES = 24;     // per session, before oldest is evicted

// Budget envelope. 0 = load nothing this turn; MAX caps a single turn's pull so
// the assembled block can never crowd out the actual conversation.
export const BUDGET_MIN = 0;
export const BUDGET_BASE = 900;
export const BUDGET_MAX = 2400;

// ── dynamic budget (pure) ────────────────────────────────────
// How many chars of durable memory this turn actually warrants. Signals, all
// cheap and local to the query text:
//   · length / clause count — a denser ask reaches over more ground
//   · question marks         — an actual question, not an aside
//   · recall cues            — "remember", "last time", "you said", "earlier":
//                              the turn is explicitly reaching for the past, so
//                              widen the set hard
//   · triviality             — a bare greeting or acknowledgement pulls nothing
// Deterministic and side-effect-free so it unit-tests without any bindings.

const RECALL_CUES = /\b(remember|recall|last time|earlier|before|you said|we (?:discussed|talked|agreed|decided)|previously|as i mentioned|going back|reminded?)\b/i;
const TRIVIAL = /^(?:hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|k|cool|nice|great|got it|sounds good|yep|yeah|no|nope|lol|haha|good morning|good night|gm|gn)[\s!.?]*$/i;

export function dynamicBudget(query: string, opts: { max?: number } = {}): number {
  const max = Math.max(0, opts.max ?? BUDGET_MAX);
  const q = String(query ?? '').trim();
  if (!q) return BUDGET_MIN;
  if (TRIVIAL.test(q)) return BUDGET_MIN;

  const words = q.split(/\s+/).filter(Boolean).length;
  // Below a handful of words with no question and no recall cue, it's an aside,
  // not a query — don't warm memory for it.
  const asks = (q.match(/\?/g) || []).length;
  const cued = RECALL_CUES.test(q);
  if (words < 4 && asks === 0 && !cued) return BUDGET_MIN;

  // Base scales with size (saturating), then bumps for the demand signals.
  const sizeTerm = Math.min(1, words / 40);                 // 0..1 by ~40 words
  const clauses = (q.match(/[,;:]|\band\b|\bthen\b|\balso\b/gi) || []).length;
  let budget = BUDGET_BASE * (0.45 + 0.55 * sizeTerm);       // ~405..900 by size
  budget += Math.min(3, clauses) * 140;                     // multi-part → wider
  budget += Math.min(2, asks) * 120;                        // real questions
  if (cued) budget += 900;                                  // explicitly reaching back

  return Math.round(Math.max(BUDGET_MIN, Math.min(max, budget)));
}

// ── key normalization + hash (pure) ──────────────────────────
// Two turns that differ only in whitespace, case, or trailing punctuation
// should hit the same cache slot. Normalize hard, then FNV-1a to a short hex
// key. Not cryptographic — a cache key, collisions only cost a stale-ish reuse
// bounded by the TTL.

export function normalizeQuery(query: string): string {
  return String(query ?? '')
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/[^a-z0-9?]+/g, ' ')  // keep '?' — a question differs from its statement
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function workingSetKey(sessionId: string | null, query: string): string {
  return `wsc:${sessionId || 'global'}:${hashKey(normalizeQuery(query))}`;
}

function indexKey(sessionId: string | null): string {
  return `wsc-idx:${sessionId || 'global'}`;
}

interface WsIndexEntry { k: string; at: number }

// ── working-set cache (the amortization layer) ───────────────

export interface WorkingSet {
  text: string;       // the assembled DURABLE MEMORY block ('' = nothing to load)
  budget: number;     // chars this turn was allowed (0 = memory skipped entirely)
  hit: boolean;       // served from cache?
  cached: boolean;    // did we (re)build and store this turn?
}

// Read the LRU index, drop the entry we're about to (re)write, append it as
// newest, and evict any beyond the cap — deleting their KV bodies. Best-effort:
// a failed index op must never fail the turn, so callers wrap this.
async function touchIndex(kv: KVNamespace, sessionId: string | null, key: string): Promise<void> {
  const ik = indexKey(sessionId);
  let idx: WsIndexEntry[] = [];
  try {
    const raw = await kv.get(ik);
    if (raw) idx = JSON.parse(raw) as WsIndexEntry[];
  } catch { idx = []; }

  idx = idx.filter(e => e && e.k !== key);
  idx.push({ k: key, at: Date.now() });

  if (idx.length > WS_MAX_ENTRIES) {
    const evict = idx.slice(0, idx.length - WS_MAX_ENTRIES);
    idx = idx.slice(idx.length - WS_MAX_ENTRIES);
    await Promise.all(evict.map(e => kv.delete(e.k).catch(() => {})));
  }
  await kv.put(ik, JSON.stringify(idx), { expirationTtl: WS_INDEX_TTL_S });
}

// The dynamic entry point the router calls in place of assembleContext.
// budgetOverride lets a caller force a size (e.g. a background/autonomous run
// that wants a wide pull); otherwise the budget is derived from the query.
export async function assembleWorkingSet(
  env: MemEnv,
  embed: EmbedFn,
  query: string,
  sessionId: string | null,
  opts: { budgetOverride?: number; ttlSeconds?: number } = {},
): Promise<WorkingSet> {
  const budget = opts.budgetOverride != null
    ? Math.max(0, Math.min(BUDGET_MAX, Math.round(opts.budgetOverride)))
    : dynamicBudget(query);

  // Nothing to load — the cheapest possible turn. Skip KV entirely.
  if (budget <= 0) return { text: '', budget: 0, hit: false, cached: false };

  const kv = env.SESSIONS;
  const key = workingSetKey(sessionId, query);

  // Hot path: a repeated / rephrased ask inside the window reuses the set.
  try {
    const cached = await kv.get(key);
    if (cached != null) {
      void touchIndex(kv, sessionId, key).catch(() => {});
      return { text: cached, budget, hit: true, cached: false };
    }
  } catch { /* fall through to a live assemble */ }

  // Cold path: build it live, then write it back so the next repeat is hot.
  const text = await assembleContext(env, embed, query, budget).catch(() => '');
  try {
    await kv.put(key, text, { expirationTtl: opts.ttlSeconds ?? WS_TTL_S });
    void touchIndex(kv, sessionId, key).catch(() => {});
  } catch { /* the assemble still stands; only the cache write failed */ }
  return { text, budget, hit: false, cached: true };
}

// Drop a session's whole working-set cache. Call after a durable memory write
// so the next turn rebuilds against the new state instead of serving a set that
// predates it. Best-effort and bounded to the session's own index.
export async function invalidateWorkingSet(kv: KVNamespace, sessionId: string | null): Promise<void> {
  const ik = indexKey(sessionId);
  try {
    const raw = await kv.get(ik);
    if (!raw) return;
    const idx = JSON.parse(raw) as WsIndexEntry[];
    await Promise.all([
      ...idx.map(e => kv.delete(e.k).catch(() => {})),
      kv.delete(ik).catch(() => {}),
    ]);
  } catch { /* best-effort */ }
}
