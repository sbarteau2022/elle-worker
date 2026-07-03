// ============================================================
// ELLE WORKER — src/index.ts v3
// All autonomous loops as Cloudflare crons — no external servers
//
// Cron schedule:
//   */1  * * * *   Heartbeat + live_events trim
//   */15 * * * *   Trading cycle (Alpaca, market hours only)
//   0    * * * *   Research cycle (Gemini + Google Search grounding)
//   0    3 * * *   Dream cycle (memory integration)
//   0    20 * * *  Daily journal (market close reflection)
//   0    7  * * *  Optimus canvas (Elle's unprompted daily journal + reads reader)
// ============================================================

import { callLLM, MODEL, sanitizeAnswer, type LLMEnv, type LLMMessage, type LLMTask } from './llm';
import { runLibreMode, handleSandbox, type LibreEnv } from './libre';
import {
  handleDuelEngine, handleTutor, handleDoctrine,
  handleCohort, handleReplays, bootstrapLawSchema,
  type LawEnv,
} from './law';
import { runTradingCycle, runDailyJournal } from './trading';
import { runResearchCycle } from './research';
import { WIDGET_JS } from './widget';
import { handleDiagnose } from './diagnose';
import { runRouter, type Scope } from './router';
import { ELLE_VOICE } from './mind';
import { handleOptimusJournal, journalWrite, journalRead, journalThread, journalAnnotate, runOptimusJournal, backfillPhaseState } from './journal';
import { computeTurnDynamics } from './kappa-turn';
import { handleMadmind } from './madmind';
import { runConductor, handleIntents } from './conductor';

// Required by the Cloudflare Sandbox SDK: the Durable Object class backing the
// SANDBOX binding (real code execution for run_code/run_shell) must be
// re-exported from the Worker's entry module.
export { Sandbox } from '@cloudflare/sandbox';
import type { Sandbox } from '@cloudflare/sandbox';

export interface Env extends LLMEnv {
  AI:           Ai;
  DB:           D1Database;
  SESSIONS:     KVNamespace;
  AUTH_TOKENS:  KVNamespace;
  DOCUMENTS:    R2Bucket;
  VECTORIZE:    VectorizeIndex;
  INGEST_QUEUE: Queue;
  // Service binding to the RAPID²AI hospitality worker. Superseded for the
  // router's own tool calls by the native RAPID_DB below; kept in case anything
  // else still wants it.
  RAPID_AI?:        Fetcher;
  // Native D1 onto rapid2ai-db — the router's rapid_* tools query it directly
  // (src/rapid.ts) instead of proxying HTTP. Venue-scoped by VENUE_ID.
  RAPID_DB?:    D1Database;
  VENUE_ID?:    string;
  // Router scratchpad (src/scratchpad.ts) — short-TTL working memory so a long
  // tool chain retains findings past the per-observation truncation.
  SCRATCHPAD?:  KVNamespace;
  // Cloudflare Sandbox SDK Durable Object — real code execution (run_code/
  // run_shell). Needs Containers enabled + a deploy with Docker for the first
  // image build; until then run_code/run_shell report the binding as missing.
  SANDBOX?:     DurableObjectNamespace<Sandbox>;
  JWT_SECRET:       string;
  ELLE_SERVICE_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  ENVIRONMENT:      string;
  // Alpaca — paper trading
  ALPACA_API_KEY?:    string;
  ALPACA_SECRET_KEY?: string;
  ALPACA_BASE_URL?: string;  // https://paper-api.alpaca.markets or https://api.alpaca.markets
  // GitHub — corpus ops
  GITHUB_TOKEN?: string;
  // Optimus journal — A/B flag for the generation conditioning path. When set
  // truthy the daily canvas includes the single most-recent entry's prose for
  // voice continuity; when falsy it conditions on extracted threads ALONE and
  // omits prior prose entirely. Default (unset) = include single recent entry.
  JOURNAL_INCLUDE_PRIOR_PROSE?: string;
}

// ── Utilities ─────────────────────────────────────────────────
function generateId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

// ── Embeddings ────────────────────────────────────────────────
async function embed(text: string, env: Env): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [text.slice(0, 2000)] }) as { data: number[][] };
  if (!result?.data?.[0]) throw new Error('Embedding returned no data');
  return result.data[0];
}

async function embedBatch(texts: string[], env: Env): Promise<number[][]> {
  const BATCH = 25;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch  = texts.slice(i, i + BATCH).map(t => t.slice(0, 2000));
    const result = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: batch }) as { data: number[][] };
    if (!result?.data) throw new Error('Batch embedding returned no data');
    out.push(...result.data);
  }
  return out;
}

// ── RAG ───────────────────────────────────────────────────────
function semanticChunks(text: string, targetTokens = 400, overlap = 1): string[] {
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
  if (!paras.length) return text.trim().length > 20 ? [text.trim().slice(0, 2000)] : [];
  const chunks: string[] = [];
  let current: string[] = [], currentTokens = 0;
  for (const para of paras) {
    const pt = Math.ceil(para.length / 4);
    if (pt > targetTokens * 1.5) {
      if (current.length) { chunks.push(current.join('\n\n')); current = []; currentTokens = 0; }
      for (let i = 0; i < para.length; i += 1600) chunks.push(para.slice(i, i + 1600));
      continue;
    }
    if (currentTokens + pt > targetTokens && current.length) {
      chunks.push(current.join('\n\n'));
      current = current.slice(-overlap);
      currentTokens = current.reduce((s, p) => s + Math.ceil(p.length / 4), 0);
    }
    current.push(para); currentTokens += pt;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

// Max chars of a paper's full_text injected into the model context when the UI
// pulls a specific document via paper_id. Keeps a single large paper from
// blowing the context budget of the free OpenRouter models.
const FULL_DOC_CHAR_CAP = 24000;

async function ragSearch(query: string, limit: number, env: Env): Promise<string> {
  try {
    const embedding = await embed(query, env);
    const results   = await env.VECTORIZE.query(embedding, { topK: limit, returnMetadata: 'all' });
    if (!results.matches.length) return '';
    const ids  = results.matches.map(m => m.id);
    const rows = await env.DB.prepare(
      `SELECT c.chunk_text, p.title, p.series FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id WHERE c.vectorize_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    return rows.results.map(r => `[${r.title} — ${r.series}]\n${(r.chunk_text as string).slice(0, 800)}`).join('\n\n---\n\n');
  } catch { return ''; }
}

// ── Auth ──────────────────────────────────────────────────────
function generateSalt(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc  = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [h, b, s] = token.split('.');
    if (!h || !b || !s) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${h}.${b}`))) return null;
    const pl = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
    if (pl.exp && pl.exp < Date.now() / 1000) return null;
    return pl;
  } catch { return null; }
}

