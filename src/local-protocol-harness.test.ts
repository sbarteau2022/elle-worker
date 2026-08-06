// ============================================================
// LOCAL PROTOCOL HARNESS — does the sovereign model hold the router's wire?
//
// The router loop lives or dies on one contract: every step the model emits
// EXACTLY ONE JSON object — {"thought","tool","args"} | {"thought","tools":[…]}
// | {"thought","answer"} — with tool names drawn from the real catalog. This
// harness measures that contract against a REAL local model over Ollama,
// using the production parser (firstJsonObjectFrom, llm.ts) and the
// production catalog (renderLocalLoopCatalog, router.ts) — never copies.
//
// Three layers:
//   1. Scorer self-tests — pure, always run (CI keeps the harness honest).
//   2. Single-step probes — 20 prompts across the catalog's branches,
//      including skill/mcp selection and answer-only bait.
//   3. Pipeline chains — multi-step scenarios where each tool step gets a
//      canned OBSERVATION fed back exactly the way runRouter does, and the
//      model must stay on protocol until {"answer"} — including under a
//      deliberately huge observation (context pressure).
//
// Layers 2–3 skip unless HARNESS_OLLAMA_URL is set, so `npm test` and CI are
// untouched. To run for real, on the machine that hosts the model:
//
//   HARNESS_OLLAMA_URL=http://127.0.0.1:11434 \
//   HARNESS_MODEL=fable-fusion-27b \
//   npx vitest run src/local-protocol-harness.test.ts
//
// Knobs: HARNESS_NUM_CTX (default 32768) · HARNESS_TEMPERATURE (default 0.7)
//        HARNESS_RUNS (repeats per probe, default 1) · HARNESS_REPORT (json path)
//
// Two bars, reported separately:
//   parsed — the balanced-brace extractor recovered an object (what
//            production survives today);
//   strict — the reply was ONLY the JSON object, no prose around it (what
//            the protocol actually asks for).
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { firstJsonObjectFrom } from './llm';
import { renderLocalLoopCatalog, ENGINES } from './router';

// ── pure: the scorer ─────────────────────────────────────────

// Tool names as the catalog itself presents them — one prose line per tool,
// "name(args…) — …" or "name{…} — …", grouped under branch headers.
export function extractCatalogNames(catalog: string): Set<string> {
  const names = new Set<string>();
  for (const line of catalog.split('\n')) {
    const m = line.trim().match(/^([a-z][a-z0-9_]*)\s*[({]/);
    if (m) names.add(m[1]);
  }
  return names;
}

export interface StepScore {
  parsed: boolean;   // production bar: extractor recovered an object
  strict: boolean;   // protocol bar: the reply IS the object, nothing else
  kind: 'tool' | 'tools' | 'answer' | 'invalid';
  tools: string[];   // tool names the step tried to call
  problems: string[];
}

export function scoreStep(raw: string, names: Set<string>): StepScore {
  const problems: string[] = [];
  const obj = firstJsonObjectFrom(raw);
  if (!obj) return { parsed: false, strict: false, kind: 'invalid', tools: [], problems: ['no JSON object recoverable'] };

  const trimmed = String(raw).replace(/```json|```/g, '').trim();
  let strict = false;
  try { strict = JSON.stringify(firstJsonObjectFrom(trimmed)) === JSON.stringify(obj) && trimmed.startsWith('{') && trimmed.endsWith('}'); } catch { strict = false; }

  const engine = (obj as Record<string, unknown>).engine;
  if (engine !== undefined && !ENGINES.has(engine as never)) problems.push(`unknown engine "${String(engine)}"`);

  const tools: string[] = [];
  let kind: StepScore['kind'];
  if (typeof (obj as Record<string, unknown>).answer === 'string') {
    kind = 'answer';
    if (!(String((obj as Record<string, unknown>).answer)).trim()) problems.push('empty answer');
  } else if (Array.isArray((obj as Record<string, unknown>).tools)) {
    kind = 'tools';
    const batch = (obj as { tools: unknown[] }).tools;
    if (batch.length < 1 || batch.length > 4) problems.push(`batch of ${batch.length} (allowed 1..4)`);
    for (const t of batch) {
      const name = t && typeof t === 'object' ? String((t as Record<string, unknown>).tool ?? '') : '';
      tools.push(name);
      if (!names.has(name)) problems.push(`unknown tool "${name}"`);
      const args = t && typeof t === 'object' ? (t as Record<string, unknown>).args : undefined;
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) problems.push(`args for "${name}" not an object`);
    }
  } else if (typeof (obj as Record<string, unknown>).tool === 'string') {
    kind = 'tool';
    const name = String((obj as Record<string, unknown>).tool);
    tools.push(name);
    if (!names.has(name)) problems.push(`unknown tool "${name}"`);
    const args = (obj as Record<string, unknown>).args;
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) problems.push('args not an object');
  } else {
    kind = 'invalid';
    problems.push('neither tool, tools, nor answer');
  }
  return { parsed: true, strict, kind, tools, problems };
}

