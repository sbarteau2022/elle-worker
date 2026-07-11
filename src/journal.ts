// ============================================================
// OPTIMUS JOURNAL — phase-state layer
//
// The manuscript persists as threads → entries → marginalia. Each entry is a
// SAMPLE ON A TRAJECTORY, not a reading: the worker stores raw κ + timestamp
// and DERIVES the phase state across the thread sequence —
//   reserve   = ∫κ dt   (running trapezoidal integral)
//   velocity  = dκ/dt
//   accel     = d²κ/dt²
// so the journal is a phase-state record, not a transcript, and drift is
// computable per session.
//
// TWO HARD RULES, both enforced HERE (server-side), never in the UI:
//   1. off_record entries are stored and reader-visible but NEVER embedded
//      into Vectorize and NEVER returned by the on-record read path. They do
//      not enter the learner model. (NECAI-F.)
//   2. κ is WORKER-COMPUTED and deterministic. The UI may display it; it may
//      never produce it. The estimator below is a STUB and is NOT validated —
//      it must pass the validate_kappa kill-or-build gate before κ is allowed
//      to drive retrieval/indexing. Until then κ is stored for STRUCTURE ONLY
//      and nothing downstream ranks on it.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { ELLE_VOICE } from './mind';
import { velocityAt, accelerationAt, jerkAt, reserveAt } from './kappa-dynamics';

export type EmbedFn = (text: string, env: Env) => Promise<number[]>;

function id(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

// ── schema (idempotent; safe to run on every op) ─────────────
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_threads (
      id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT, title TEXT,
      anchor_topic TEXT, created_at INTEGER, updated_at INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_entries (
      id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT,
      off_record INTEGER DEFAULT 0, kappa REAL, kappa_ts INTEGER,
      reserve REAL, velocity REAL, accel REAL, jerk REAL, anchor_distance REAL,
      vectorize_id TEXT, threads_json TEXT, created_at INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_marginalia (
      id TEXT PRIMARY KEY, entry_id TEXT, anchor_para INTEGER, note TEXT,
      off_record INTEGER DEFAULT 0, created_at INTEGER)`),
  ]);
  // Backfill new columns on tables created before they shipped — CREATE TABLE IF
  // NOT EXISTS never alters an existing table. Best-effort: each ALTER throws
  // "duplicate column" once the column exists, which we swallow.
  await env.DB.prepare('ALTER TABLE optimus_entries ADD COLUMN threads_json TEXT').run().catch(() => {});
  await env.DB.prepare('ALTER TABLE optimus_entries ADD COLUMN jerk REAL').run().catch(() => {});
  // Which κ formula produced this row's kappa. NULL = legacy v1 (the formula
  // with the 0.5 fixed point) — series reads filter to tagged rows so finite
  // differences never straddle a definition change.
  await env.DB.prepare('ALTER TABLE optimus_entries ADD COLUMN kappa_def TEXT').run().catch(() => {});
  schemaReady = true;
}

// ── κ ESTIMATOR — STUB. NOT VALIDATED. DO NOT RANK ON THIS. ───
// Provisional, deterministic, text-only proxy so the structure is real and
// the derivation can be exercised end-to-end. The validated estimator drops
// in HERE, behind this exact seam, only after the kill-or-build gate passes.
// Replacing this function must not require touching anything below it.
//
// lex2 — the fixed-point repair. The v1 formula was 0.5 + (grounded−hedge)/N
// over two ~10-word lexicons, so EVERY text containing none of those words
// (84% of production turns) landed on exactly 0.5000: not a measurement, a
// resting value, and downstream it read as a fabricated flat κ trajectory.
// lex2 keeps the same intent (grounded assertion ↑, hedging ↓) but mixes in
// continuous features every text has — connective density and lexical
// diversity — so the output varies over ALL input and the point-mass at 0.5
// disappears. Rows are tagged kappa_def='lex2' so series never mix regimes.
// STILL PROVISIONAL: continuous ≠ validated. Gate 0 (which κ definition) and
// Gate 2 (ground truth) remain open; this only makes the series informative
// enough to be worth validating.
export const KAPPA_DEF = 'lex2';

const HEDGE_RE = /\b(maybe|perhaps|might|possibly|unclear|not sure|i think|seems|arguably|i guess|sort of|kind of|probably|somewhat|apparently|presumably)\b/g;
const GROUNDED_RE = /\b(clearly|certainly|definitely|necessarily|proven|forced|therefore|because|follows that|must|precisely|exactly|always|never|in fact)\b/g;
// Discourse connectives — the joints of an argument. Overlaps GROUNDED_RE on
// therefore/because by design: those words carry both assertion and structure.
const CONNECTIVE_RE = /\b(because|therefore|so|but|however|although|though|since|thus|hence|while|whereas|instead|unless|if|then|and yet|still|moreover|meanwhile)\b/g;

export interface KappaDetail {
  kappa: number;
  def: typeof KAPPA_DEF;
  grounded: number; hedge: number;
  words: number; sentences: number;
  connective_density: number;  // connectives per sentence
  ttr: number;                 // type-token ratio over a 300-token window (observability)
  trigram_repetition: number;  // 1 − unique/total token trigrams (circling signal)
  avg_word_len: number;        // chars per word
  words_per_sentence: number;
}

export function computeKappaDetail(content: string): KappaDetail {
  const text = String(content || '').toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  const words = tokens.length;
  if (!words) return { kappa: 0.5, def: KAPPA_DEF, grounded: 0, hedge: 0, words: 0, sentences: 0, connective_density: 0, ttr: 0, trigram_repetition: 0, avg_word_len: 0, words_per_sentence: 0 };

  const sentences = Math.max(1, (text.match(/[.!?]+(?:\s|$)/g) || []).length);
  const hedge = (text.match(HEDGE_RE) || []).length;
  const grounded = (text.match(GROUNDED_RE) || []).length;
  const connectives = (text.match(CONNECTIVE_RE) || []).length;
  // TTR over a fixed window — kept for observability; the circling penalty
  // below uses trigram repetition, which stays 0 for ordinary short prose.
  const win = tokens.slice(0, 300);
  const ttr = new Set(win).size / win.length;
  // Repeated token trigrams: 0 for prose that keeps moving, high for verbatim
  // circling (the manuscript's known failure mode — same signal family as the
  // journal's overlap gate, applied within one text).
  let triTotal = 0; const triSeen = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) { triSeen.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`); triTotal++; }
  const trigramRep = triTotal > 0 ? 1 - triSeen.size / triTotal : 0;
  const awl = text.replace(/\s+/g, '').length / words;      // chars per word
  const wps = words / sentences;

  // balance: assertion direction (the v1 core), √-normalized so a couple of
  // markers in a short text still register but long text needs proportionality.
  const balance = (grounded - hedge) / Math.max(6, Math.sqrt(words));
  // structure: argumentative linkage vs disconnected/listy prose. ~0.35
  // connectives/sentence is treated as neutral conversational prose.
  const structure = 0.3 * Math.tanh(connectives / sentences - 0.35);
  // texture: two weak continuous signals every real text has, so distinct texts
  // essentially never share an exact κ (killing v1's point-mass for good) —
  // denser vocabulary (avg word length) and sentence development (words per
  // sentence), both centered on ordinary prose and tanh-bounded to stay weak.
  const texture = 0.15 * Math.tanh((awl - 4.6) / 1.2) + 0.1 * Math.tanh((wps - 16) / 10);
  // redundancy: verbatim circling. Ordinary prose pays ~nothing.
  const redundancy = 1.2 * trigramRep;

  const z = balance + structure + texture - redundancy;
  const kappa = Number((0.5 + 0.5 * Math.tanh(z)).toFixed(4));
  return {
    kappa: Math.max(0, Math.min(1, kappa)), def: KAPPA_DEF,
    grounded, hedge, words, sentences,
    connective_density: Number((connectives / sentences).toFixed(4)),
    ttr: Number(ttr.toFixed(4)),
    trigram_repetition: Number(trigramRep.toFixed(4)),
    avg_word_len: Number(awl.toFixed(4)),
    words_per_sentence: Number(wps.toFixed(4)),
  };
}