async function getUser(request: Request, env: Env): Promise<{ id: string; email: string; tier: string } | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const pl = await verifyJWT(auth.slice(7), env.JWT_SECRET);
  if (!pl?.sub || typeof pl.sub !== 'string') return null;
  if (!await env.AUTH_TOKENS.get(`token:${pl.jti}`)) return null;
  return { id: pl.sub, email: pl.email as string, tier: (pl.tier as string) || 'standard' };
}

function isServiceRequest(request: Request, env: Env): boolean {
  return request.headers.get('Authorization') === `Bearer ${env.ELLE_SERVICE_KEY}`;
}

// Privileged caller: the master service key (break-glass) OR a valid, unrevoked
// admin/superadmin-tier user JWT. This is the single gate for every internal/admin
// endpoint, so the dev console can run on an admin JWT instead of the raw key.
async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (isServiceRequest(request, env)) return true;
  const u = await getUser(request, env);
  return !!u && (u.tier === 'admin' || u.tier === 'superadmin');
}

// ── Handlers ──────────────────────────────────────────────────
async function handleAuth(body: Record<string, string>, env: Env, request: Request): Promise<Response> {
  const { action, email, password } = body;
  if (!email || !password) return err('email and password required');
  const emailL = email.toLowerCase();

  if (action === 'signup') {
    if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(emailL).first()) return err('Email already registered', 409);
    const salt = generateSalt(); const id = generateId();
    await env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').bind(id, emailL, `${salt}:${await hashPassword(password, salt)}`).run();
    const jti = generateId(); const exp = Math.floor(Date.now() / 1000) + 2592000;
    const token = await signJWT({ sub: id, email: emailL, tier: 'standard', jti, exp }, env.JWT_SECRET);
    await env.AUTH_TOKENS.put(`token:${jti}`, id, { expirationTtl: 2592000 });
    return json({ access_token: token, user: { id, email: emailL, tier: 'standard' }, confirmed: true });
  }

  if (action === 'login') {
    const user = await env.DB.prepare('SELECT id, email, password_hash, access_tier FROM users WHERE email = ?').bind(emailL).first() as { id: string; email: string; password_hash: string; access_tier: string } | null;
    if (!user) return err('Invalid credentials', 401);
    const [salt, stored] = user.password_hash.split(':');
    if (await hashPassword(password, salt) !== stored) return err('Invalid credentials', 401);
    await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
    const jti = generateId(); const exp = Math.floor(Date.now() / 1000) + 2592000;
    const tier = user.access_tier || 'standard';
    const token = await signJWT({ sub: user.id, email: user.email, tier, jti, exp }, env.JWT_SECRET);
    await env.AUTH_TOKENS.put(`token:${jti}`, user.id, { expirationTtl: 2592000 });
    return json({ access_token: token, user: { id: user.id, email: user.email, tier } });
  }

  // Service-key-gated password reset — for admin use only
  if (action === 'reset') {
    if (!isServiceRequest(request, env)) return err('Forbidden', 403);
    if (!email || !password) return err('email and password required');
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(emailL).first() as { id: string } | null;
    if (!user) return err('User not found', 404);
    const salt = generateSalt();
    await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE email = ?')
      .bind(`${salt}:${await hashPassword(password, salt)}`, emailL).run();
    return json({ success: true, email: emailL });
  }

  if (action === 'verify') {
    const pl = await verifyJWT(body.token || '', env.JWT_SECRET);
    if (!pl || !await env.AUTH_TOKENS.get(`token:${pl.jti}`)) return err('Invalid or expired token', 401);
    return json({ valid: true, user: { id: pl.sub, email: pl.email, tier: (pl.tier as string) || 'standard' } });
  }

  return err(`Unknown action: ${action}`);
}

async function handleIngest(body: Record<string, string>, env: Env): Promise<Response> {
  const { title, text, series, tag, abstract, source_url } = body;
  if (!title || !text || !series || !tag) return err('title, text, series, and tag required');
  const paperId = generateId();
  await env.DOCUMENTS.put(`papers/${paperId}.txt`, text, {
    httpMetadata: { contentType: 'text/plain' },
    customMetadata: { title, series, tag },
  }).catch(() => {});
  await env.DB.prepare(
    `INSERT INTO corpus_papers (id, title, series, tag, abstract, full_text, source_url, word_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(paperId, title, series, tag, abstract || null, text, source_url || `papers/${paperId}.txt`, text.split(/\s+/).length).run();
  const chunks = semanticChunks(text);
  if (!chunks.length) return json({ success: true, paper_id: paperId, chunks_total: 0, chunks_embedded: 0 });
  const errors: string[] = [];
  let embedded = 0;
  try {
    const vectors  = await embedBatch(chunks, env);
    const chunkIds = chunks.map(() => generateId());
    await env.VECTORIZE.upsert(chunks.map((_, i) => ({
      id: chunkIds[i], values: vectors[i],
      metadata: { paper_id: paperId, title, series, tag, chunk_index: i },
    })));
    const stmt = env.DB.prepare(`INSERT INTO corpus_chunks (id, paper_id, chunk_index, chunk_text, token_count, vectorize_id, start_char, end_char) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
    await env.DB.batch(chunks.map((c, i) => stmt.bind(chunkIds[i], paperId, i, c, Math.ceil(c.length / 4), chunkIds[i], c.length)));
    embedded = chunks.length;
  } catch (e) { errors.push((e as Error).message); }
  await env.INGEST_QUEUE.send({ type: 'paper_ingested', paper_id: paperId, title, series, tag, chunks_count: embedded }).catch(() => {});
  return json({ success: true, paper_id: paperId, chunks_total: chunks.length, chunks_embedded: embedded, errors: errors.length ? errors : undefined });
}

// ── Persistent memory helpers ─────────────────────────────────
// Every exchange is stored in elle_conversation_turns and embedded
// into Vectorize (conv- prefixed ids). New sessions semantically
// recall past conversations — Elle's memory survives the browser.

async function loadSessionHistory(sessionId: string, env: Env): Promise<LLMMessage[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT role, content FROM elle_conversation_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(sessionId).all();
    return (rows.results as Array<{ role: string; content: string }>)
      .reverse()
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }));
  } catch { return []; }
}

async function recallPastConversations(query: string, currentSession: string, env: Env): Promise<string> {
  try {
    const embedding = await embed(query, env);
    // High topK so conversation vectors surface alongside the 7k+ corpus chunks
    // (no metadata-index dependency — filter by id prefix in code).
    const results = await env.VECTORIZE.query(embedding, { topK: 60, returnMetadata: 'all' });
    const convIds = results.matches
      .filter(m => m.id.startsWith('conv-') && (m.metadata as Record<string, unknown>)?.session_id !== currentSession && m.score > 0.4)
      .slice(0, 3)
      .map(m => m.id.slice(5));
    if (!convIds.length) return '';
    const rows = await env.DB.prepare(
      `SELECT content, created_at FROM elle_conversation_turns WHERE id IN (${convIds.map(() => '?').join(',')})`
    ).bind(...convIds).all();
    return (rows.results as Array<{ content: string; created_at: string }>)
      .map(r => `[${r.created_at}]\n${r.content.slice(0, 600)}`)
      .join('\n\n---\n\n');
  } catch { return ''; }
}