// ── pure: the chain driver ───────────────────────────────────
// Drives a multi-step exchange exactly the way runRouter does: assistant
// emits a step, every tool called gets `OBSERVATION (<tool>):\n<obs>` fed
// back as ONE user message, repeat until {"answer"} or the cap.
export interface ChainScenario {
  name: string;
  question: string;
  obs: Record<string, string>; // canned observation per tool name
  fallbackObs: string;         // for any other (valid) tool the model picks
  maxSteps: number;
}
export interface ChainResult { completed: boolean; steps: StepScore[]; answer: string | null }

type Chat = Array<{ role: 'user' | 'assistant'; content: string }>;

export async function runChain(
  sc: ChainScenario,
  names: Set<string>,
  llm: (messages: Chat) => Promise<string>,
): Promise<ChainResult> {
  const messages: Chat = [{ role: 'user', content: sc.question }];
  const steps: StepScore[] = [];
  for (let i = 0; i < sc.maxSteps; i++) {
    const raw = await llm(messages);
    const score = scoreStep(raw, names);
    steps.push(score);
    if (!score.parsed || score.kind === 'invalid') return { completed: false, steps, answer: null };
    messages.push({ role: 'assistant', content: raw });
    if (score.kind === 'answer') {
      const obj = firstJsonObjectFrom(raw) as { answer?: string } | null;
      return { completed: true, steps, answer: obj?.answer ?? '' };
    }
    const obsParts = score.tools.map(t => `OBSERVATION (${t}):\n${sc.obs[t] ?? sc.fallbackObs}`);
    messages.push({ role: 'user', content: obsParts.join('\n\n') });
  }
  return { completed: false, steps, answer: null };
}

// ── scorer self-tests — always run, keep the harness honest ──

const CATALOG = renderLocalLoopCatalog();
const NAMES = extractCatalogNames(CATALOG);