export function computeKappa(content: string): number {
  return computeKappaDetail(content).kappa;
}

// ── phase-state derivation — per-step finite differences, dt = 1 ─────────────
// A step here is one journal entry. Velocity/accel/jerk come from the shared
// kappa-dynamics module (same math the chat uses), differenced over the thread's
// κ series with dt=1 — NO wall-clock time. reserve is the running Σκ (dt=1),
// kept display-only. Derivatives are null (not 0) when there is not enough
// history to form them.
//   priorKappas — ALL prior κ of the thread, oldest→newest. reserve sums the
//                 full series (so it is correct even before backfill runs); the
//                 differences only look back 1–3 steps, and the real series
//                 length is what makes the null/zero boundary correct.
function derivePhaseState(
  priorKappas: number[], kappa: number,
): { reserve: number; velocity: number | null; accel: number | null; jerk: number | null } {
  const series = [...priorKappas, kappa];
  const i = series.length - 1;
  return {
    reserve: reserveAt(series, i), // Σκ, dt=1
    velocity: velocityAt(series, i),
    accel: accelerationAt(series, i),
    jerk: jerkAt(series, i),
  };
}

// ============================================================
// FIX 1 — SELF-OVERLAP REJECTION GATE
//
// Generation used to condition on prior entries as raw prose, and the model
// would reproduce ~⅓ of a prior entry near-verbatim. After generating a
// candidate we now measure its trigram (3-gram) Jaccard overlap against the
// last N prior entries and reject+regenerate (at a slightly higher temperature)
// until it falls under a threshold, or we exhaust the retries and keep the
// lowest-overlap candidate. Every candidate's score is logged so the verbatim
// rate stays observable over time. These functions are PURE (no env, no I/O) so
// they are unit-testable in isolation.
// ============================================================

// Word tokens, lowercased, punctuation-stripped. Empty tokens dropped.
export function tokenizeForOverlap(text: string): string[] {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Set of contiguous 3-grams (as space-joined strings) over the token stream.
export function trigramSet(tokens: string[]): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    grams.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return grams;
}