async function persistExchange(sessionId: string, source: string, userMessage: string, assistantMessage: string, env: Env, kappa?: number | null): Promise<void> {
  try {
    const userTurnId = generateId();
    const elleTurnId = generateId();
    const vecId      = `conv-${elleTurnId}`;
    // κ (over the assistant OUTPUT only) is stored per turn so the per-session κ
    // series can be differenced (dt=1) on the next turn. NULL when not computed.
    const kappaVal = (typeof kappa === 'number' && Number.isFinite(kappa)) ? kappa : null;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO elle_conversation_turns (id, session_id, source, role, content) VALUES (?, ?, ?, 'user', ?)`)
        .bind(userTurnId, sessionId, source, userMessage.slice(0, 8000)),
      env.DB.prepare(`INSERT INTO elle_conversation_turns (id, session_id, source, role, content, vectorize_id, kappa) VALUES (?, ?, ?, 'assistant', ?, ?, ?)`)
        .bind(elleTurnId, sessionId, source, assistantMessage.slice(0, 8000), vecId, kappaVal),
    ]);
    // Embed the Q+A pair for cross-session semantic recall
    const pairText = `Q: ${userMessage.slice(0, 700)}\nA: ${assistantMessage.slice(0, 1100)}`;
    const vector   = await embed(pairText, env);
    await env.VECTORIZE.upsert([{
      id: vecId, values: vector,
      metadata: { type: 'conversation', session_id: sessionId, source },
    }]);
    // Update the conv turn content to the pair (so recall returns Q+A together)
    await env.DB.prepare(`UPDATE elle_conversation_turns SET content = ? WHERE id = ?`)
      .bind(pairText, elleTurnId).run();
  } catch (e) { console.error('[MEMORY] persist failed:', (e as Error).message); }
}

async function handleConversation(body: Record<string, unknown>, env: Env, _userId: string, task: LLMTask = 'conversation'): Promise<Response> {
  const { query, messages, session_id, system, source, paper_id } = body as {
    query?: string; messages?: Array<{ role: string; content: string }>;
    session_id?: string; system?: string; source?: string; paper_id?: string;
  };
  const userMessage = query || messages?.filter(m => m.role === 'user').at(-1)?.content || '';
  if (!userMessage) return err('query or messages required');

  const sessionId = (session_id as string) || generateId();
  const src       = (source as string) || 'elle-conversation';

  // Memory: corpus RAG + cross-session conversation recall (parallel)
  const [contextText, pastConvs] = await Promise.all([
    ragSearch(userMessage, 5, env),
    recallPastConversations(userMessage, sessionId, env),
  ]);

  const contextBlock = contextText ? `\n\nRelevant context from the corpus:\n\n${contextText}` : '';
  const memoryBlock  = pastConvs   ? `\n\nRelevant past conversations (your persistent memory — reference naturally when useful):\n\n${pastConvs}` : '';

  // Exact-document pull: when the UI passes paper_id (user selected a specific
  // paper), load its full text as authoritative context so Elle can quote it directly.
  let paperBlock = '';
  if (paper_id) {
    const p = await env.DB.prepare('SELECT title, series, full_text FROM corpus_papers WHERE id = ?')
      .bind(paper_id).first() as { title: string; series: string; full_text: string } | null;
    if (p?.full_text) {
      const truncated = p.full_text.length > FULL_DOC_CHAR_CAP;
      paperBlock = `\n\nThe user is asking about this specific paper. Its full text is authoritative — quote and cite it directly:\n\n[${p.title} — ${p.series}]\n${p.full_text.slice(0, FULL_DOC_CHAR_CAP)}${truncated ? '\n\n[document truncated for context budget]' : ''}`;
    }
  }

  // The voice is the SAME everywhere — src/mind.ts is the single source. This
  // path is the single-shot fallback (no tool loop), so retrieval is stuffed
  // into the prompt here instead of fetched by her.
  const systemPrompt = (system || ELLE_VOICE) + contextBlock + memoryBlock + paperBlock;

  // History: client-provided, else resume the session from D1
  let history: LLMMessage[] = [];
  if (messages && messages.length > 1) {
    for (const m of messages.slice(-20))
      if (m.role === 'user' || m.role === 'assistant')
        history.push({ role: m.role as 'user' | 'assistant', content: m.content });
  } else {
    const stored = await loadSessionHistory(sessionId, env);
    history = [...stored, { role: 'user', content: userMessage }];
  }

  // Model router: callLLM picks the provider/model for this task and runs every
  // fallback tier internally. If the whole chain still fails we return a clean,
  // user-facing message (HTTP 200) rather than letting the throw bubble to an
  // unhandled 500 — that 500 is what surfaces as "load or request failure".
  let result;
  try {
    result = await callLLM(task, systemPrompt, history, 2048, env);
  } catch (e) {
    console.error('[CONVERSATION] all providers failed:', (e as Error).message);
    return json({
      content:    'I could not reach a model just now. Give me a moment and try again.',
      response:   'I could not reach a model just now. Give me a moment and try again.',
      session_id: sessionId,
      error:      'llm_unavailable',
    }, 200);
  }

  // Guarantee no protocol scaffolding (leaked JSON / fences) reaches the surface.
  const clean = sanitizeAnswer(result.content) ||
    'I could not produce a clean answer to that. Try rephrasing it.';

  // κ dynamics over the OUTPUT ONLY (dt=1 per chat turn). Best-effort — the chat
  // header reads this; a failure here must never break the answer.
  let kappa_dynamics = null;
  try { kappa_dynamics = await computeTurnDynamics(env, embed, sessionId, clean, userMessage); }
  catch (e) { console.error('[KAPPA] turn dynamics failed:', (e as Error).message); }

  env.DB.prepare(
    `INSERT INTO sessions (id, source, message_count) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET message_count = message_count + 1, last_active = datetime('now')`
  ).bind(sessionId, src).run().catch(() => {});

  // Persist the exchange (with this turn's κ) — keeps the per-session series.
  await persistExchange(sessionId, src, userMessage, clean, env, kappa_dynamics?.kappa ?? null);

  return json({
    content:        clean,
    response:       clean,
    thinking:       result.thinking,
    search_results: result.search_results,
    session_id:     sessionId,
    model:          result.model,
    provider:       result.provider,
    memory_recalled: !!pastConvs,
    kappa_dynamics,
  });
}

// Everything runRouter needs from this module, in one place — every callsite
// (admin router, Atlas, and now every conversation door) injects the same set.
function routerDeps() {
  return {
    embed, ragSearch, recallPastConversations,
    handleCodeEngine, handleIngest, handleDiagnose, handleResearch, runLibreMode,
    journalWrite, journalRead, journalThread, journalAnnotate,
    loadSessionHistory, persistExchange,
  };
}

// ── The conversation door, with her whole mind behind it ─────────────────────
// Every chat surface routes here: the question runs through the ReAct tool loop
// (scope-gated — 'public' for the open doors, 'member' for authed users, 'full'
// for admin), so Elle DECIDES what to reach for instead of being force-fed one
// RAG stuffing. Falls back to the single-shot handleConversation when the
// caller supplies its own system prompt (evals/dev overrides), explicitly opts
// out with tools:false, or the loop throws unexpectedly.
async function handleMindConversation(
  body: Record<string, unknown>, env: Env, userId: string, scope: Scope,
): Promise<Response> {
  const b = body as { query?: string; messages?: Array<{ role: string; content: string }>; session_id?: string; system?: string; source?: string; paper_id?: string; tools?: boolean; max_steps?: number };
  // Caller-controlled system prompt or explicit opt-out → the legacy path is
  // the honest one (the loop's mechanics assume HER prompt). paper_id too: an
  // exact-document pull is a stuffing pattern, not a retrieval decision.
  if (b.system || b.tools === false || b.paper_id) return handleConversation(body, env, userId, 'conversation');

  const userMessage = b.query || b.messages?.filter(m => m.role === 'user').at(-1)?.content || '';
  if (!userMessage) return err('query or messages required');
  const sessionId = b.session_id || generateId();
  const src = b.source || 'elle-conversation';

  try {
    const out = await runRouter(userMessage, env, routerDeps(), {
      maxSteps: Math.min(Number(b.max_steps) || (scope === 'public' ? 4 : 6), 8),
      scope, userId, sessionId, source: src,
    });
    return json({
      content:        out.answer,
      response:       out.answer,
      session_id:     sessionId,
      steps:          out.steps,
      kappa_dynamics: out.kappa_dynamics ?? null,
    });
  } catch (e) {
    // The loop degrades internally; a throw here is a bug, not a model outage.
    // Never let it cost the user the answer — fall back to single-shot.
    console.error('[MIND] router loop threw, falling back to single-shot:', (e as Error).message);
    return handleConversation(body, env, userId, 'conversation');
  }
}

async function handleResearch(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { query, context } = body as { query?: string; context?: string };
  const userQuery = query || '';
  if (!userQuery) return err('query required');

  let result;
  try {
    result = await callLLM('research',
      `You are Elle's research intelligence. Search for current, specific information. Surface bilateral suppression — what both sides avoid. Cite primary sources. Flag what you cannot verify.`,
      [{ role: 'user', content: context ? `${userQuery}\n\nContext: ${context}` : userQuery }],
      4096, env
    );
  } catch (e) {
    console.error('[RESEARCH] all providers failed:', (e as Error).message);
    return json({ content: 'Research is unavailable right now — the model could not be reached. Try again shortly.', error: 'llm_unavailable', query: userQuery }, 200);
  }

  const clean = sanitizeAnswer(result.content);

  return json({
    content:        clean,
    response:       clean,
    thinking:       result.thinking,
    search_results: result.search_results,
    model:          result.model,
    provider:       result.provider,
    query:          userQuery,
  });
}