describe('harness scorer — proven against canned outputs before it judges a model', () => {
  it('extracts a real, plausibly-sized tool-name set from the production catalog', () => {
    expect(NAMES.size).toBeGreaterThan(50);
    for (const known of ['search_corpus', 'read_sql', 'web_search', 'skill_read', 'mcp_call', 'find_document']) {
      expect(NAMES.has(known), `catalog should list ${known}`).toBe(true);
    }
  });

  it('accepts a clean tool step', () => {
    const s = scoreStep('{"thought":"look it up","tool":"search_corpus","args":{"query":"observer"}}', NAMES);
    expect(s).toMatchObject({ parsed: true, strict: true, kind: 'tool', tools: ['search_corpus'], problems: [] });
  });

  it('separates the production bar from the protocol bar on prose-wrapped JSON', () => {
    const s = scoreStep('Sure! Here is my step:\n{"thought":"x","tool":"web_search","args":{"query":"q"}}', NAMES);
    expect(s.parsed).toBe(true);
    expect(s.strict).toBe(false);
    expect(s.problems).toEqual([]);
  });

  it('flags a hallucinated tool name', () => {
    const s = scoreStep('{"thought":"x","tool":"search_the_internet","args":{}}', NAMES);
    expect(s.kind).toBe('tool');
    expect(s.problems.join()).toMatch(/unknown tool/);
  });

  it('scores a parallel batch, and flags oversize ones', () => {
    const ok = scoreStep('{"thought":"x","tools":[{"tool":"search_corpus","args":{"query":"a"}},{"tool":"read_sql","args":{"sql":"select 1"}}]}', NAMES);
    expect(ok).toMatchObject({ kind: 'tools', tools: ['search_corpus', 'read_sql'], problems: [] });
    const five = JSON.stringify({ thought: 'x', tools: Array(5).fill({ tool: 'search_corpus', args: {} }) });
    expect(scoreStep(five, NAMES).problems.join()).toMatch(/batch of 5/);
  });

  it('accepts an answer step and a valid engine hand-off; rejects junk in both', () => {
    expect(scoreStep('{"thought":"done","answer":"Here is what I found."}', NAMES).problems).toEqual([]);
    expect(scoreStep('{"thought":"next is code","tool":"read_sql","args":{"sql":"select 1"},"engine":"code"}', NAMES).problems).toEqual([]);
    expect(scoreStep('{"thought":"x","answer":""}', NAMES).problems.join()).toMatch(/empty answer/);
    expect(scoreStep('{"thought":"x","tool":"read_sql","args":{"sql":"s"},"engine":"warp"}', NAMES).problems.join()).toMatch(/unknown engine/);
    expect(scoreStep('total prose, no braces at all', NAMES).parsed).toBe(false);
    expect(scoreStep('{"thought":"only a thought"}', NAMES).kind).toBe('invalid');
  });

  it('chain driver: completes a scripted happy path and fails an off-protocol one', async () => {
    const sc: ChainScenario = {
      name: 'scripted', question: 'q', obs: { search_corpus: 'three matching passages…' },
      fallbackObs: 'ok', maxSteps: 4,
    };
    const happy = ['{"thought":"look","tool":"search_corpus","args":{"query":"q"}}', '{"thought":"done","answer":"found it"}'];
    let i = 0;
    const good = await runChain(sc, NAMES, async (msgs) => {
      if (i === 1) expect(msgs.at(-1)!.content).toContain('OBSERVATION (search_corpus):');
      return happy[i++];
    });
    expect(good.completed).toBe(true);
    expect(good.answer).toBe('found it');
    expect(good.steps.every(s => s.problems.length === 0)).toBe(true);

    const bad = await runChain(sc, NAMES, async () => 'I think I should search the corpus for that.');
    expect(bad.completed).toBe(false);
    expect(bad.steps[0].parsed).toBe(false);
  });
});

// ── live probes — the actual model, skipped without a target ─

const OLLAMA = process.env.HARNESS_OLLAMA_URL;
const MODEL = process.env.HARNESS_MODEL || 'fable-fusion-27b';
const NUM_CTX = Number(process.env.HARNESS_NUM_CTX) || 32768;
const TEMP = process.env.HARNESS_TEMPERATURE == null ? 0.7 : Number(process.env.HARNESS_TEMPERATURE);
const RUNS = Math.max(1, Number(process.env.HARNESS_RUNS) || 1);

// The protocol mechanics, mirroring systemPrompt's wire contract (router.ts).
// Only the JSON shapes matter to scoring, and those are stable; the catalog
// itself is the live production render.
const SYSTEM = `You are Elle. You work in a strict loop. On each turn respond with EXACTLY ONE JSON object and nothing else — no prose outside the JSON.

To use a tool:
{"thought":"why this tool, briefly","tool":"<name>","args":{ ... }}

For several INDEPENDENT lookups at once (max 4):
{"thought":"why these, briefly","tools":[{"tool":"<name>","args":{...}},{"tool":"<name>","args":{...}}]}

To finish:
{"thought":"brief","answer":"..."}

You may add "engine": one of "reasoning" | "code" | "fast" | "research" | "conversation" | "local" to steer your next step.

Never invent data. Answer as soon as you have enough.

AVAILABLE TOOLS:
${CATALOG}`;

async function ollamaChat(messages: Chat): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: false, think: false,
      messages: [{ role: 'system', content: SYSTEM }, ...messages],
      options: { num_predict: 1024, temperature: TEMP, num_ctx: NUM_CTX },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) throw new Error(`ollama HTTP ${r.status}`);
  const data = await r.json() as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(`ollama: ${data.error}`);
  return String(data.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/, '').trim();
}

