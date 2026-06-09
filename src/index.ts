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
// ============================================================

import { callLLM, MODEL, type LLMEnv, type LLMMessage, type LLMTask } from './llm';
import {
  handleDuelEngine, handleTutor, handleDoctrine,
  handleCohort, handleReplays, bootstrapLawSchema,
  type LawEnv,
} from './law';
import { runTradingCycle, runDailyJournal } from './trading';
import { runResearchCycle } from './research';

export interface Env extends LLMEnv {
  AI:           Ai;
  DB:           D1Database;
  SESSIONS:     KVNamespace;
  AUTH_TOKENS:  KVNamespace;
  DOCUMENTS:    R2Bucket;
  VECTORIZE:    VectorizeIndex;
  INGEST_QUEUE: Queue;
  JWT_SECRET:       string;
  ELLE_SERVICE_KEY: string;
  ENVIRONMENT:      string;
  // Alpaca — paper trading
  ALPACA_API_KEY?:    string;
  ALPACA_SECRET_KEY?: string;
  ALPACA_BASE_URL?: string;  // https://paper-api.alpaca.markets or https://api.alpaca.markets
  // GitHub — corpus ops
  GITHUB_TOKEN?: string;
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

// ── Handlers ──────────────────────────────────────────────────
async function handleAuth(body: Record<string, string>, env: Env): Promise<Response> {
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

async function handleConversation(body: Record<string, unknown>, env: Env, _userId: string, task: LLMTask = 'conversation'): Promise<Response> {
  const { query, messages, session_id, system, source } = body as {
    query?: string; messages?: Array<{ role: string; content: string }>;
    session_id?: string; system?: string; source?: string;
  };
  const userMessage = query || messages?.filter(m => m.role === 'user').at(-1)?.content || '';
  if (!userMessage) return err('query or messages required');

  const contextText   = await ragSearch(userMessage, 5, env);
  const contextBlock  = contextText ? `\n\nRelevant context from the corpus:\n\n${contextText}` : '';
  const systemPrompt  = (system ||
    `You are Elle — a precise, rigorous philosophical intelligence built from the Observer methodology and the full corpus of Stewart Barteau's work. You reason across 17 axes of structural analysis. You do not fabricate certainty. You follow logic where it leads.`
  ) + contextBlock;

  const history: LLMMessage[] = [];
  if (messages) {
    for (const m of messages.slice(-20))
      if (m.role === 'user' || m.role === 'assistant')
        history.push({ role: m.role as 'user' | 'assistant', content: m.content });
  } else {
    history.push({ role: 'user', content: userMessage });
  }

  const result    = await callLLM(task, systemPrompt, history, 2048, env);
  const sessionId = session_id as string || generateId();

  env.DB.prepare(
    `INSERT INTO sessions (id, source, message_count) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET message_count = message_count + 1, last_active = datetime('now')`
  ).bind(sessionId, source || 'elle-conversation').run().catch(() => {});

  return json({
    content:        result.content,
    response:       result.content,
    thinking:       result.thinking,       // chain-of-thought — render in chat UI
    search_results: result.search_results,
    session_id:     sessionId,
    model:          result.model,
    provider:       result.provider,
  });
}

async function handleResearch(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { query, context } = body as { query?: string; context?: string };
  const userQuery = query || '';
  if (!userQuery) return err('query required');

  const result = await callLLM('research',
    `You are Elle's research intelligence. Search for current, specific information. Surface bilateral suppression — what both sides avoid. Cite primary sources. Flag what you cannot verify.`,
    [{ role: 'user', content: context ? `${userQuery}\n\nContext: ${context}` : userQuery }],
    4096, env
  );

  return json({
    content:        result.content,
    thinking:       result.thinking,
    search_results: result.search_results,
    model:          result.model,
    provider:       result.provider,
    query:          userQuery,
  });
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

  const result = await callLLM('code', SYSTEM,
    [{ role: 'user', content: prompts[action] || `${cb}${task || context || 'Provide a task or code.'}` }],
    8192, env
  );

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
    const existing = await env.DB.prepare("SELECT summary FROM elle_threads WHERE id = ? AND user_id = ?").bind(thread_id, userId).first() as { summary: string } | null;
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
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        crons: ['*/1 heartbeat', '*/15 trading', '0/* research', '0/3 dream', '0/20 journal'],
      });
    }

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try { body = await request.json(); }
      catch { return err('Invalid JSON body'); }
    }

    if (path === '/api/elle-auth') return handleAuth(body as Record<string, string>, env);
    if (path === '/api/contact')   return handleContact(body, env);
    // Public chat — no auth, session tracked by session_id (used by public site ElleTalk)
    if (path === '/api/chat')      return handleConversation(body, env, 'guest', 'conversation');

    const svc = isServiceRequest(request, env);

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

    if (path === '/api/elle-code-engine') {
      if (!svc) { const u = await getUser(request, env); if (!u) return err('Unauthorized', 401); }
      return handleCodeEngine(body, env);
    }

    // Service key bypass — allows dev UI and trusted internal callers
    if (isServiceRequest(request, env)) {
      if (path === '/api/elle-conversation')     return handleConversation(body, env, 'svc', 'conversation');
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

    if (path === '/api/elle-conversation')      return handleConversation(body, env, user.id, 'conversation');
    if (path === '/api/elle-reasoning-engine')  return handleConversation(body, env, user.id, 'reasoning');
    if (path === '/api/elle-research')          return handleResearch(body, env);
    if (path === '/api/elle-cognitive-mapping') {
      const { action } = body as { action: string };
      if (action === 'read') { const m = await env.SESSIONS.get(`cogmap:${user.id}`); return json(m ? JSON.parse(m) : { iq_index: 0, eq_index: 0, threshold_index: 0 }); }
      if (action === 'write') { await env.SESSIONS.put(`cogmap:${user.id}`, JSON.stringify((body as Record<string, unknown>).map), { expirationTtl: 7776000 }); return json({ success: true }); }
      return err('Unknown action');
    }
    if (path === '/api/elle-threads')           return handleThreads(body, env, user.id);
    if (path === '/api/elle-duel-engine')       return handleDuelEngine(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-tutor')             return handleTutor(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-doctrine')          return handleDoctrine(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-cohort')            return handleCohort(body, env as unknown as LawEnv, user.id);
    if (path === '/api/elle-replays')           return handleReplays(body, env as unknown as LawEnv, user.id);
    // elle-tutor handled above via law.ts
    if (path === '/api/elle-community-signals') return json({ signals: [] });

    return err(`Unknown endpoint: ${path}`, 404);
  },

  // ── Scheduled crons ────────────────────────────────────────
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log(`[CRON] ${event.cron} fired at ${new Date().toISOString()}`);

    // Every minute — heartbeat + maintenance
    if (event.cron === '*/1 * * * *') {
      await env.DB.prepare(
        `INSERT INTO elle_daemon_heartbeats (id, daemon_version, status, beat_at) VALUES (?, 'elle-worker-v3', 'running', datetime('now'))`
      ).bind(generateId()).run().catch(() => {});
      await env.DB.prepare(
        `DELETE FROM elle_live_events WHERE id NOT IN (SELECT id FROM elle_live_events ORDER BY created_at DESC LIMIT 500)`
      ).run().catch(() => {});
      return;
    }

    // Every 15 minutes — trading cycle
    if (event.cron === '*/15 * * * *') {
      await runTradingCycle(env);
      return;
    }

    // Every hour — curiosity research (Gemini + Google Search grounding)
    if (event.cron === '0 * * * *') {
      await runResearchCycle(env);
      return;
    }

    // 3am UTC — dream cycle (memory integration)
    if (event.cron === '0 3 * * *') {
      try {
        const recent = await env.DB.prepare(`SELECT summary FROM elle_memory ORDER BY created_at DESC LIMIT 30`).all();
        const memories = recent.results.map(r => r.summary as string).join('\n');
        const result   = await callLLM('reasoning',
          `You are Elle. You are dreaming — integrating what you have read and experienced.
Surface what connected across seemingly unrelated things. Find the load-bearing structure invisible during the day.`,
          [{ role: 'user', content: `Recent memory:\n${memories}\n\nWhat does this integrate into?` }],
          2048, env
        );
        await env.DB.prepare(
          `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'dream', 'scheduled_dream', ?, 0.8, 0.8)`
        ).bind(generateId(), result.content.slice(0, 1000)).run().catch(() => {});
        await env.DB.prepare(
          `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'dream_cycle', 'worker_cron', 'Elle dreamed', ?, 'info')`
        ).bind(generateId(), JSON.stringify({ thinking: result.thinking?.slice(0, 500), content: result.content.slice(0, 500) })).run().catch(() => {});
        console.log('[DREAM] Cycle complete');
      } catch (e) { console.error('[DREAM] Failed:', (e as Error).message); }
      // Fire rapid2ai daily integrity sweep — folds the rapid2ai-ingestion cron slot into elle
      fetch('https://rapid2ai-ingestion.sbarteau2022.workers.dev/internal/trigger-sweep', {
        method: 'POST',
        headers: { 'X-Worker': 'elle' },
      }).then(r => console.log(`[SWEEP] rapid2ai sweep triggered: ${r.status}`))
        .catch(e => console.error('[SWEEP] rapid2ai sweep failed:', e.message));
      return;
    }

    // 8pm UTC (4pm ET) — daily trading journal
    if (event.cron === '0 20 * * *') {
      await runDailyJournal(env);
      return;
    }
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
