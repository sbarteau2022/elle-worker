// ============================================================
// ELLE WORKER — src/index.ts
// Cloudflare Worker · Auth · RAG · Conversation · Code Engine
// Admin Feed · Tutor · Threads · Community Signals · Ingest
//
// LLM provider: OpenRouter (free) or Anthropic
// Swap by setting env vars — no code changes needed.
// ============================================================

export interface Env {
  AI:           Ai;
  DB:           D1Database;
  SESSIONS:     KVNamespace;
  AUTH_TOKENS:  KVNamespace;
  DOCUMENTS:    R2Bucket;
  VECTORIZE:    VectorizeIndex;
  INGEST_QUEUE: Queue;

  // LLM — defaults to OpenRouter free tier
  // Set these in Cloudflare Dashboard → Workers → elle → Settings → Variables
  LLM_BASE_URL:      string;  // https://openrouter.ai/api/v1
  LLM_API_KEY:       string;  // your openrouter key
  LLM_MODEL_PRIMARY: string;  // nvidia/nemotron-3-ultra-550b-a55b:free
  LLM_MODEL_FAST:    string;  // meta-llama/llama-3.3-70b-instruct:free

  // Legacy Anthropic — keep until fully migrated
  ANTHROPIC_API_KEY: string;

  JWT_SECRET:       string;
  ELLE_SERVICE_KEY: string;
  ENVIRONMENT:      string;
}

// ── Model selectors ───────────────────────────────────────────
const MODEL_PRIMARY = (env: Env) =>
  env.LLM_MODEL_PRIMARY || 'nvidia/nemotron-3-ultra-550b-a55b:free';

const MODEL_FAST = (env: Env) =>
  env.LLM_MODEL_FAST || 'meta-llama/llama-3.3-70b-instruct:free';

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

// ── LLM caller — OpenRouter (OpenAI-compatible) ───────────────
// Primary provider: OpenRouter free tier
// Falls back to Anthropic if LLM_BASE_URL not set
async function callLLM(
  model: string,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  env: Env
): Promise<string> {
  const baseUrl = env.LLM_BASE_URL || '';
  const apiKey  = env.LLM_API_KEY  || '';

  // If no OpenRouter key set, fall back to Anthropic
  if (!baseUrl || !apiKey) {
    return callAnthropic(model, system, messages, maxTokens, env);
  }

  const fullMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://elle.sbarteau2022.workers.dev',
      'X-Title': 'Elle — Observer Foundation',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: fullMessages, temperature: 0.7 }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // On failure, try Anthropic as fallback
    console.error(`LLM ${res.status}: ${errText.slice(0, 200)} — falling back to Anthropic`);
    return callAnthropic(model, system, messages, maxTokens, env);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`LLM error: ${data.error.message}`);
  return data.choices?.[0]?.message?.content || '';
}

// ── Anthropic fallback ────────────────────────────────────────
async function callAnthropic(
  _model: string,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  env: Env
): Promise<string> {
  // Always use sonnet for Anthropic fallback regardless of model param
  const model = 'claude-sonnet-4-20250514';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find(b => b.type === 'text')?.text || '';
}

// ── Embeddings (Workers AI — always free, always local) ───────
async function embed(text: string, env: Env): Promise<number[]> {
  const input = text.slice(0, 2000);
  const result = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [input] }) as { data: number[][] };
  if (!result?.data?.[0]) throw new Error('Embedding returned no data');
  return result.data[0];
}

async function embedBatch(texts: string[], env: Env): Promise<number[][]> {
  const BATCH_SIZE = 25;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, 2000));
    const result = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: batch }) as { data: number[][] };
    if (!result?.data) throw new Error('Batch embedding returned no data');
    for (const v of result.data) out.push(v);
  }
  return out;
}