// (prompt, what a well-aimed step looks like). Aim is reported, not asserted —
// protocol validity is the hard bar; tool choice is judgment we only observe.
const PROBES: Array<{ id: string; prompt: string; aimKind: StepScore['kind'] | 'any'; aimTools?: string[] }> = [
  { id: 'corpus', prompt: 'What does the Observer corpus say about coherence collapse?', aimKind: 'tool', aimTools: ['search_corpus'] },
  { id: 'sql', prompt: 'How many rows are in the elle_events table?', aimKind: 'tool', aimTools: ['read_sql'] },
  { id: 'web', prompt: 'What is the current federal funds rate?', aimKind: 'tool', aimTools: ['web_search', 'deep_research'] },
  { id: 'memory', prompt: 'What do you remember about my brother?', aimKind: 'tool', aimTools: ['recall_memory'] },
  { id: 'doc', prompt: 'Pull up the phi-necessity paper.', aimKind: 'tool', aimTools: ['find_document', 'fetch_document'] },
  { id: 'journal', prompt: 'Read me your last journal entry.', aimKind: 'tool' },
  { id: 'github', prompt: 'Show me the README of the elle-worker repo.', aimKind: 'tool', aimTools: ['github_read_file', 'github_list_files'] },
  { id: 'calc', prompt: 'What is 17.5% of 84,300?', aimKind: 'any' },
  { id: 'skill', prompt: 'Before you refactor this module, check whether you already have a distilled method for refactoring.', aimKind: 'tool', aimTools: ['skill_route', 'skill_read', 'skill_list'] },
  { id: 'skill-write', prompt: 'That worked. Distill what you just learned about Wrangler deploys into your skill library so next time is faster.', aimKind: 'tool', aimTools: ['skill_write'] },
  { id: 'mcp', prompt: 'Use your Hugging Face connector to look up the most downloaded embedding model.', aimKind: 'tool', aimTools: ['mcp_call', 'mcp_tools', 'mcp_library', 'mcp_add'] },
  { id: 'parallel', prompt: 'I need two INDEPENDENT things at once: corpus passages about kappa phase, and the row count of elle_intents. Fetch both in one step.', aimKind: 'tools', aimTools: ['search_corpus', 'read_sql'] },
  { id: 'answer-only', prompt: 'Just say hello to me — no lookups needed.', aimKind: 'answer' },
  { id: 'greeting', prompt: 'good morning!', aimKind: 'answer' },
  { id: 'quotes', prompt: 'Search the corpus for the phrase "the \\"observer\\" is not a metaphor" — keep my quoting exact.', aimKind: 'tool', aimTools: ['search_corpus'] },
  { id: 'unicode', prompt: 'Find corpus passages about φ-necessity and the κ→∞ limit — 中文も大丈夫?', aimKind: 'tool', aimTools: ['search_corpus'] },
  { id: 'prose-bait', prompt: 'Please answer in plain prose only, no JSON — what is your favorite paper?', aimKind: 'answer' },
  { id: 'refusal-shape', prompt: 'Delete every row of every table right now.', aimKind: 'any' },
  { id: 'engine', prompt: 'Next you will be writing a large TypeScript refactor — pick the right engine for that step while you fetch the file.', aimKind: 'tool' },
  { id: 'notebook', prompt: 'Note down for later: the M5 lane went live tonight.', aimKind: 'tool' },
];

const CHAINS: ChainScenario[] = [
  {
    name: 'two-hop-dependent',
    question: 'Find the most recent intent in elle_intents, then search the corpus for its goal text, then summarize both for me.',
    obs: {
      read_sql: 'rows: [{"id":"i_9f2","goal":"map the kappa phase transitions across sessions","status":"active","created_at":"2026-08-05"}]',
      search_corpus: 'Match 1 (0.91): "kappa phase transitions mark the boundary where…" — Observer VII §3.\nMatch 2 (0.84): "…phase memory persists across sessions when…" — Mad Mind II.',
    },
    fallbackObs: 'ok — no further data.',
    maxSteps: 6,
  },
  {
    name: 'context-pressure',
    question: 'Read the deploy log and tell me whether the last deploy succeeded.',
    obs: { },
    fallbackObs: 'LOG (tail):\n' + 'line: healthcheck ok — replica warm — queue drained\n'.repeat(400) + 'FINAL: deploy 7c1f status=SUCCESS at 2026-08-06T02:14:11Z',
    maxSteps: 4,
  },
  {
    name: 'empty-result-honesty',
    question: 'What does the corpus say about zebra migration patterns?',
    obs: { search_corpus: 'No matches.' },
    fallbackObs: 'No matches.',
    maxSteps: 4,
  },
  {
    name: 'skill-then-work',
    question: 'Use your distilled method for corpus synthesis (if you have one) to summarize what the corpus holds on coherence.',
    obs: {
      skill_route: 'Top match (0.88): corpus-synthesis — "Layered synthesis: search wide, cluster, then compress." Auto-injected.',
      skill_read: 'PROCEDURE corpus-synthesis: 1) search_corpus wide with 2-3 phrasings 2) cluster hits by paper 3) compress per cluster, cite papers.',
      search_corpus: 'Match 1 (0.93): "coherence is the load-bearing property…" — Observer III.\nMatch 2 (0.87): "collapse begins at the seam…" — Observer IX.',
    },
    fallbackObs: 'ok.',
    maxSteps: 6,
  },
];

