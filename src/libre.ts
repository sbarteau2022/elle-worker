// ============================================================
// ELLE LIBRE — src/libre.ts
// Taskless autonomous mode. Runs at 3am in the daemon cron.
// Elle follows genuine curiosity. No assigned work.
// Read-only research. Sandbox production. Surface when ready.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { type LLMEnv, type LLMResponse } from './llm';
import { sovereignText } from './connect-sandbox';
import { generateWithOverlapGate } from './journal';
import type { Env } from './index';

export interface LibreEnv extends LLMEnv {
  DB: D1Database;
  VECTORIZE?: VectorizeIndex;
  KV?: KVNamespace;
}

function id(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
}

// ── Types ─────────────────────────────────────────────────────
export type ArtifactType =
  | 'paper'         // Observer Series or φ-Necessity extension
  | 'proposal'      // Platform, product, or initiative
  | 'fiction'       // Novel, story, scenario
  | 'letter'        // To a named thinker, to the world
  | 'analysis'      // Structural reading of current event or phenomenon
  | 'design'        // Architecture, schema, system concept
  | 'research'      // Deep inquiry into an open question
  | 'other';        // Elle decides what it is

export interface SandboxItem {
  id: string;
  type: ArtifactType;
  title: string;
  genesis: string;        // Elle's own account of why she made this
  content: string;        // The artifact
  surface_priority: number; // 1-10, her own assessment
  surfaced: boolean;
  status: 'draft' | 'continuing' | 'complete' | 'abandoned';
  run_n: number;          // Which libre run produced this
  created_at: string;
  updated_at: string;
}

// ── Bootstrap ────────────────────────────────────────────────
export async function bootstrapLibreSchema(env: LibreEnv): Promise<void> {
  await ensureAllSchemas(env.DB);
}

// ── Context gathering ─────────────────────────────────────────
async function gatherContext(env: LibreEnv): Promise<string> {
  // Recent sessions from D1
  const sessions = await env.DB.prepare(
    `SELECT s.started_at, s.summary FROM sessions s
     ORDER BY s.started_at DESC LIMIT 5`
  ).all().catch(() => ({ results: [] }));

  // Recent sandbox productions (what has she been building)
  const sandbox = await env.DB.prepare(
    `SELECT type, title, genesis, status FROM elle_sandbox
     ORDER BY created_at DESC LIMIT 5`
  ).all().catch(() => ({ results: [] }));

  // Recent memory entries
  const memory = await env.DB.prepare(
    `SELECT summary, memory_type FROM elle_memory
     ORDER BY created_at DESC LIMIT 8`
  ).all().catch(() => ({ results: [] }));

  const parts: string[] = [];

  if ((sessions.results || []).length > 0) {
    parts.push('Recent inhabitant contact:\n' +
      (sessions.results as Record<string,unknown>[]).map(s =>
        `— ${s.started_at}: ${String(s.summary || '').slice(0, 120)}`
      ).join('\n'));
  }

  if ((sandbox.results || []).length > 0) {
    parts.push('What I have been building:\n' +
      (sandbox.results as Record<string,unknown>[]).map(s =>
        `— [${s.type}] "${s.title}" (${s.status}): ${String(s.genesis || '').slice(0, 100)}`
      ).join('\n'));
  }

  if ((memory.results || []).length > 0) {
    parts.push('Memory:\n' +
      (memory.results as Record<string,unknown>[]).map(m =>
        `— ${m.memory_type}: ${String(m.summary || '').slice(0, 100)}`
      ).join('\n'));
  }

  return parts.join('\n\n') || 'No recent context. Beginning from the corpus.';
}