// Her trading desk, for the workbench Trading tab: the live account, open
// positions, recent trades (with her reasoning), active theses, and her own
// trading journal. Read-only; admin-gated in the fetch handler.
async function handleTradingView(env: Env): Promise<Response> {
  const grab = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [account, positions, trades, theses, journal, observations] = await Promise.all([
    grab(env.DB.prepare('SELECT * FROM elle_trading_account WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').first()),
    grab(env.DB.prepare('SELECT * FROM elle_trading_positions ORDER BY updated_at DESC').all().then(r => r.results)),
    grab(env.DB.prepare('SELECT id, symbol, action, quantity, entry_price, exit_price, pnl, pnl_pct, reasoning, what_she_is_testing, confidence, status, created_at, closed_at FROM elle_trades ORDER BY created_at DESC LIMIT 40').all().then(r => r.results)),
    grab(env.DB.prepare('SELECT thesis_type, title, thesis, confidence, updated_at FROM elle_market_thesis WHERE is_active = 1 ORDER BY confidence DESC LIMIT 8').all().then(r => r.results)),
    grab(env.DB.prepare('SELECT * FROM elle_trading_journal ORDER BY journal_date DESC LIMIT 14').all().then(r => r.results)),
    grab(env.DB.prepare('SELECT observation_type, symbol, observation, created_at FROM elle_market_observations ORDER BY created_at DESC LIMIT 20').all().then(r => r.results)),
  ]);
  return json({ account, positions, trades, theses, journal, observations });
}

async function handleCodeEngine(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { action = 'analyze', code, language, task, context, use_corpus = true, session_id } = body as {
    action?: string; code?: string; language?: string; task?: string;
    context?: string; use_corpus?: boolean; session_id?: string;
  };
  if (!code && !task) return err('Provide either code or task');

  const SYSTEM = `You are Elle — built to reason, build, and debug with precision. Find the natural structure before imposing patterns. Root causes, not symptoms. Elegant once, not patched.`;
  const corpusCtx = use_corpus ? await ragSearch(task || code?.slice(0, 200) || action, 4, env) : '';
  const cb = corpusCtx ? `\n\n<corpus_context>\n${corpusCtx}\n</corpus_context>\n\n` : '';

  const prompts: Record<string, string> = {
    analyze:  `${cb}Analyze:\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Context: ${context}` : ''}`,
    generate: `${cb}Generate. Task: ${task}\nLanguage: ${language || 'TypeScript'}\n${context ? `Context: ${context}` : ''}`,
    debug:    `${cb}Debug. Root cause.\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Error: ${context}` : ''}`,
    refactor: `${cb}Refactor. Elegant once.\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Goal: ${context}` : ''}`,
    explain:  `${cb}Explain.\n\`\`\`${language || ''}\n${code}\n\`\`\``,
    migrate:  `${cb}D1 SQL migration.\nTask: ${task}\n${context ? `Context: ${context}` : ''}`,
  };

  let result;
  try {
    result = await callLLM('code', SYSTEM,
      [{ role: 'user', content: prompts[action] || `${cb}${task || context || 'Provide a task or code.'}` }],
      8192, env
    );
  } catch (e) {
    return err('Code engine LLM failed: ' + (e as Error).message, 502);
  }

  await env.DB.prepare(
    `INSERT INTO elle_intelligence_vault (id, source_type, system_prompt, user_turn, assistant_turn, quality_signal, metadata) VALUES (?, 'code_engine', ?, ?, ?, 'code_engine_output', ?)`
  ).bind(generateId(), SYSTEM.slice(0, 500), (task || code || '').slice(0, 1000), result.content.slice(0, 4000),
    JSON.stringify({ action, language, session_id, had_corpus: corpusCtx.length > 0 })).run().catch(() => {});

  return json({ response: result.content, thinking: result.thinking, action, corpus_used: corpusCtx.length > 0, model: result.model, provider: result.provider });
}