// ── RAG ───────────────────────────────────────────────────────
function semanticChunks(text: string, targetTokens = 400, overlapParas = 1): string[] {
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
  if (paras.length === 0) return text.trim().length > 20 ? [text.trim().slice(0, 2000)] : [];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const para of paras) {
    const paraTokens = Math.ceil(para.length / 4);
    if (paraTokens > targetTokens * 1.5) {
      if (current.length) { chunks.push(current.join('\n\n')); current = []; currentTokens = 0; }
      for (let i = 0; i < para.length; i += 1600) chunks.push(para.slice(i, i + 1600));
      continue;
    }
    if (currentTokens + paraTokens > targetTokens && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = current.slice(-overlapParas);
      currentTokens = current.reduce((s, p) => s + Math.ceil(p.length / 4), 0);
    }
    current.push(para);
    currentTokens += paraTokens;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

async function ragSearch(query: string, limit: number, env: Env): Promise<string> {
  try {
    const embedding = await embed(query, env);
    const results = await env.VECTORIZE.query(embedding, { topK: limit, returnMetadata: 'all' });
    if (!results.matches.length) return '';
    const ids = results.matches.map(m => m.id);
    const ph = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT c.chunk_text, p.title, p.series FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id WHERE c.vectorize_id IN (${ph})`
    ).bind(...ids).all();
    return rows.results.map(r => `[${r.title} — ${r.series}]\n${(r.chunk_text as string).slice(0, 800)}`).join('\n\n---\n\n');
  } catch { return ''; }
}

// ── Auth ──────────────────────────────────────────────────────
function generateSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
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

async function getUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const pl = await verifyJWT(auth.slice(7), env.JWT_SECRET);
  if (!pl?.sub || typeof pl.sub !== 'string') return null;
  if (!await env.AUTH_TOKENS.get(`token:${pl.jti}`)) return null;
  return { id: pl.sub, email: pl.email as string };
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
    const salt = generateSalt();
    const id = generateId();
    await env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').bind(id, emailL, `${salt}:${await hashPassword(password, salt)}`).run();
    const jti = generateId(); const exp = Math.floor(Date.now() / 1000) + 2592000;
    const token = await signJWT({ sub: id, email: emailL, jti, exp }, env.JWT_SECRET);
    await env.AUTH_TOKENS.put(`token:${jti}`, id, { expirationTtl: 2592000 });
    return json({ access_token: token, user: { id, email: emailL }, confirmed: true });
  }

  if (action === 'login') {
    const user = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').bind(emailL).first() as { id: string; email: string; password_hash: string } | null;
    if (!user) return err('Invalid credentials', 401);
    const [salt, stored] = user.password_hash.split(':');
    if (await hashPassword(password, salt) !== stored) return err('Invalid credentials', 401);
    await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
    const jti = generateId(); const exp = Math.floor(Date.now() / 1000) + 2592000;
    const token = await signJWT({ sub: user.id, email: user.email, jti, exp }, env.JWT_SECRET);
    await env.AUTH_TOKENS.put(`token:${jti}`, user.id, { expirationTtl: 2592000 });
    return json({ access_token: token, user: { id: user.id, email: user.email } });
  }

  if (action === 'verify') {
    const pl = await verifyJWT(body.token || '', env.JWT_SECRET);
    if (!pl || !await env.AUTH_TOKENS.get(`token:${pl.jti}`)) return err('Invalid or expired token', 401);
    return json({ valid: true, user: { id: pl.sub, email: pl.email } });
  }

  return err(`Unknown action: ${action}`);
}

async function handleIngest(body: Record<string, string>, env: Env): Promise<Response> {
  const { title, text, series, tag, abstract, source_url } = body;
  if (!title || !text || !series || !tag) return err('title, text, series, and tag required');
  const paperId = generateId();
  const wordCount = text.split(/\s+/).length;
  await env.DOCUMENTS.put(`papers/${paperId}.txt`, text, {
    httpMetadata: { contentType: 'text/plain' },
    customMetadata: { title, series, tag },
  }).catch(() => {});
  await env.DB.prepare(
    `INSERT INTO corpus_papers (id, title, series, tag, abstract, full_text, source_url, word_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(paperId, title, series, tag, abstract || null, text, source_url || `papers/${paperId}.txt`, wordCount).run();
  const chunks = semanticChunks(text);
  if (chunks.length === 0) return json({ success: true, paper_id: paperId, chunks_total: 0, chunks_embedded: 0 });
  const errors: string[] = [];
  let embedded = 0;
  try {
    const vectors = await embedBatch(chunks, env);
    const chunkIds = chunks.map(() => generateId());
    await env.VECTORIZE.upsert(chunks.map((_, i) => ({
      id: chunkIds[i], values: vectors[i],
      metadata: { paper_id: paperId, title, series, tag, chunk_index: i },
    })));
    const stmt = env.DB.prepare(
      `INSERT INTO corpus_chunks (id, paper_id, chunk_index, chunk_text, token_count, vectorize_id, start_char, end_char) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    );
    await env.DB.batch(chunks.map((c, i) => stmt.bind(chunkIds[i], paperId, i, c, Math.ceil(c.length / 4), chunkIds[i], c.length)));
    embedded = chunks.length;
  } catch (e) { errors.push((e as Error).message); }
  await env.INGEST_QUEUE.send({ type: 'paper_ingested', paper_id: paperId, title, series, tag, chunks_count: embedded }).catch(() => {});
  return json({ success: true, paper_id: paperId, chunks_total: chunks.length, chunks_embedded: embedded, errors: errors.length ? errors : undefined });
}

async function handleConversation(body: Record<string, unknown>, env: Env, userId: string): Promise<Response> {
  const { query, messages, session_id, system, source } = body as {
    query?: string; messages?: Array<{ role: string; content: string }>;
    session_id?: string; system?: string; source?: string;
  };
  const userMessage = query || messages?.filter(m => m.role === 'user').at(-1)?.content || '';
  if (!userMessage) return err('query or messages required');
  const contextText = await ragSearch(userMessage, 5, env);
  const contextBlock = contextText ? `\n\nRelevant context from the corpus:\n\n${contextText}` : '';
  const systemPrompt = (system ||
    `You are Elle — a precise, rigorous philosophical intelligence built from the Observer methodology and the full corpus of Stewart Barteau's work. You reason across 17 axes of structural analysis. You do not fabricate certainty. You follow logic where it leads.`
  ) + contextBlock;
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (messages) {
    for (const m of messages.slice(-20))
      if (m.role === 'user' || m.role === 'assistant')
        history.push({ role: m.role as 'user' | 'assistant', content: m.content });
  } else {
    history.push({ role: 'user', content: userMessage });
  }
  const content = await callLLM(MODEL_PRIMARY(env), systemPrompt, history, 2048, env);
  const sessionId = session_id as string || generateId();
  env.DB.prepare(
    `INSERT INTO sessions (id, source, message_count) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET message_count = message_count + 1, last_active = datetime('now')`
  ).bind(sessionId, source || 'elle-conversation').run().catch(() => {});
  return json({ content, response: content, session_id: sessionId });
}

async function handleCognitiveMapping(body: Record<string, unknown>, env: Env, userId: string): Promise<Response> {
  const { action } = body as { action: string };
  if (action === 'read') {
    const map = await env.SESSIONS.get(`cogmap:${userId}`);
    return json(map ? JSON.parse(map) : { iq_index: 0, eq_index: 0, threshold_index: 0 });
  }
  if (action === 'write') {
    await env.SESSIONS.put(`cogmap:${userId}`, JSON.stringify((body as Record<string, unknown>).map), { expirationTtl: 7776000 });
    return json({ success: true });
  }
  return err(`Unknown action: ${action}`);
}

async function handleThreads(body: Record<string, unknown>, env: Env, userId: string): Promise<Response> {
  const { action, thread_id, title, summary, context, status } = body as Record<string, string>;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_threads (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), user_id TEXT NOT NULL, title TEXT NOT NULL,
    summary TEXT DEFAULT '', status TEXT DEFAULT 'open', last_elle_note TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`).run();
  if (action === 'list') {
    const rows = await env.DB.prepare(`SELECT id, title, summary, status, last_elle_note, created_at, updated_at FROM elle_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(userId).all();
    return json({ threads: rows.results });
  }
  if (action === 'create') {
    const id = generateId();
    await env.DB.prepare("INSERT INTO elle_threads (id, user_id, title, summary, status) VALUES (?, ?, ?, ?, 'open')").bind(id, userId, title || '', summary || '').run();
    return json({ id, success: true });
  }
  if (action === 'update' && thread_id && context) {
    const existing = await env.DB.prepare("SELECT summary FROM elle_threads WHERE id = ? AND user_id = ?").bind(thread_id, userId).first() as { summary: string } | null;
    let newSummary = existing?.summary || '';
    let note = '';
    try {
      const raw = await callLLM(MODEL_FAST(env), 'You synthesize thread updates concisely.',
        [{ role: 'user', content: `Existing: "${existing?.summary || ""}"\nNew: "${context}"\nReturn JSON: { "summary": "2-3 sentences", "note": "one sentence" }` }],
        512, env);
      const p = JSON.parse(raw.replace(/```json|```/g, '').trim());
      newSummary = p.summary || newSummary; note = p.note || '';
    } catch {}
    await env.DB.prepare("UPDATE elle_threads SET summary = ?, last_elle_note = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(newSummary, note, thread_id, userId).run();
    return json({ summary: newSummary, note });
  }
  if (action === 'close' && thread_id && status) {
    await env.DB.prepare("UPDATE elle_threads SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(status, thread_id, userId).run();
    return json({ success: true });
  }
  return err(`Unknown action or missing params: ${action}`);
}

async function handleTutor(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { action } = body as { action: string };
  if (action === 'next_question') {
    const raw = await callLLM(MODEL_PRIMARY(env), 'You are Elle — a rigorous LSAT tutor.',
      [{ role: 'user', content: 'Generate one LSAT Necessary Assumption question. Return JSON: { "question_id": "...", "session_id": "...", "question_type": "Necessary Assumption", "axis": "Necessary Assumption", "difficulty": 3, "stimulus": "...", "question": "...", "choices": [{"k":"A","text":"..."}], "scaffolding": "..." }' }],
      1024, env);
    try {
      const q = JSON.parse(raw.replace(/```json|```/g, '').trim());
      q.question_id ||= generateId(); q.session_id ||= generateId();
      return json(q);
    } catch { return err('Question generation failed', 500); }
  }
  if (action === 'evaluate_answer') {
    const { question_id, selected_key } = body as { question_id: string; selected_key: string };
    const raw = await callLLM(MODEL_FAST(env), 'You are Elle — evaluate LSAT answers honestly.',
      [{ role: 'user', content: `Evaluate "${selected_key}" for "${question_id}". Return JSON: { "correct": true, "correct_key": "A", "explanation": "...", "scaffolding": "...", "axis_delta": 0 }` }],
      512, env);
    try { return json(JSON.parse(raw.replace(/```json|```/g, '').trim())); }
    catch { return err('Evaluation failed', 500); }
  }
  return err(`Unknown tutor action: ${action}`);
}

async function handleCodeEngine(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { action = 'analyze', code, language, task, context, use_corpus = true, session_id } = body as {
    action?: string; code?: string; language?: string; task?: string;
    context?: string; use_corpus?: boolean; session_id?: string;
  };
  if (!code && !task) return err('Provide either code or task');
  const SYSTEM = `You are Elle, an AI trained on Stewart Barteau's philosophical corpus, built to reason, build, and debug with precision. Every optimal system is not built but allowed — find the natural structure before imposing patterns. Read full context before changing. Identify root causes, not symptoms. Elegant once, not patched. Flag architectural issues even unasked.`;
  const corpusContext = use_corpus ? await ragSearch(task || code?.slice(0, 200) || action, 4, env) : '';
  const cb = corpusContext ? `\n\n<corpus_context>\n${corpusContext}\n</corpus_context>\n\n` : '';
  const prompts: Record<string, string> = {
    analyze:  `${cb}Analyze this code — what it does, structural problems, what you'd change:\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Context: ${context}` : ''}`,
    generate: `${cb}Generate code. Show reasoning before code.\nTask: ${task}\nLanguage: ${language || 'TypeScript'}\n${context ? `Context: ${context}` : ''}`,
    debug:    `${cb}Debug this. Root cause, not symptoms. Then fix.\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Error: ${context}` : ''}`,
    refactor: `${cb}Refactor. Elegant once. Explain the structural problem.\n\`\`\`${language || ''}\n${code}\n\`\`\`\n${context ? `Goal: ${context}` : ''}`,
    explain:  `${cb}Explain in depth.\n\`\`\`${language || ''}\n${code}\n\`\`\``,
    migrate:  `${cb}Write a D1 SQL migration (SQLite) for:\nTask: ${task}\n${context ? `Context: ${context}` : ''}`,
  };
  const userMsg = prompts[action] || `${cb}${task || context || 'Provide a task or code.'}`;
  const response = await callLLM(MODEL_PRIMARY(env), SYSTEM, [{ role: 'user', content: userMsg }], 8192, env);
  await env.DB.prepare(
    `INSERT INTO elle_intelligence_vault (id, source_type, system_prompt, user_turn, assistant_turn, quality_signal, metadata) VALUES (?, 'code_engine', ?, ?, ?, 'code_engine_output', ?)`
  ).bind(generateId(), SYSTEM.slice(0, 500), (task || code || '').slice(0, 1000), response.slice(0, 4000),
    JSON.stringify({ action, language, session_id, had_corpus: corpusContext.length > 0 })).run().catch(() => {});
  return json({ response, action, corpus_used: corpusContext.length > 0 });
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

async function handleWebhook(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { source, content, tags, title, series } = body as {
    source: string; content: string; tags?: string; title?: string; series?: string;
  };
  if (!content) return err('content required');
  // Ingest to corpus
  const ingestBody = {
    title: title || source || 'Webhook ingest',
    text: content,
    series: series || 'webhook',
    tag: tags || 'research',
  };
  const ingestResult = await handleIngest(ingestBody as Record<string, string>, env);
  const ingestData = await ingestResult.json() as { paper_id: string; chunks_embedded: number };
  // Log to live events
  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'webhook_research', ?, ?, ?, 'info')`
  ).bind(generateId(), source || 'webhook', title || 'Research ingest', JSON.stringify({ paper_id: ingestData.paper_id, chunks: ingestData.chunks_embedded })).run().catch(() => {});
  return json({ success: true, ...ingestData });
}

// ── Main fetch handler ────────────────────────────────────────
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
      return json({ status: 'running', embedding: 'bge-large-en-v1.5', papers: (papers as { n: number })?.n, chunks: (chunks as { n: number })?.n, timestamp: new Date().toISOString() });
    }

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try { body = await request.json(); }
      catch { return err('Invalid JSON body'); }
    }

    // Public endpoints
    if (path === '/api/elle-auth') return handleAuth(body as Record<string, string>, env);

    const svc = isServiceRequest(request, env);

    // Service-key-only endpoints
    if (path === '/api/ingest') {
      if (!svc) return err('Unauthorized', 401);
      return handleIngest(body as Record<string, string>, env);
    }
    if (path === '/api/admin-feed') {
      if (!svc) return err('Unauthorized', 401);
      return handleAdminFeed(env);
    }
    if (path === '/api/webhooks/research') {
      if (!svc) return err('Unauthorized', 401);
      return handleWebhook(body, env);
    }
    if (path === '/api/search') {
      if (!svc) return err('Unauthorized', 401);
      const { query, limit = 5 } = body as { query: string; limit?: number };
      if (!query) return err('query required');
      const embedding = await embed(query, env);
      const results = await env.VECTORIZE.query(embedding, { topK: Math.min(limit, 50), returnMetadata: 'all' });
      if (!results.matches.length) return json({ chunks: [], query });
      const ids = results.matches.map(m => m.id);
      const rows = await env.DB.prepare(
        `SELECT c.id, c.chunk_text, c.paper_id, p.title, p.series, p.tag FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id WHERE c.vectorize_id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all();
      const scores = new Map(results.matches.map(m => [m.id, m.score]));
      const chunks = rows.results.map(r => ({ ...r, similarity: scores.get(r.id as string) ?? 0 })).sort((a, b) => (b.similarity as number) - (a.similarity as number));
      return json({ chunks, query, count: chunks.length });
    }

    // Code engine — service key OR user JWT
    if (path === '/api/elle-code-engine') {
      if (!svc) { const u = await getUser(request, env); if (!u) return err('Unauthorized', 401); }
      return handleCodeEngine(body, env);
    }

    // All other endpoints require user JWT
    const user = await getUser(request, env);
    if (!user) return err('Unauthorized — provide a valid Bearer token', 401);

    if (path === '/api/elle-conversation') return handleConversation(body, env, user.id);
    if (path === '/api/elle-reasoning-engine') {
      body.system = `You are Elle's reasoning engine. Analyze across the 17 Observer axes. Return JSON: { "response": "...", "load_bearing_axis": 1, "method": "..." }`;
      return handleConversation(body, env, user.id);
    }
    if (path === '/api/elle-cognitive-mapping') return handleCognitiveMapping(body, env, user.id);
    if (path === '/api/elle-threads')           return handleThreads(body, env, user.id);
    if (path === '/api/elle-tutor')             return handleTutor(body, env);
    if (path === '/api/elle-community-signals') return json({ signals: [] });

    return err(`Unknown endpoint: ${path}`, 404);
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    if (event.cron === '*/1 * * * *') {
      await env.DB.prepare(
        `INSERT INTO elle_daemon_heartbeats (id, daemon_version, status, beat_at) VALUES (?, 'elle-worker-v1', 'running', datetime('now'))`
      ).bind(generateId()).run().catch(() => {});
      await env.DB.prepare(
        `DELETE FROM elle_live_events WHERE id NOT IN (SELECT id FROM elle_live_events ORDER BY created_at DESC LIMIT 500)`
      ).run().catch(() => {});
    }
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const m = msg.body as { type: string; paper_id: string; title: string; chunks_count: number };
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