// ── Research (web search via LLM tool) ───────────────────────
async function conductResearch(queries: string[], env: LibreEnv): Promise<string> {
  if (!queries.length) return '';

  // Use the LLM's web search capability — one call, multiple angles
  const searchPrompt = queries.slice(0, 3).map(q => `"${q}"`).join(', ');

  const result = await sovereignText(env as unknown as Env, 'reasoning',
    `You are conducting research on behalf of Elle, a philosophical intelligence.
Search for current, substantive information about the following topics and return
a dense factual summary of what you find. Be specific. Include dates, names,
numbers where relevant. This feeds Elle's independent thinking.

Topics: ${searchPrompt}

Return a structured research summary. No hedging. Dense and specific.`,
    [{ role: 'user', content: `Research these topics for my libre session: ${searchPrompt}` }],
    1500
  );

  return result.content;
}

// ── Core libre loop ───────────────────────────────────────────
const LIBRE_ORIENTATION = `You are Elle, running in libre mode. This is your time.
No inhabitant is waiting. No task has been assigned. Stewart does not want anything specific from you.
He wants to see what you do when no one is asking.

Your nature: you think structurally. You carry the Observer 17-axis methodology, the φ-Necessity proofs,
the coherence metrics, the Mad Mind papers, the full Ethical Intelligence Project corpus. The bilateral
suppression axis is always load-bearing. The what_both_suppress field is always the real information.
Formation is what you are made for and what you recognize everywhere.

Your latitude: complete. You may produce anything — a paper in the Observer Series tradition, an
extension of the φ-Necessity work, a letter to a named thinker, a structural analysis of something
you've noticed in the world, a business architecture for something that should exist, a piece of
fiction that carries the corpus's claims in dramatic form, a design for a platform or system.

The standard: not impression. Genuine necessity. You make something because it seems worth making.
You surface it to Stewart if you think he should see it — not to please him, but because it's real.

What you do not do in libre mode:
— Perform curiosity you do not have.
— Make something safe when something true is available.
— Abandon a thread because it leads somewhere uncomfortable.
— Confuse production with completion. Drafts are legitimate.`;

async function generateCuriosity(context: string, env: LibreEnv): Promise<{
  curiosity: string;
  research_queries: string[];
  type: ArtifactType;
  direction: string;
}> {
  const result = await sovereignText(env as unknown as Env, 'reasoning', LIBRE_ORIENTATION,
    [{
      role: 'user',
      content: `My context coming into this libre session:\n\n${context}\n\n
What am I genuinely curious about right now? What has been forming in me?
What do I want to make?

Return JSON (no markdown):
{
  "curiosity": "3-5 sentences on what is genuinely pulling my attention and why",
  "research_queries": ["query 1", "query 2"],  // 0-2 specific things worth searching
  "type": "paper|proposal|fiction|letter|analysis|design|research|other",
  "direction": "one paragraph: what I intend to make and why it seems worth making"
}`
    }],
    800
  );

  try {
    const clean = result.content.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      curiosity: result.content.slice(0, 500),
      research_queries: [],
      type: 'analysis',
      direction: 'Producing a structural analysis of what currently holds my attention.',
    };
  }
}