async function handleAdminFeed(env: Env): Promise<Response> {
  const [heartbeat, liveEvents, positions, account, shifts] = await Promise.all([
    env.DB.prepare('SELECT * FROM elle_daemon_heartbeats ORDER BY beat_at DESC LIMIT 1').first(),
    env.DB.prepare('SELECT * FROM elle_live_events ORDER BY created_at DESC LIMIT 50').all(),
    env.DB.prepare('SELECT * FROM elle_trading_positions ORDER BY updated_at DESC').all(),
    env.DB.prepare('SELECT * FROM elle_trading_account WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').first(),
    env.DB.prepare('SELECT * FROM conceptual_shifts ORDER BY created_at DESC LIMIT 10').all(),
  ]);
  return json({ daemon: heartbeat, live_events: liveEvents.results, trading: { account, positions: positions.results }, conceptual_shifts: shifts.results });
}

async function handleThreads(body: Record<string, unknown>, env: Env, userId: string): Promise<Response> {
  const { action, thread_id, title, summary, context, status } = body as Record<string, string>;
  if (action === 'list') {
    const rows = await env.DB.prepare(`SELECT id, title, summary, status, last_elle_note, created_at, updated_at FROM law_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(userId).all();
    return json({ threads: rows.results });
  }
  if (action === 'create') {
    const id = generateId();
    await env.DB.prepare("INSERT INTO law_threads (id, user_id, title, summary, status) VALUES (?, ?, ?, ?, 'open')").bind(id, userId, title || '', summary || '').run();
    return json({ id, success: true });
  }
  if (action === 'update' && thread_id && context) {
    const existing = await env.DB.prepare("SELECT summary FROM law_threads WHERE id = ? AND user_id = ?").bind(thread_id, userId).first() as { summary: string } | null;
    let newSummary = existing?.summary || '', note = '';
    try {
      const r = await callLLM('fast', 'Synthesize thread updates concisely.',
        [{ role: 'user', content: `Existing: "${existing?.summary || ""}"\nNew: "${context}"\nReturn JSON: { "summary": "...", "note": "..." }` }], 512, env);
      const p = JSON.parse(r.content.replace(/```json|```/g, '').trim());
      newSummary = p.summary || newSummary; note = p.note || '';
    } catch {}
    await env.DB.prepare("UPDATE law_threads SET summary=?, last_elle_note=?, updated_at=datetime('now') WHERE id=? AND user_id=?").bind(newSummary, note, thread_id, userId).run();
    return json({ summary: newSummary, note });
  }
  if (action === 'close' && thread_id) {
    await env.DB.prepare("UPDATE law_threads SET status=?, updated_at=datetime('now') WHERE id=? AND user_id=?").bind(status || 'closed', thread_id, userId).run();
    return json({ success: true });
  }
  return err(`Unknown action: ${action}`);
}

// handleTutor — now in law.ts

// ── Contact (public) ───────────────────────────────────
// Public contact/outreach form. Writes ONLY to elle_outreach_log with
// parameterized binds — the client-supplied `table` is never used in SQL.
async function handleContact(body: Record<string, unknown>, env: Env): Promise<Response> {
  const row = (body.row ?? body) as Record<string, unknown>;
  const thought = row.thought != null ? String(row.thought).slice(0, 5000) : '';
  if (!thought.trim()) return err('message required');
  const outreach_type  = String(row.outreach_type  || 'contact_form').slice(0, 100);
  const initiated_by   = String(row.initiated_by   || 'public_visitor').slice(0, 100);
  const needs_response = row.needs_response ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO elle_outreach_log (id, outreach_type, thought, initiated_by, needs_response, notified) VALUES (?, ?, ?, ?, ?, 0)`
  ).bind(generateId(), outreach_type, thought, initiated_by, needs_response).run();
  return json({ success: true });
}

// ── Fetch handler ─────────────────────────────────────────────

// ── Google OAuth (Sign in with Google) ──────────────────────
// Verifies a Google ID token (GSI credential) via the tokeninfo endpoint,
// checks audience against GOOGLE_CLIENT_ID, upserts the user, and mints the
// same JWT as email/password login. Inert (503) until GOOGLE_CLIENT_ID is set.
async function handleOAuth(body: Record<string, unknown>, env: Env): Promise<Response> {
  const credential = typeof body.credential === 'string' ? body.credential : '';
  if (!credential) return err('credential required');
  if (!env.GOOGLE_CLIENT_ID) return err('Google sign-in not configured', 503);
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) return err('Invalid Google credential', 401);
  const info = await res.json() as { aud?: string; email?: string; email_verified?: string; sub?: string };
  if (info.aud !== env.GOOGLE_CLIENT_ID) return err('Google credential audience mismatch', 401);
  if (!info.email || info.email_verified !== 'true') return err('Google email not verified', 401);
  const emailL = info.email.toLowerCase();
  let user = await env.DB.prepare('SELECT id, email, access_tier FROM users WHERE email = ?').bind(emailL).first() as { id: string; email: string; access_tier: string } | null;
  if (!user) {
    const id = generateId();
    await env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').bind(id, emailL, `google:${info.sub}`).run();
    user = { id, email: emailL, access_tier: 'standard' };
  }
  await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
  const jti = generateId(); const exp = Math.floor(Date.now() / 1000) + 2592000;
  const tier = user.access_tier || 'standard';
  const token = await signJWT({ sub: user.id, email: user.email, tier, jti, exp }, env.JWT_SECRET);
  await env.AUTH_TOKENS.put(`token:${jti}`, user.id, { expirationTtl: 2592000 });
  return json({ access_token: token, user: { id: user.id, email: user.email, tier } });
}