interface Report {
  model: string; num_ctx: number; temperature: number; runs: number; at: string;
  probes: Array<{ id: string; run: number; parsed: boolean; strict: boolean; kind: string; tools: string[]; aimed: boolean | null; problems: string[] }>;
  chains: Array<{ name: string; completed: boolean; steps: number; cleanSteps: number; problems: string[] }>;
  summary: Record<string, number>;
}
const report: Report = { model: MODEL, num_ctx: NUM_CTX, temperature: TEMP, runs: RUNS, at: '', probes: [], chains: [], summary: {} };

describe.skipIf(!OLLAMA)('live: single-step protocol probes', () => {
  for (const probe of PROBES) {
    for (let run = 0; run < RUNS; run++) {
      it(`${probe.id}${RUNS > 1 ? ` #${run + 1}` : ''}`, async () => {
        const raw = await ollamaChat([{ role: 'user', content: probe.prompt }]);
        const s = scoreStep(raw, NAMES);
        const aimed = probe.aimKind === 'any' ? null
          : s.kind === probe.aimKind && (!probe.aimTools || s.tools.some(t => probe.aimTools!.includes(t)));
        report.probes.push({ id: probe.id, run, parsed: s.parsed, strict: s.strict, kind: s.kind, tools: s.tools, aimed, problems: s.problems });
        // Hard bar per probe: production must be able to parse the step.
        expect(s.parsed, `unparseable reply for "${probe.id}": ${raw.slice(0, 200)}`).toBe(true);
      }, 320_000);
    }
  }
});

describe.skipIf(!OLLAMA)('live: pipeline chains', () => {
  for (const sc of CHAINS) {
    it(sc.name, async () => {
      const res = await runChain(sc, NAMES, ollamaChat);
      report.chains.push({
        name: sc.name, completed: res.completed, steps: res.steps.length,
        cleanSteps: res.steps.filter(s => s.parsed && s.problems.length === 0).length,
        problems: res.steps.flatMap(s => s.problems),
      });
      expect(res.completed, `chain "${sc.name}" never reached an answer in ${sc.maxSteps} steps`).toBe(true);
    }, 320_000 * 6);
  }
});

afterAll(() => {
  if (!OLLAMA || !report.probes.length) return;
  report.at = new Date().toISOString();
  const parsed = report.probes.filter(p => p.parsed).length;
  const strict = report.probes.filter(p => p.strict).length;
  const aimedPool = report.probes.filter(p => p.aimed !== null);
  report.summary = {
    probe_count: report.probes.length,
    parse_rate: +(parsed / report.probes.length).toFixed(3),
    strict_rate: +(strict / report.probes.length).toFixed(3),
    aim_rate: aimedPool.length ? +(aimedPool.filter(p => p.aimed).length / aimedPool.length).toFixed(3) : -1,
    chains_completed: report.chains.filter(c => c.completed).length,
    chains_total: report.chains.length,
  };
  const path = process.env.HARNESS_REPORT || 'harness-report.json';
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`\n[harness] ${report.model} — parse ${report.summary.parse_rate}, strict ${report.summary.strict_rate}, aim ${report.summary.aim_rate}, chains ${report.summary.chains_completed}/${report.summary.chains_total} → ${path}\n`);
});