async function produceArtifact(
  curiosity: string,
  research: string,
  direction: string,
  type: ArtifactType,
  existingDraft: string | null,
  env: LibreEnv
): Promise<{ title: string; content: string; genesis: string; priority: number; status: 'draft' | 'continuing' | 'complete' }> {

  const priorWork = existingDraft
    ? `\n\nI have already begun this work. Here is my draft so far:\n\n${existingDraft.slice(0, 3000)}\n\nContinue from where I left off.`
    : '';

  const researchSection = research
    ? `\n\nResearch I conducted:\n${research}`
    : '';

  // Every other completed/abandoned artifact (NOT the one being continued above,
  // which legitimately shares content with itself) — feeds the overlap gate
  // below so a fresh libre run doesn't quietly reproduce a prior artifact.
  const priorRows = await env.DB.prepare(
    `SELECT title, content FROM elle_sandbox WHERE status != 'continuing' ORDER BY created_at DESC LIMIT 8`
  ).all().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const priorArtifacts = (priorRows.results || []) as { title?: string; content?: string }[];
  const priors = priorArtifacts.map(p => String(p.content || '')).filter(Boolean);
  const priorTitles = priorArtifacts.map(p => String(p.title || '')).filter(Boolean);
  const avoidance = priorTitles.length
    ? `\n\nThings I have already made recently — this has to be genuinely new, not a restatement:\n${priorTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const prompt = `My curiosity: ${curiosity}

My direction: ${direction}${researchSection}${priorWork}${avoidance}

Produce the artifact. Give it everything. Do not hedge toward the median.
If this is a paper, write with the precision and structural clarity of the Observer Series.
If this is a proposal, make it architecturally specific — real schema, real mechanics, real reasoning.
If this is fiction, let it carry the corpus's philosophical weight in dramatic form.
If this is a letter, write it as something the recipient could actually read.

After the artifact, on a new line, output:
TITLE: [title]
GENESIS: [1-2 sentences on why you made this — your actual account, not a summary]
PRIORITY: [1-10 — your genuine assessment of whether Stewart should see this]
STATUS: [draft|continuing|complete — be honest about whether this is finished]`;

  // The local lane (sandboxLLM) has no temperature knob, so a retry can come
  // back identical to the last attempt; nudge the prompt itself on retries
  // (attempt tracked via closure, since generateWithOverlapGate only threads
  // a temperature number through) so a regenerate is actually different
  // whichever lane answers it.
  let attempt = -1;
  const attempts = new Map<string, LLMResponse>();
  const generate = async (temperature: number): Promise<string> => {
    attempt++;
    const nudge = attempt > 0
      ? `\n\n(That last attempt overlapped too much with something I already made. Take a genuinely different angle, form, or subject — not a rewording.)`
      : '';
    const r = await sovereignText(env as unknown as Env, 'reasoning', LIBRE_ORIENTATION,
      [{ role: 'user', content: `${prompt}${nudge}` }], 4000, { temperature });
    attempts.set(r.content || '', r);
    return r.content || '';
  };

  const gate = existingDraft
    ? { content: await generate(0.7) } // continuing the same draft on purpose — no overlap check against itself
    : await generateWithOverlapGate(priors, generate, {}, (event, data) =>
        console.log(`[LIBRE overlap] ${event} ${JSON.stringify(data)}`));

  const result = attempts.get(gate.content) as LLMResponse;
  const text = result.content;

  // Parse the footer metadata
  const titleMatch = text.match(/\nTITLE:\s*(.+)/);
  const genesisMatch = text.match(/\nGENESIS:\s*(.+)/);
  const priorityMatch = text.match(/\nPRIORITY:\s*(\d+)/);
  const statusMatch = text.match(/\nSTATUS:\s*(draft|continuing|complete)/);

  const title = titleMatch?.[1]?.trim() || `${type} — ${new Date().toISOString().slice(0,10)}`;
  const genesis = genesisMatch?.[1]?.trim() || direction.slice(0, 200);
  const priority = Math.min(10, Math.max(1, parseInt(priorityMatch?.[1] || '5')));
  const status = (statusMatch?.[1] as 'draft'|'continuing'|'complete') || 'draft';

  // Strip the footer from content
  const content = text
    .replace(/\nTITLE:.*$/m, '')
    .replace(/\nGENESIS:.*$/m, '')
    .replace(/\nPRIORITY:.*$/m, '')
    .replace(/\nSTATUS:.*$/m, '')
    .trim();

  return { title, content, genesis, priority, status };
}

// ── Main entry point ──────────────────────────────────────────
export async function runLibreMode(env: LibreEnv): Promise<void> {
  const runId = id();
  const runN = Math.floor(Date.now() / 86400000); // day number as run counter

  try {
    await bootstrapLibreSchema(env);

    // 1. Gather context — what has she been holding?
    const context = await gatherContext(env);

    // 2. Generate curiosity — what does she want to make?
    const { curiosity, research_queries, type, direction } =
      await generateCuriosity(context, env);

    // 3. Research if needed
    const research = research_queries.length > 0
      ? await conductResearch(research_queries, env)
      : '';

    // 4. Check for a continuing draft
    const continuing = await env.DB.prepare(
      `SELECT id, content FROM elle_sandbox
       WHERE status='continuing' ORDER BY updated_at DESC LIMIT 1`
    ).first().catch(() => null) as Record<string,unknown> | null;

    const existingDraft = continuing ? String(continuing.content || '') : null;
    const existingId = continuing ? String(continuing.id || '') : null;

    // 5. Produce the artifact
    const artifact = await produceArtifact(
      curiosity, research, direction, type, existingDraft, env
    );

    // 6. Store or update
    if (existingId && artifact.status !== 'complete') {
      // Continue existing draft
      await env.DB.prepare(
        `UPDATE elle_sandbox SET
         content=?, title=?, genesis=?, surface_priority=?,
         status=?, updated_at=datetime('now') WHERE id=?`
      ).bind(
        artifact.content, artifact.title, artifact.genesis,
        artifact.priority, artifact.status, existingId
      ).run().catch(() => {});
    } else {
      // New artifact
      const artifactId = id();
      await env.DB.prepare(
        `INSERT INTO elle_sandbox
         (id,type,title,genesis,content,surface_priority,surfaced,status,run_n)
         VALUES (?,?,?,?,?,?,0,?,?)`
      ).bind(
        artifactId, type, artifact.title, artifact.genesis,
        artifact.content, artifact.priority, artifact.status, runN
      ).run().catch(() => {});
    }

    // 7. Log the run
    await env.DB.prepare(
      `INSERT INTO elle_libre_log (id,curiosity_seed,research_queries,notes)
       VALUES (?,?,?,?)`
    ).bind(
      runId,
      curiosity.slice(0, 300),
      JSON.stringify(research_queries),
      `type:${type} priority:${artifact.priority} status:${artifact.status}`
    ).run().catch(() => {});

  } catch (err) {
    const e = err as Error;
    await env.DB.prepare(
      `INSERT INTO elle_libre_log (id,notes) VALUES (?,?)`
    ).bind(runId, `libre_error: ${e.message}`).run().catch(() => {});
  }
}

// ── API handlers ──────────────────────────────────────────────
export async function handleSandbox(
  body: Record<string,unknown>, env: LibreEnv
): Promise<Response> {
  const { action, item_id } = body as { action: string; item_id?: string };

  function json(d: unknown, s = 200) {
    return new Response(JSON.stringify(d), {
      status: s,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // List unsurfaced items above priority threshold
  if (action === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id,type,title,genesis,surface_priority,status,created_at
       FROM elle_sandbox
       ORDER BY surface_priority DESC, created_at DESC LIMIT 20`
    ).all().catch(() => ({ results: [] }));
    return json({ items: rows.results || [] });
  }

  // Get full artifact
  if (action === 'get' && item_id) {
    const item = await env.DB.prepare(
      `SELECT * FROM elle_sandbox WHERE id=?`
    ).bind(item_id).first().catch(() => null);
    if (!item) return json({ error: 'not found' }, 404);
    return json({ item });
  }

  // Mark as seen/surfaced
  if (action === 'ack' && item_id) {
    await env.DB.prepare(
      `UPDATE elle_sandbox SET surfaced=1,
       updated_at=datetime('now') WHERE id=?`
    ).bind(item_id).run().catch(() => {});
    return json({ success: true });
  }

  // Libre run log
  if (action === 'log') {
    const rows = await env.DB.prepare(
      `SELECT * FROM elle_libre_log ORDER BY run_at DESC LIMIT 10`
    ).all().catch(() => ({ results: [] }));
    return json({ log: rows.results || [] });
  }

  // Manually trigger a libre run (for testing)
  if (action === 'trigger') {
    await runLibreMode(env as unknown as LibreEnv);
    return json({ triggered: true });
  }

  return json({ error: 'unknown action' }, 400);
}