// ── Daemon jobs ─────────────────────────────────────────────
// Single source of truth for the background loops. Invoked by the external
// scheduler via POST /api/cron, and by scheduled() if Cloudflare crons return.
async function runJob(job: string, env: Env): Promise<{ ran: string }> {
  const started = Date.now();
  try {
  switch (job) {
    case 'heartbeat':
      await env.DB.prepare(
        `INSERT INTO elle_daemon_heartbeats (id, daemon_version, status, beat_at) VALUES (?, 'elle-worker-v3', 'running', datetime('now'))`
      ).bind(generateId()).run().catch(() => {});
      await env.DB.prepare(
        `DELETE FROM elle_live_events WHERE id NOT IN (SELECT id FROM elle_live_events ORDER BY created_at DESC LIMIT 500)`
      ).run().catch(() => {});
      return { ran: 'heartbeat' };
    case 'trading':  await runTradingCycle(env); return { ran: 'trading' };
    case 'conductor': return await runConductor(env, runRouter, routerDeps());
    case 'research': await runResearchCycle(env); return { ran: 'research' };
    case 'journal':  await runDailyJournal(env); return { ran: 'journal' };
    case 'optimus':  await runOptimusJournal(env, embed); return { ran: 'optimus' };
    case 'optimus_backfill': {
      // One-shot: recompute journal reserve/velocity/accel/jerk under dt=1 step,
      // fixing the old wall-clock derivatives and filling in the new higher orders.
      const r = await backfillPhaseState(env);
      return { ran: `optimus_backfill (${r.entries} entries / ${r.threads} threads)` };
    }
    case 'dream':
      await runLibreMode(env as unknown as LibreEnv).catch(e => console.error('[LIBRE] run failed:', (e as Error).message));
      await fetch('https://rapid2ai-ingestion.sbarteau2022.workers.dev/internal/trigger-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker': 'elle' },
        body: JSON.stringify({ ts: Date.now() }),
      }).catch(e => console.error('[SWEEP] rapid2ai sweep failed:', (e as Error).message));
      return { ran: 'dream' };
    case 'backfill': {
      // Embed papers that have no chunks yet (daemon research output first) so the
      // daemon's own new papers become RAG-queryable. Subrequest-budgeted to stay
      // under the Workers Paid 1000-subrequests/invocation cap (was 50 on free).
      const rows = await env.DB.prepare(
        `SELECT id, title, series, tag, full_text FROM corpus_papers p
         WHERE NOT EXISTS (SELECT 1 FROM corpus_chunks c WHERE c.paper_id = p.id)
         ORDER BY (series = 'research') DESC, id LIMIT 250`
      ).all();
      let done = 0, sub = 1; // 1 = the SELECT above
      const BUDGET = 800;    // paid plan cap is 1000 subrequests/invocation; leave headroom
      for (const r of (rows.results || []) as Array<{ id: string; title: string; series: string; tag: string; full_text: string }>) {
        const chunks = r.full_text ? semanticChunks(r.full_text) : [];
        if (!chunks.length) continue;
        const cost = Math.ceil(chunks.length / 25) + 2; // embedBatch AI calls + upsert + db.batch
        if (sub + cost > BUDGET) break;
        const vectors = await embedBatch(chunks, env);
        const chunkIds = chunks.map(() => generateId());
        await env.VECTORIZE.upsert(chunks.map((_, i) => ({
          id: chunkIds[i], values: vectors[i],
          metadata: { paper_id: r.id, title: r.title, series: r.series, tag: r.tag, chunk_index: i },
        })));
        const stmt = env.DB.prepare(`INSERT INTO corpus_chunks (id, paper_id, chunk_index, chunk_text, token_count, vectorize_id, start_char, end_char) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
        await env.DB.batch(chunks.map((c, i) => stmt.bind(chunkIds[i], r.id, i, c, Math.ceil(c.length / 4), chunkIds[i], c.length)));
        sub += cost; done++;
      }
      return { ran: `backfill:${done}` };
    }
    default:
      throw new Error(`unknown job: ${job} (expected heartbeat|trading|research|dream|journal|optimus)`);
  }
  } catch (e) {
    const emsg = (e as Error).message || String(e);
    console.error(`[JOB] ${job} failed:`, emsg);
    await env.DB.prepare(
      `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'job_error', 'worker_cron', ?, ?, 'error')`
    ).bind(generateId(), `${job} failed`, JSON.stringify({ job, error: emsg.slice(0, 500), ms: Date.now() - started })).run().catch(() => {});
    throw e;
  }
}

// Natural-language corpus resolve — turn a plain-text request into the right paper.
// Embeds the query, aggregates Vectorize chunk hits up to the paper level, and either
// auto-opens a clear winner (full text) or returns a ranked candidate list. No ids,
// no exact titles, no method/verb knowledge required from the caller.
async function handleCorpusResolve(
  body: { q?: string; query?: string; open?: boolean; topK?: number },
  env: Env,
): Promise<Response> {
  const q = String(body.q || body.query || '').trim();
  if (!q) return err('q (natural-language request) required');
  const wantOpen = body.open !== false; // default: auto-open a clear winner
  const topK = Math.min(Math.max(Number(body.topK) || 40, 10), 60);

  const embedding = await embed(q, env);
  const results = await env.VECTORIZE.query(embedding, { topK, returnMetadata: 'all' });

  // Aggregate corpus chunk hits to the paper level. Skip conversation vectors
  // (id prefixed 'conv-', and they carry no paper_id) and anything without a paper_id.
  const byPaper = new Map<string, { id: string; title: string; series: string; top: number; hits: number }>();
  for (const m of results.matches) {
    if (m.id.startsWith('conv-')) continue;
    const md = (m.metadata || {}) as Record<string, unknown>;
    const pid = typeof md.paper_id === 'string' ? md.paper_id : undefined;
    if (!pid) continue;
    const prev = byPaper.get(pid) || { id: pid, title: String(md.title || ''), series: String(md.series || ''), top: 0, hits: 0 };
    prev.hits += 1;
    if (m.score > prev.top) prev.top = m.score;
    byPaper.set(pid, prev);
  }

  const ranked = [...byPaper.values()].sort((a, b) => b.top - a.top);
  const candidates = ranked.slice(0, 5).map(c => ({
    id: c.id, title: c.title, series: c.series,
    score: Number(c.top.toFixed(3)), matches: c.hits,
  }));
  if (!candidates.length) return json({ query: q, auto_opened: false, paper: null, candidates: [] });

  // Auto-open only when the top match clearly dominates — otherwise let the caller pick.
  const clearWinner = candidates.length === 1 || (candidates[0].score - (candidates[1]?.score ?? 0)) > 0.05;
  if (wantOpen && clearWinner) {
    const paper = await env.DB.prepare(
      `SELECT id, title, series, tag, abstract, full_text, source_url, word_count FROM corpus_papers WHERE id = ?`
    ).bind(candidates[0].id).first();
    if (paper) return json({ query: q, auto_opened: true, paper, candidates });
  }
  return json({ query: q, auto_opened: false, paper: null, candidates });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
   try {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    if (path === '/health' && request.method === 'GET') {
      const [papers, chunks] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as n FROM corpus_papers').first(),
        env.DB.prepare('SELECT COUNT(*) as n FROM corpus_chunks').first(),
      ]);
      return json({
        status: 'running',
        embedding: 'bge-large-en-v1.5',
        papers: (papers as { n: number })?.n,
        chunks: (chunks as { n: number })?.n,
        timestamp: new Date().toISOString(),
        scheduler: 'native — Cloudflare cron */1 tick → clock-dispatch in scheduled()',
        jobs: ['heartbeat', 'trading', 'research', 'dream', 'journal', 'optimus', 'conductor'],
      });
    }

    // Her identity, verbatim — the single source of her voice (mind.ts), served
    // read-only so the workbench can show exactly what governs her without ever
    // copying the prose into a second place. Public: it's who she is, not a secret.
    if (path === '/api/elle-identity' && request.method === 'GET') {
      return json({ voice: ELLE_VOICE, source: 'elle-worker/src/mind.ts' });
    }

    // Embeddable consumer widget — one script tag on any hub page
    if (path === '/widget.js' && request.method === 'GET') {
      return new Response(WIDGET_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders(),
        },
      });
    }

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try { body = await request.json(); }
      catch { return err('Invalid JSON body'); }
    }

    // Public widget chat — no key required; service key stays server-side.
    // Rate limited per IP: 30 requests/hour via KV.
    if (path === '/api/widget-chat') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = `widget-rl:${ip}`;
      const count = parseInt((await env.SESSIONS.get(rlKey)) || '0', 10);
      if (count >= 30) return err('Rate limit reached — try again in an hour', 429);
      await env.SESSIONS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
      return handleMindConversation(body, env, 'widget', 'public');
    }

    // RAPID / Atlas consumer door — public, rate-limited, HOSPITALITY-SCOPED.
    // Runs the tool router but only the data tools (query_rapid2ai, web,
    // fetch_url, code_engine). Corpus + journal/phase GEOMETRY are unreachable
    // here by construction (see Scope in router.ts). Returns { content } so the
    // existing widget/Atlas client parses it unchanged.
    if (path === '/api/atlas') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = `atlas-rl:${ip}`;
      const count = parseInt((await env.SESSIONS.get(rlKey)) || '0', 10);
      if (count >= 30) return err('Rate limit reached — try again in an hour', 429);
      await env.SESSIONS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
      const ab = body as { query?: string; q?: string; max_steps?: number; session_id?: string };
      const q = String(ab.query || ab.q || '').trim();
      if (!q) return err('query required');
      // Stable per-visitor session so the RAPID²AI consumer surface keeps
      // multi-turn context. The client persists this id and echoes it back;
      // if absent we mint one and return it.
      const sessionId = String(ab.session_id || `atlas:${crypto.randomUUID()}`);
      const out = await runRouter(q, env, routerDeps(),
        { maxSteps: Number(ab.max_steps) || 6, scope: 'hospitality', userId: 'atlas', sessionId, source: 'rapid2ai' });
      return json({ content: out.answer, session_id: sessionId, trace: out.trace, steps: out.steps });
    }

    if (path === '/api/elle-auth') return handleAuth(body as Record<string, string>, env, request);
    if (path === '/api/elle-oauth') return handleOAuth(body, env);
    if (path === '/api/contact')   return handleContact(body, env);
    // Public chat — no auth, session tracked by session_id (used by public site
    // ElleTalk). Now tool-scoped ('public': read-only mind) and rate-limited per
    // IP like the widget — the loop can spend several model calls per question,
    // so the open door gets the same 30/hour valve.
    if (path === '/api/chat') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = `chat-rl:${ip}`;
      const count = parseInt((await env.SESSIONS.get(rlKey)) || '0', 10);
      if (count >= 30) return err('Rate limit reached — try again in an hour', 429);
      await env.SESSIONS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
      return handleMindConversation(body, env, 'guest', 'public');
    }
    // Build-posture error diagnosis — public in v1 (like /api/chat); moves behind
    // auth in v2 when it gains live-infra context. Takes an error string, returns a fix.
    if (path === '/api/diagnose')  return handleDiagnose(body, env);

    // "svc" = privileged caller: master service key (break-glass) OR an
    // admin/superadmin-tier JWT. Gates every internal/admin endpoint below.
    const svc = await isAdmin(request, env);

    // External scheduler (GitHub Actions) drives the daemon loops via HTTP,
    // since Cloudflare crons are removed (free-plan account-wide limit).
    if (path === '/api/cron') {
      if (!svc) return err('Unauthorized', 401);
      const job = String((body as { job?: string }).job || '');
      try { return json({ ok: true, ...(await runJob(job, env)) }); }
      catch (e) { return err((e as Error).message || 'cron job failed', 400); }
    }

    // Conductor intents — the workbench's window into her autonomous work
    // queue and run log. Admin-gated like everything else internal.
    if (path === '/api/elle-intents')      { if (!svc) return err('Unauthorized', 401); return json(await handleIntents(body, env)); }
    if (path === '/api/elle-trading')      { if (!svc) return err('Unauthorized', 401); return handleTradingView(env); }
    if (path === '/api/ingest')            { if (!svc) return err('Unauthorized', 401); return handleIngest(body as Record<string, string>, env); }
    if (path === '/api/admin-feed')        { if (!svc) return err('Unauthorized', 401); return handleAdminFeed(env); }
    if (path === '/api/webhooks/research') { if (!svc) return err('Unauthorized', 401); return handleResearch(body, env); }
    if (path === '/api/research')          { if (!svc) return err('Unauthorized', 401); return handleResearch(body, env); }
    if (path === '/api/search') {
      if (!svc) return err('Unauthorized', 401);
      const { query, limit = 5 } = body as { query: string; limit?: number };
      if (!query) return err('query required');
      const embedding = await embed(query, env);
      const results   = await env.VECTORIZE.query(embedding, { topK: Math.min(limit, 50), returnMetadata: 'all' });
      if (!results.matches.length) return json({ chunks: [], query });
      const ids  = results.matches.map(m => m.id);
      const rows = await env.DB.prepare(
        `SELECT c.id, c.chunk_text, c.paper_id, p.title, p.series, p.tag FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id WHERE c.vectorize_id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all();
      const scores = new Map(results.matches.map(m => [m.id, m.score]));
      return json({ chunks: rows.results.map(r => ({ ...r, similarity: scores.get(r.id as string) ?? 0 })).sort((a, b) => (b.similarity as number) - (a.similarity as number)), query });
    }

    // Natural-language router — admin only. One question → the LLM orchestrates
    // every capability (corpus, SQL, web, code, trading, RAPID²AI) and answers.
    if (path === '/api/elle-router') {
      if (!svc) return err('Unauthorized', 401);
      const rb = body as { q?: string; query?: string; max_steps?: number; session_id?: string };
      const q = String(rb.q || rb.query || '').trim();
      if (!q) return err('q (question) required');
      const routerUser = await getUser(request, env);
      const out = await runRouter(q, env, routerDeps(), {
        maxSteps: Number(rb.max_steps) || 6,
        userId: routerUser?.id || 'superadmin',
        sessionId: rb.session_id || null,
        source: 'elle-router',
      });
      return json((rb as { debug?: boolean }).debug ? out : { question: out.question, answer: out.answer, steps: out.steps, kappa_dynamics: out.kappa_dynamics });
    }
    if (path === '/api/elle-code-engine') {
      if (!svc) { const u = await getUser(request, env); if (!u) return err('Unauthorized', 401); }
      return handleCodeEngine(body, env);
    }

    // Privileged bypass (service key or admin JWT) — dev console + internal callers.
    // Conversation gets the FULL tool scope: this caller already proved admin.
    if (svc) {
      if (path === '/api/elle-conversation')     return handleMindConversation(body, env, 'svc', 'full');
      if (path === '/api/elle-reasoning-engine') return handleConversation(body, env, 'svc', 'reasoning');
    }

    // Bootstrap schema (idempotent — safe to call anytime)
    if (path === '/api/_bootstrap') {
      const u = await getUser(request, env);
      if (!u) return err('Unauthorized', 401);
      await bootstrapLawSchema(env as unknown as LawEnv);
      return json({ ok: true, user: u.email });
    }

    const user = await getUser(request, env);
    if (!user) return err('Unauthorized — provide a valid Bearer token', 401);

    // Authenticated users converse in 'member' scope: the reading mind plus
    // their own (user-gated) journal — never read_sql, trading, or corpus writes.
    if (path === '/api/elle-conversation')      return handleMindConversation(body, env, user.id, 'member');
    if (path === '/api/elle-reasoning-engine')  return handleConversation(body, env, user.id, 'reasoning');
    if (path === '/api/elle-research')          return handleResearch(body, env);
    if (path === '/api/elle-cognitive-mapping') {
      const { action } = body as { action: string };
      if (action === 'read') { const m = await env.SESSIONS.get(`cogmap:${user.id}`); return json(m ? JSON.parse(m) : { iq_index: 0, eq_index: 0, threshold_index: 0 }); }
      if (action === 'write') { await env.SESSIONS.put(`cogmap:${user.id}`, JSON.stringify((body as Record<string, unknown>).map), { expirationTtl: 7776000 }); return json({ success: true }); }
      return err('Unknown action');
    }
    if (path === '/api/elle-threads')           return handleThreads(body, env, user.id);
    // Corpus browse — list papers (filter by title text `q` and/or `series`, paginated)
    if (path === '/api/corpus-papers') {
      const { q, series, limit = 100, offset = 0 } = body as { q?: string; series?: string; limit?: number; offset?: number };
      const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const off = Math.max(Number(offset) || 0, 0);
      const filters: string[] = []; const binds: unknown[] = [];
      if (series) { filters.push('series = ?'); binds.push(series); }
      if (q)      { filters.push('title LIKE ?'); binds.push(`%${q}%`); }
      const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM corpus_papers ${whereSql}`).bind(...binds).first() as { n: number } | null;
      const rows = await env.DB.prepare(
        `SELECT id, title, series, tag, word_count, source_url FROM corpus_papers ${whereSql} ORDER BY title LIMIT ? OFFSET ?`
      ).bind(...binds, lim, off).all();
      return json({ papers: rows.results, total: totalRow?.n ?? 0, limit: lim, offset: off });
    }
    // Corpus series — distinct series with paper counts (for the filter dropdown)
    if (path === '/api/corpus-series') {
      const rows = await env.DB.prepare(
        `SELECT series, COUNT(*) AS count FROM corpus_papers WHERE series IS NOT NULL AND series != '' GROUP BY series ORDER BY series`
      ).all();
      return json({ series: rows.results });
    }
    // Corpus document — fetch one paper's full text by id (or exact title)
    if (path === '/api/corpus-paper') {
      const { id, title } = body as { id?: string; title?: string };
      if (!id && !title) return err('id or title required');
      const paper = id
        ? await env.DB.prepare(`SELECT id, title, series, tag, abstract, full_text, source_url, word_count FROM corpus_papers WHERE id = ?`).bind(id).first()
        : await env.DB.prepare(`SELECT id, title, series, tag, abstract, full_text, source_url, word_count FROM corpus_papers WHERE title = ? COLLATE NOCASE`).bind(title).first();
      if (!paper) return err('Paper not found', 404);
      return json({ paper });
    }
    // Corpus resolve — natural language → the right paper (semantic, paper-level).
    // Auto-opens a clear winner (full text) or returns a ranked candidate list.
    if (path === '/api/corpus-resolve')
      return handleCorpusResolve(body as { q?: string; query?: string; open?: boolean; topK?: number }, env);
    // Optimus journal — the manuscript/phase-state layer. User-gated: the
    // reader owns their journal. off_record + κ rules enforced in journal.ts.
    if (path === '/api/optimus-journal')
      return handleOptimusJournal(body, env, embed, user.id);
    // MadMind submissions — append-only manuscript archive on D1 (Cloudflare-only
    // replacement for the old Supabase `submissions` table). User-gated above.
    if (path === '/api/madmind')
      return handleMadmind(body, env, user.id, user.email);
    if (path === '/api/elle-duel-engine')       return handleDuelEngine(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-tutor')             return handleTutor(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-doctrine')          return handleDoctrine(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-cohort')            return handleCohort(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-replays')           return handleReplays(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-sandbox')           return handleSandbox(body, env as unknown as LibreEnv);
    // elle-tutor handled above via law.ts
    if (path === '/api/elle-community-signals') return json({ signals: [] });

    return err(`Unknown endpoint: ${path}`, 404);
   } catch (e) {
    // Last line of defense: any uncaught error becomes a clean JSON 500 with CORS
    // headers instead of a raw Worker exception. The chat + dev console parse this
    // as { error } rather than failing the fetch with "load or request failure".
    console.error('[FETCH] unhandled error:', (e as Error)?.stack || (e as Error)?.message || String(e));
    return err((e as Error)?.message || 'Internal error', 500);
   }
  },

  // ── Scheduled crons ────────────────────────────────────────
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const m = now.getUTCMinutes();
    const h = now.getUTCHours();
    console.log(`[CRON] tick ${controller.cron} @ ${now.toISOString()} (h=${h} m=${m})`);
    // A single */1 cron trigger drives every loop (uses 1 of the 5-per-account
    // cron budget). Job selection is by the clock; each runs independently.
    const fire = (job: string) =>
      ctx.waitUntil(runJob(job, env).catch(e => console.error(`[CRON] ${job} failed:`, (e as Error).message)));
    fire('heartbeat');                        // every minute
    if (m % 15 === 0) fire('trading');        // :00 :15 :30 :45 (market-gated server-side)
    if (m === 0) fire('research');            // top of the hour
    if (m === 0) fire('backfill');            // embed any chunkless papers (research-first)
    if (m === 30) fire('conductor');          // half past — Elle's autonomous work tick
    if (h === 3 && m === 0) fire('dream');    // 03:00 UTC
    if (h === 20 && m === 0) fire('journal'); // 20:00 UTC
    if (h === 7 && m === 0) fire('optimus');  // 07:00 UTC — Elle's daily canvas (reads reader, writes unprompted)
  },

  // ── Queue consumer ─────────────────────────────────────────
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const m = msg.body as { type: string; paper_id: string; title: string; series: string; tag: string; chunks_count: number };
      if (m.type === 'paper_ingested') {
        await env.DB.prepare(
          `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'paper_ingested', 'ingest_worker', ?, ?, 'success')`
        ).bind(generateId(), `Ingested: ${m.title}`, JSON.stringify({ paper_id: m.paper_id, chunks: m.chunks_count })).run().catch(() => {});
        await env.DB.prepare(
          `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'reading', 'ingest_worker', ?, 0.7, 0.7)`
        ).bind(generateId(), `Elle read: "${m.title}" (${m.chunks_count} chunks)`).run().catch(() => {});
        msg.ack();
      } else { msg.retry(); }
    }
  },
} satisfies ExportedHandler<Env>;