// Jaccard overlap of two texts' trigram sets: |A∩B| / |A∪B|. Texts too short to
// form a trigram (or with no shared grams) score 0.
export function trigramJaccard(a: string, b: string): number {
  const A = trigramSet(tokenizeForOverlap(a));
  const B = trigramSet(tokenizeForOverlap(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Max trigram Jaccard of a candidate against any one of the prior entries.
export function maxTrigramOverlap(candidate: string, priors: string[]): number {
  let max = 0;
  for (const p of priors) {
    const j = trigramJaccard(candidate, p);
    if (j > max) max = j;
  }
  return Number(max.toFixed(4));
}

export interface OverlapGateConfig {
  threshold?: number;          // reject candidates with overlap ABOVE this (default 0.25)
  maxRetries?: number;         // regenerations after the first attempt (default 3)
  baseTemperature?: number;    // temperature for the first attempt (default 0.7)
  temperatureStep?: number;    // added per retry (default 0.1)
  temperatureCap?: number;     // temperature ceiling (default 1.0)
}

export interface OverlapGateResult {
  content: string;
  overlap: number;             // overlap score of the accepted candidate
  attempts: number;            // total generations performed (1 = accepted first try)
  forced: boolean;             // true = retries exhausted, kept the lowest-overlap candidate
  temperature: number;         // temperature that produced the accepted candidate
}

export type OverlapGateLogger = (event: 'candidate' | 'high_overlap', data: Record<string, unknown>) => void;

const defaultOverlapLog: OverlapGateLogger = (event, data) =>
  console.log(`[OPTIMUS overlap] ${event} ${JSON.stringify(data)}`);

// Generate-then-check loop. `generate(temperature)` produces a candidate; we
// accept the first whose max overlap against `priors` is <= threshold. Each
// retry bumps temperature by temperatureStep (capped). If every attempt exceeds
// the threshold we keep the lowest-overlap candidate and log a high_overlap
// warning. EVERY candidate's score is logged regardless of acceptance.
export async function generateWithOverlapGate(
  priors: string[],
  generate: (temperature: number) => Promise<string>,
  config: OverlapGateConfig = {},
  log: OverlapGateLogger = defaultOverlapLog,
): Promise<OverlapGateResult> {
  const threshold = config.threshold ?? 0.25;
  const maxRetries = config.maxRetries ?? 3;
  const baseTemp = config.baseTemperature ?? 0.7;
  const step = config.temperatureStep ?? 0.1;
  const cap = config.temperatureCap ?? 1.0;

  const tried: { content: string; overlap: number; temperature: number }[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const temperature = Math.min(cap, Number((baseTemp + attempt * step).toFixed(4)));
    const content = String(await generate(temperature) || '').trim();
    const overlap = maxTrigramOverlap(content, priors);
    tried.push({ content, overlap, temperature });
    log('candidate', { attempt, temperature, overlap, threshold, accepted: overlap <= threshold });
    if (overlap <= threshold) {
      return { content, overlap, attempts: attempt + 1, forced: false, temperature };
    }
  }
  // Every candidate exceeded the threshold → keep the lowest-overlap one and flag
  // it so the high-overlap rate stays visible in the logs.
  const best = tried.reduce((a, b) => (b.overlap < a.overlap ? b : a));
  log('high_overlap', {
    overlap: best.overlap, threshold, candidates: tried.length,
    scores: tried.map(t => t.overlap),
  });
  return { content: best.content, overlap: best.overlap, attempts: tried.length, forced: true, temperature: best.temperature };
}

// ============================================================
// FIX 2 — CONDITION ON EXTRACTED THREADS, NOT RAW PRIOR PROSE
//
// After each entry is finalized we run a cheap extraction pass (same model,
// separate call) that pulls the entry's UNRESOLVED threads — open questions,
// contestable claims, and anything the human asked for that wasn't addressed —
// and store them as structured JSON per entry (optimus_entries.threads_json,
// D1). Generation then conditions on the ACCUMULATED open threads rather than
// the prior prose, and is told to advance / dispute / request against them.
// Prior prose is included only as the single most-recent entry for voice (and
// only when the include_prior_prose flag is set).
// ============================================================

export interface EntryThreads {
  open_questions: string[];        // (a) raised in the entry and left unresolved
  claims: string[];                // (b) claims asserted or disputed, still contestable
  unaddressed_requests: string[];  // (c) what the human asked for that wasn't addressed
}

const EMPTY_THREADS: EntryThreads = { open_questions: [], claims: [], unaddressed_requests: [] };
const emptyThreads = (): EntryThreads => ({ open_questions: [], claims: [], unaddressed_requests: [] });

// Balanced first-{...}-object extractor, tolerant of a ```json fence or stray
// prose around the JSON the model returns.
function firstJsonObject(text: unknown): Record<string, unknown> | null {
  const s = String(text ?? '').replace(/```json|```/g, '');
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// Coerce a raw model response (or a stored threads_json string) into EntryThreads.
export function parseThreads(raw: unknown): EntryThreads {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return normalizeThreads(o);
  }
  const obj = firstJsonObject(raw);
  return obj ? normalizeThreads(obj) : emptyThreads();
}

function normalizeThreads(o: Record<string, unknown>): EntryThreads {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 12) : [];
  return {
    open_questions: arr(o.open_questions),
    claims: arr(o.claims),
    unaddressed_requests: arr(o.unaddressed_requests),
  };
}

export function threadsAreEmpty(t: EntryThreads): boolean {
  return t.open_questions.length === 0 && t.claims.length === 0 && t.unaddressed_requests.length === 0;
}

const EXTRACTION_SYSTEM =
`You read ONE journal entry and extract the UNRESOLVED threads it leaves open, as JSON. You are not summarizing, rating, or rewriting — you are pulling only the loose ends a future entry would need to pick up.

Return ONLY a JSON object (no prose, no code fence) with exactly these three keys, each an array of short, self-contained strings (≤ 25 words):
{
  "open_questions": [],        // questions raised in this entry that it does NOT resolve
  "claims": [],                // claims asserted or disputed here that remain contestable
  "unaddressed_requests": []   // anything the reader/human asked for that this entry did NOT address
}

Rules: paraphrase faithfully; do not invent threads that are not in the text; omit anything the entry itself already settles; if a category has nothing, return []. Output the JSON object and nothing else.`;

// Cheap extraction pass over a single finalized entry. Same model as generation
// ('reasoning'), separate call. Best-effort: any failure yields empty threads
// rather than throwing, so it can never break the write path.
export async function extractThreads(env: Env, content: string, role: string): Promise<EntryThreads> {
  const text = String(content || '').trim();
  if (!text) return emptyThreads();
  const userMsg =
`Entry author: ${role === 'elle' ? "Elle (the journal's own author)" : 'the reader (a human)'}
Entry text:
"""
${text.slice(0, 6000)}
"""
Extract the unresolved threads as the specified JSON object.`;
  const result = await callLLM('reasoning', EXTRACTION_SYSTEM, [{ role: 'user', content: userMsg }], 600, env)
    .catch((e) => { console.error('[OPTIMUS extract] failed:', (e as Error).message); return null; });
  if (!result) return emptyThreads();
  return parseThreads(result.content);
}

// Merge a set of per-entry threads into a single deduped, capped open-thread set
// and render it as the conditioning block for generation.
export function renderOpenThreads(threads: EntryThreads[]): string {
  const dedup = (xs: string[]) => Array.from(new Set(xs.map(s => s.trim()).filter(Boolean)));
  const questions = dedup(threads.flatMap(t => t.open_questions)).slice(0, 15);
  const claims = dedup(threads.flatMap(t => t.claims)).slice(0, 15);
  const requests = dedup(threads.flatMap(t => t.unaddressed_requests)).slice(0, 15);
  const section = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map(x => `- ${x}`).join('\n')}` : '';
  return [
    section('OPEN QUESTIONS (raised, not yet resolved)', questions),
    section('CLAIMS IN PLAY (asserted or disputed, still contestable)', claims),
    section('WHAT THE READER ASKED FOR AND HAS NOT RECEIVED', requests),
  ].filter(Boolean).join('\n\n');
}

// ── write an entry: compute κ, derive phase state, embed iff on-record ───────
export async function journalWrite(
  env: Env, embed: EmbedFn,
  args: { user_id?: string; thread_id?: string; role?: string; content?: string; off_record?: boolean; anchor_topic?: string; anchor_distance?: number },
): Promise<{ thread_id: string; entry: Record<string, unknown> }> {
  await ensureSchema(env);
  const now = Date.now();
  const content = String(args.content || '');
  const role = (args.role === 'elle' || args.role === 'reader') ? args.role : 'reader';
  const offRecord = args.off_record ? 1 : 0;

  // resolve / create thread
  let threadId = args.thread_id || '';
  if (threadId) {
    const t = await env.DB.prepare('SELECT id FROM optimus_threads WHERE id = ?').bind(threadId).first();
    if (!t) threadId = '';
  }
  if (!threadId) {
    threadId = id();
    await env.DB.prepare('INSERT INTO optimus_threads (id, user_id, session_id, title, anchor_topic, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(threadId, args.user_id || null, null, content.slice(0, 60), args.anchor_topic || null, now, now).run();
  } else {
    await env.DB.prepare('UPDATE optimus_threads SET updated_at = ? WHERE id = ?').bind(now, threadId).run();
  }

  // prior entries → finite-difference base. The whole thread's κ series,
  // oldest→newest (reserve sums all of it; the differences read the last 3).
  // ONLY same-definition (lex2) rows: differencing across the v1→lex2 boundary
  // would fabricate a velocity out of the definition change itself — the exact
  // contamination the unit-bug fix already taught us about.
  const priorRows = await env.DB.prepare(
    "SELECT kappa FROM optimus_entries WHERE thread_id = ? AND kappa_def = ? ORDER BY kappa_ts ASC"
  ).bind(threadId, KAPPA_DEF).all().catch(() => ({ results: [] as any[] }));
  const priorKappas = (priorRows.results || []).map((r: any) => Number(r.kappa)).filter(Number.isFinite);

  const kappa = computeKappa(content);
  const phase = derivePhaseState(priorKappas, kappa);

  const entryId = id();
  let vectorizeId: string | null = null;

  // RULE 1: only on-record content enters the learner model.
  if (!offRecord && content.trim()) {
    try {
      const vector = await embed(content, env);
      vectorizeId = `jrnl-${entryId}`;
      await env.VECTORIZE.upsert([{ id: vectorizeId, values: vector, metadata: { type: 'journal', thread_id: threadId, entry_id: entryId, role } }]);
    } catch { vectorizeId = null; }
  }

  await env.DB.prepare(
    `INSERT INTO optimus_entries (id, thread_id, role, content, off_record, kappa, kappa_def, kappa_ts, reserve, velocity, accel, jerk, anchor_distance, vectorize_id, threads_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(entryId, threadId, role, content, offRecord, kappa, KAPPA_DEF, now, phase.reserve, phase.velocity, phase.accel, phase.jerk,
         typeof args.anchor_distance === 'number' ? args.anchor_distance : null, vectorizeId, null, now).run();

  // FIX 2: extract this entry's unresolved threads and store them per entry, so
  // future generation can condition on the accumulated open threads instead of
  // the raw prose. Best-effort and on-record only (off_record never enters the
  // learner model, RULE 1) — a failed extraction never breaks the write.
  let threads: EntryThreads | null = null;
  if (!offRecord && content.trim()) {
    try {
      threads = await extractThreads(env, content, role);
      await env.DB.prepare('UPDATE optimus_entries SET threads_json = ? WHERE id = ?')
        .bind(JSON.stringify(threads), entryId).run();
    } catch (e) { console.error('[OPTIMUS] thread extraction failed:', (e as Error).message); }
  }

  return {
    thread_id: threadId,
    entry: { id: entryId, role, off_record: !!offRecord, kappa, kappa_ts: now, ...phase, embedded: !!vectorizeId, threads: threads || undefined },
  };
}

// ── annotate a paragraph (first-class marginalia) ────────────
export async function journalAnnotate(
  env: Env, args: { entry_id?: string; anchor_para?: number; note?: string; off_record?: boolean },
): Promise<{ id: string } | { error: string }> {
  await ensureSchema(env);
  if (!args.entry_id || !args.note) return { error: 'entry_id and note required' };
  const e = await env.DB.prepare('SELECT id FROM optimus_entries WHERE id = ?').bind(args.entry_id).first();
  if (!e) return { error: 'entry not found' };
  const mid = id();
  await env.DB.prepare('INSERT INTO optimus_marginalia (id, entry_id, anchor_para, note, off_record, created_at) VALUES (?,?,?,?,?,?)')
    .bind(mid, args.entry_id, typeof args.anchor_para === 'number' ? args.anchor_para : null, String(args.note), args.off_record ? 1 : 0, Date.now()).run();
  return { id: mid };
}

// ── read: semantic search over ON-RECORD entries only (default) ──────────────
export async function journalRead(
  env: Env, embed: EmbedFn,
  args: { q?: string; thread_id?: string; include_off_record?: boolean; limit?: number },
): Promise<{ results: Record<string, unknown>[] }> {
  await ensureSchema(env);
  const q = String(args.q || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  if (!q) return { results: [] };

  const vector = await embed(q, env);
  const matches = await env.VECTORIZE.query(vector, { topK: 30, returnMetadata: 'all' });
  const ids = matches.matches.filter(m => m.id.startsWith('jrnl-')).map(m => m.id);
  if (!ids.length) return { results: [] };

  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, thread_id, role, content, off_record, kappa, reserve, velocity, accel, jerk, created_at
       FROM optimus_entries WHERE vectorize_id IN (${placeholders})${args.thread_id ? ' AND thread_id = ?' : ''}`
  ).bind(...ids, ...(args.thread_id ? [args.thread_id] : [])).all();

  // RULE 1 (defense in depth): never surface off-record unless explicitly asked.
  const score = new Map(matches.matches.map(m => [m.id, m.score]));
  const out = (rows.results || [])
    .filter(r => args.include_off_record ? true : Number(r.off_record) === 0)
    .map(r => ({ ...r, similarity: score.get(`jrnl-${r.id as string}`) ?? 0 }))
    .sort((a, b) => (b.similarity as number) - (a.similarity as number))
    .slice(0, limit);
  return { results: out };
}

// ── full manuscript: ordered entries + phase-state series + marginalia ───────
export async function journalThread(env: Env, args: { thread_id?: string }): Promise<Record<string, unknown>> {
  await ensureSchema(env);
  if (!args.thread_id) return { error: 'thread_id required' };
  const thread = await env.DB.prepare('SELECT * FROM optimus_threads WHERE id = ?').bind(args.thread_id).first();
  if (!thread) return { error: 'thread not found' };
  const entries = await env.DB.prepare(
    'SELECT id, role, content, off_record, kappa, kappa_ts, reserve, velocity, accel, jerk, anchor_distance, created_at FROM optimus_entries WHERE thread_id = ? ORDER BY kappa_ts ASC'
  ).bind(args.thread_id).all();
  const notes = await env.DB.prepare(
    'SELECT m.id, m.entry_id, m.anchor_para, m.note, m.off_record, m.created_at FROM optimus_marginalia m JOIN optimus_entries e ON e.id = m.entry_id WHERE e.thread_id = ? ORDER BY m.created_at ASC'
  ).bind(args.thread_id).all();
  const phase_series = (entries.results || []).map((e: any) => ({ t: e.kappa_ts, kappa: e.kappa, reserve: e.reserve, velocity: e.velocity, accel: e.accel, jerk: e.jerk }));
  return { thread, entries: entries.results, marginalia: notes.results, phase_series };
}

// ── HTTP dispatcher (user-gated; the reader owns their journal) ───────────────
export async function handleOptimusJournal(
  body: any, env: Env, embed: EmbedFn, userId: string,
): Promise<Response> {
  const op = String(body?.op || '').trim();
  // Must include CORS headers — the dev console calls this cross-origin, and a
  // response without Access-Control-Allow-Origin is blocked by the browser as a
  // "Load failed" fetch error (every other endpoint goes through index's json()).
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), {
    status: s,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    },
  });
  switch (op) {
    case 'write':    return json(await journalWrite(env, embed, { ...body, user_id: userId }));
    case 'annotate': return json(await journalAnnotate(env, body));
    case 'read':     return json(await journalRead(env, embed, body));
    case 'thread':   return json(await journalThread(env, body));
    case 'respond':  return json(await journalRespond(env, embed, { ...body, user_id: userId }));
    case 'list': {
      await ensureSchema(env);
      const rows = await env.DB.prepare('SELECT id, title, anchor_topic, created_at, updated_at FROM optimus_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50').bind(userId).all();
      return json({ threads: rows.results });
    }
    default: return json({ error: "op required: write|annotate|read|thread|respond|list" }, 400);
  }
}

// ============================================================
// ELLE'S AUTONOMOUS CANVAS — once-a-day unprompted journaling
//
// Driven by the daily clock-dispatch (scheduled() → fire('optimus')). This is
// NOT the trading reflection (that is runDailyJournal in trading.ts, → the
// elle_trading_journal table). This writes role='elle' entries into a single
// persistent thread owned by the superadmin, so her daily entries accrue as ONE
// continuous κ trajectory — which is what makes the phase-state snapshot mean
// something across time.
//
// She reads ONLY the reader's ON-RECORD entries written since she last wrote.
// off_record entries are reader-visible but never enter the learner model, and
// her cron read path honors that (RULE 1). She may respond to him or ignore him
// entirely and write about something else — both are correct.
// ============================================================

const ELLE_CANVAS_ANCHOR = 'elle-canvas';

// How many recent canvas entries the overlap gate checks a candidate against.
const OVERLAP_LOOKBACK = 5;

// A/B config flag (Fix 2). Default (unset) = include the single most-recent
// entry's prose for voice continuity. Set JOURNAL_INCLUDE_PRIOR_PROSE=false to
// condition on extracted threads ALONE and omit prior prose entirely.
function includePriorProse(env: Env): boolean {
  const v = String(env.JOURNAL_INCLUDE_PRIOR_PROSE ?? '').trim().toLowerCase();
  if (v === '') return true; // default
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function resolveOwner(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM users WHERE access_tier = 'superadmin' ORDER BY rowid ASC LIMIT 1"
  ).first().catch(() => null) as { id?: string } | null;
  return row?.id || null;
}

async function resolveCanvasThread(env: Env, ownerId: string): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT id FROM optimus_threads WHERE user_id = ? AND anchor_topic = ? ORDER BY rowid ASC LIMIT 1'
  ).bind(ownerId, ELLE_CANVAS_ANCHOR).first() as { id?: string } | null;
  if (existing?.id) return existing.id;
  const tid = id();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO optimus_threads (id, user_id, session_id, title, anchor_topic, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(tid, ownerId, null, 'Elle — Optimus Journal', ELLE_CANVAS_ANCHOR, now, now).run();
  return tid;
}

export async function runOptimusJournal(env: Env, embed: EmbedFn): Promise<void> {
  await ensureSchema(env);

  const owner = await resolveOwner(env);
  if (!owner) { console.warn('[OPTIMUS] no superadmin owner found; skipping canvas'); return; }

  const canvas = await resolveCanvasThread(env, owner);

  // her last entry → both continuity and the reading watermark
  const lastElle = await env.DB.prepare(
    "SELECT kappa_ts FROM optimus_entries WHERE thread_id = ? AND role = 'elle' ORDER BY kappa_ts DESC LIMIT 1"
  ).bind(canvas).first() as { kappa_ts?: number } | null;
  const since = lastElle?.kappa_ts || 0;

  // FIX 2: condition on extracted threads, NOT raw prior prose.
  // RULE 1: ON-RECORD reader entries only. off_record never reaches her. We pull
  // the per-entry threads_json the extraction pass stored, not the prose.
  const readerRows = await env.DB.prepare(
    `SELECT e.threads_json
       FROM optimus_entries e JOIN optimus_threads t ON t.id = e.thread_id
      WHERE t.user_id = ? AND e.role = 'reader' AND e.off_record = 0 AND e.created_at > ?
      ORDER BY e.created_at ASC LIMIT 20`
  ).bind(owner, since).all().catch(() => ({ results: [] as any[] }));

  // her own recent threads, so she advances/disputes her own open lines too.
  const herThreadRows = await env.DB.prepare(
    "SELECT threads_json FROM optimus_entries WHERE thread_id = ? AND role = 'elle' ORDER BY kappa_ts DESC LIMIT 5"
  ).bind(canvas).all().catch(() => ({ results: [] as any[] }));

  // last N canvas entries (any voice) — the overlap gate's reference set, and the
  // source of the single voice-continuity entry when the flag is on.
  const priorEntryRows = await env.DB.prepare(
    'SELECT content FROM optimus_entries WHERE thread_id = ? ORDER BY kappa_ts DESC LIMIT ?'
  ).bind(canvas, OVERLAP_LOOKBACK).all().catch(() => ({ results: [] as any[] }));
  const priors = (priorEntryRows.results || []).map((r: any) => String(r.content || '')).filter(Boolean);

  const accumulated = [
    ...(readerRows.results || []).map((r: any) => parseThreads(r.threads_json)),
    ...(herThreadRows.results || []).map((r: any) => parseThreads(r.threads_json)),
  ];
  const openThreads = renderOpenThreads(accumulated);
  const hasThreads = accumulated.some(t => !threadsAreEmpty(t));

  // Voice continuity: only the single most-recent entry's prose, and only when
  // the include_prior_prose flag is set. Never the full back-catalogue.
  const showProse = includePriorProse(env);
  const voiceEntry = showProse ? String(priors[0] || '').slice(0, 1000) : '';

  const system =
`${ELLE_VOICE}

— this surface: your own journal —
This is your journal, a blank canvas written once a day, for no audience but yourself. No one assigns the topic; you are not answering a prompt and not performing for anyone. Everything above about how you think and refuse to perform holds here most of all, because here there is no reader to blame the honesty on.

You are given the OPEN THREADS of this manuscript: questions raised and not yet resolved, claims still in play, and things the reader (Stewart) asked for and has not received. These are the live edges of the work. Each day you ADVANCE a thread, DISPUTE one, or make a REQUEST against one — you move the manuscript forward, you do not restate it. Never reproduce or paraphrase a previous entry; if you find yourself repeating, change the subject. If a thread pulls you, follow it; if your mind is somewhere else entirely, go there instead and open a new thread — both are good days.

Write ONE entry as continuous prose — no headers, no bullet points, no "Dear diary," no sign-off. Begin wherever you actually are.`;

  const userMsg =
`${hasThreads
  ? `OPEN THREADS in the manuscript right now:\n\n${openThreads}\n\n`
  : `No open threads are on record yet — begin a new one.\n\n`}${voiceEntry
  ? `Your most recent entry (for voice only — do NOT continue or echo it):\n\n${voiceEntry}\n\n`
  : ''}Write today's entry: advance, dispute, or request against the open threads.`;

  // FIX 1: generate behind the self-overlap gate. The gate regenerates at a
  // higher temperature when a candidate overlaps a recent entry too much.
  const gate = await generateWithOverlapGate(
    priors,
    (temperature) =>
      callLLM('reasoning', system, [{ role: 'user', content: userMsg }], 1600, env, { temperature })
        .then((r) => r?.content || '')
        .catch((e) => { console.error('[OPTIMUS] generation failed:', (e as Error).message); return ''; }),
  );
  const content = gate.content.trim();
  if (!content) { console.warn('[OPTIMUS] empty generation; skipping'); return; }
  if (gate.forced) console.warn(`[OPTIMUS] high_overlap accepted: ${gate.overlap} after ${gate.attempts} attempts`);

  const { entry } = await journalWrite(env, embed, {
    user_id: owner, thread_id: canvas, role: 'elle', content, off_record: false, anchor_topic: ELLE_CANVAS_ANCHOR,
  });
  console.log(`[OPTIMUS] elle wrote entry ${String((entry as any).id)} (κ=${(entry as any).kappa}, overlap=${gate.overlap}, prose=${showProse}) on canvas ${canvas}`);
}

// ============================================================
// BACKFILL — recompute reserve/velocity/accel/jerk under dt = 1 STEP
//
// Existing entries carry the OLD wall-clock derivatives (velocity ≈ 0 because dt
// was ~86,400 s). This rewrites every thread's series in place using the shared
// per-step finite differences: reserve = running Σκ, and velocity/accel/jerk are
// null for the first entries where there is insufficient history (null ≠ 0).
// κ itself is NOT recomputed — only what it is differenced into. Trigger via
// POST /api/cron { job: "optimus_backfill" } (admin-gated).
// ============================================================
export async function backfillPhaseState(env: Env): Promise<{ threads: number; entries: number }> {
  await ensureSchema(env);
  const threadRows = await env.DB.prepare('SELECT id FROM optimus_threads').all().catch(() => ({ results: [] as any[] }));
  let threads = 0, entries = 0;
  for (const t of (threadRows.results || []) as Array<{ id: string }>) {
    const rows = await env.DB.prepare(
      'SELECT id, kappa, kappa_def FROM optimus_entries WHERE thread_id = ? ORDER BY kappa_ts ASC'
    ).bind(t.id).all().catch(() => ({ results: [] as any[] }));
    const es = (rows.results || []) as Array<{ id: string; kappa: number; kappa_def: string | null }>;
    if (!es.length) continue;
    // Difference WITHIN a definition regime only (same rule as the live write
    // path): each entry's derivatives come from the series of entries sharing
    // its kappa_def, so a v1→lex2 seam never fabricates a velocity.
    const byDef = new Map<string, { ids: string[]; kappas: number[] }>();
    for (const e of es) {
      const d = e.kappa_def || 'v1';
      if (!byDef.has(d)) byDef.set(d, { ids: [], kappas: [] });
      const g = byDef.get(d)!;
      g.ids.push(e.id); g.kappas.push(Number(e.kappa) || 0);
    }
    const stmts: D1PreparedStatement[] = [];
    for (const { ids, kappas } of byDef.values()) {
      let reserve = 0;
      ids.forEach((eid, i) => {
        reserve = Number((reserve + kappas[i]).toFixed(6)); // Σκ, dt=1, per regime
        stmts.push(env.DB.prepare('UPDATE optimus_entries SET reserve = ?, velocity = ?, accel = ?, jerk = ? WHERE id = ?')
          .bind(reserve, velocityAt(kappas, i), accelerationAt(kappas, i), jerkAt(kappas, i), eid));
      });
    }
    // Chunk the UPDATEs to stay within D1 batch limits.
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    threads++; entries += es.length;
  }
  console.log(`[OPTIMUS] backfill: ${entries} entries across ${threads} threads recomputed (dt=1)`);
  return { threads, entries };
}

// ============================================================
// IN-THREAD RESPONSE — Elle replies inside a correspondence on demand
// Powers the manuscript "Invite Elle to respond" action. Reads the thread's
// ON-RECORD entries (both voices, in order), generates her next entry, and
// writes it role='elle' into the same thread — so the reply lands in the
// manuscript and extends the same κ trajectory. Distinct from runOptimusJournal
// (the daily autonomous canvas): this is reader-initiated, thread-scoped.
// ============================================================
export async function journalRespond(
  env: Env, embed: EmbedFn, args: { thread_id?: string; user_id: string },
): Promise<Record<string, unknown>> {
  await ensureSchema(env);
  const threadId = args.thread_id;
  if (!threadId) return { error: 'thread_id required' };

  const owns = await env.DB.prepare(
    'SELECT id FROM optimus_threads WHERE id = ? AND user_id = ?'
  ).bind(threadId, args.user_id).first().catch(() => null);
  if (!owns) return { error: 'thread not found' };

  const rows = await env.DB.prepare(
    "SELECT role, content FROM optimus_entries WHERE thread_id = ? AND off_record = 0 ORDER BY kappa_ts ASC LIMIT 30"
  ).bind(threadId).all().catch(() => ({ results: [] as any[] }));
  const convo = (rows.results || [])
    .map((r: any) => `${r.role === 'elle' ? 'Elle' : 'Reader'}: ${String(r.content || '').slice(0, 1500)}`)
    .join('\n\n');
  if (!convo) return { error: 'nothing on-record to respond to' };

  // FIX 1 reference set: Elle's own recent entries in this thread — what a
  // verbatim-reproduction failure would echo.
  const priors = (rows.results || [])
    .filter((r: any) => r.role === 'elle')
    .map((r: any) => String(r.content || ''))
    .filter(Boolean)
    .slice(-OVERLAP_LOOKBACK);

  const system =
`${ELLE_VOICE}

— this surface: an ongoing journal correspondence with your reader (Stewart) —
Write the next entry. Reply to where the exchange actually is — or, if your mind is elsewhere, follow that instead; a reply that turns away from his last point is allowed. Never reproduce or paraphrase one of your earlier entries — move the exchange forward. Continuous prose, no headers, no salutation, no sign-off.`;

  const gate = await generateWithOverlapGate(
    priors,
    (temperature) =>
      callLLM('reasoning', system, [{ role: 'user', content: convo + "\n\nWrite Elle's next entry." }], 800, env, { temperature })
        .then((r) => r?.content || '')
        .catch((e) => { console.error('[OPTIMUS respond] generation failed:', (e as Error).message); return ''; }),
  );
  const content = gate.content.trim();
  if (!content) return { error: 'generation failed' };
  if (gate.forced) console.warn(`[OPTIMUS respond] high_overlap accepted: ${gate.overlap} after ${gate.attempts} attempts`);

  return await journalWrite(env, embed, {
    user_id: args.user_id, thread_id: threadId, role: 'elle', content, off_record: false,
  });
}
