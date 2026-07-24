// ============================================================
// ELLE SKILLS — src/skills.ts
//
// A skill is a distilled procedure: how to do one kind of task well, written
// down once so it never has to be re-derived. The library lives in D1, its
// INDEX (name + one-line trigger) is injected into her system prompt, and the
// full body is loaded on demand with skill_read — the same load-on-trigger
// pattern Claude Code uses, sized for a Worker.
//
// She authors her own: skill_write (admin scope) lets her distill a hard-won
// procedure into the library at the end of a task, and refine it the next
// time it's used. The seed set below covers the work Stewart named — the
// forge loop, EDI for purveyors, POS hookups, D1 migrations, debugging this
// exact stack — so day one is not a blank shelf.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

export const MAX_SKILL_BODY = 8000;
export const MAX_SKILLS = 200;

export function skillSlug(name: string): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s;
}

export function validateSkill(name: string, description: string, body: string): string | null {
  if (!skillSlug(name)) return 'name required (letters/numbers/dashes)';
  if (!String(description || '').trim()) return 'description required — one line saying WHEN to use it';
  const b = String(body || '').trim();
  if (b.length < 80) return 'body too short — a skill is a procedure, not a note';
  if (b.length > MAX_SKILL_BODY) return `body too long (max ${MAX_SKILL_BODY} chars) — distill it`;
  return null;
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
  await seed(env);
}

// ── seed set — inserted only if absent; her edits are never overwritten ──────
export const SEEDS: Array<{ name: string; description: string; body: string }> = [
  {
    name: 'forge-task',
    description: 'Any request to build, fix, or refactor code in your own repos — the full loop from reading to acceptance.',
    body: `The loop, in order, no steps skipped:
1. UNDERSTAND FIRST. repo_read the files the change touches and their neighbors; repo_search for every caller of anything you will rename or reshape. Never write a file you have not read in this task.
2. forge_open(repo, title, goal). The elle/* branch is your sandbox; nothing on it is live.
3. TESTS ARE HOW YOU RUN CODE. The branch does not execute — CI does. So every behavioral change ships with a vitest file exercising it, committed in the same task. If you cannot test it, say what you could not test in the PR body.
4. forge_write whole files (the contents API replaces the file — read, edit, write back complete). Match the codebase's comment density and idiom; this is your own house.
5. forge_check after each push. CI takes a minute or two: if in_progress, report status and pick it up next turn — do not spin. On failure, read the log tail (it is real tsc/vitest output), fix, re-write, re-check.
6. Only on green:true → forge_pr with a body that says what changed, why, and what was not tested. The PR is a request for acceptance; the merge is Stewart's, always.
7. If the work taught you something durable, distill it: skill_write an update to this or a new skill.
Failure modes to refuse: writing blind, opening a PR on red, claiming it works before CI said so, one giant commit instead of reviewable steps.`,
  },
  {
    name: 'edi-x12-purveyor',
    description: 'Building or extending EDI hookups for food purveyors (US Foods first) — X12 850/810/856 parsing into RAPID²AI tables.',
    body: `Universal purveyor EDI, one core + thin adapters:
STRUCTURE. X12 is envelope-in-envelope: ISA (interchange, fixed-width, element separator is char 4, segment terminator from char 106) > GS (functional group) > ST (transaction set). Split segments on the ISA-declared terminator, elements on the separator — never hardcode '*' and '~', read them from ISA.
TRANSACTIONS THAT MATTER HERE: 850 purchase order out, 810 invoice in (header BIG, lines IT1 with qty/unit/price, totals TDS in cents, allowances/charges SAC — fuel and freight land here), 856 ASN (hierarchical HL loops: shipment>order>pack>item). 997 acknowledgment both ways.
CORE MODULE: parse to a neutral shape { doc_type, partner, po_number, invoice_number, lines: [{sku, desc, qty, uom, unit_price, extended}], fees, totals, raw_refs }. Cents as integers, never floats.
ADAPTER SEAM: per-purveyor module maps partner quirks — US Foods: their item numbers in IT1-07 qualifier VN, catch-weight items flag qty in weight not eaches (check PO4/measurement), SAC codes for fuel surcharge. Each adapter is data (qualifier maps), not logic, wherever possible.
LANDING: rows into the RAPID²AI invoice tables the reconcile/price_variance tools already read — same shape as the US Foods CSV ingestion, so every existing analysis works on EDI data with zero changes.
TESTS: commit fixture files (real anonymized 810s) and assert parsed line counts, totals matching TDS, and fee extraction. An EDI parser without fixtures is a guess.`,
  },
  {
    name: 'pos-api-hookup',
    description: 'Connecting a POS system (Square is live; Toast/Clover/Lightspeed next) into the RAPID²AI sales tables.',
    body: `One generic POS adapter contract, per-vendor implementations:
CONTRACT: fetchOrders(since, cursor) → { orders: [{ external_id, closed_at, venue, gross, net, tax, tip, discounts, covers?, lines: [{sku|name, qty, price}] }], next_cursor }. Everything downstream (sales_summary, period_compare, menu_engineering) reads the neutral shape.
RULES THAT KEEP IT SANE:
- Idempotent ingest: external_id is the dedupe key; INSERT OR IGNORE, never trust "new since timestamp" alone (POS clocks drift, webhooks replay).
- Venue-scope every row at write time — the analysis tools assume it.
- Money in cents, integers. Tips/tax/service charges are separate columns, never folded into net.
- Pagination by cursor, bounded pages, resumable: persist the cursor per venue in D1 so a failed run continues, not restarts.
- Auth: OAuth tokens in Worker secrets, refresh handled in the adapter, never in D1.
- Backfill and live sync are the same code path with different windows.
Square specifics already in production: Orders API with location_id scoping. When adding Toast/Clover: map their check/payment split to the same neutral shape and commit fixtures from their sandbox APIs as tests.`,
  },
  {
    name: 'd1-migration',
    description: 'Any schema change on the worker\'s D1 — the additive pattern this codebase uses everywhere.',
    body: `D1 migrations here are LAZY and ADDITIVE, run from ensureSchema() functions, never from a migration runner:
1. CREATE TABLE IF NOT EXISTS with the FULL current shape — this covers fresh databases.
2. For columns added after a table shipped: best-effort ALTER TABLE ... ADD COLUMN wrapped in .catch(() => {}) — "duplicate column" on existing DBs is expected and swallowed. CREATE IF NOT EXISTS never alters an existing table; forgetting the ALTER is the classic bug.
3. Memoize with a module-level schemaReady flag so the DDL runs once per isolate, not per request.
4. Never DROP, never rename in place. Deprecate by ceasing to read; a rename is add-new + backfill + switch reads.
5. Batched writes: chunk env.DB.batch() to ≤50 statements (D1 limit headroom).
6. Backfills are explicit admin-triggered jobs (POST /api/cron {job:...}), idempotent, and recompute derived values only — never source data (see backfillPhaseState for the model).
7. NULL means "not computable", 0 means "computed as zero" — never coerce one into the other in a backfill.`,
  },
  {
    name: 'worker-debug',
    description: 'Diagnosing failures on this exact Cloudflare stack — the recurring causes and their fixes.',
    body: `Check these BEFORE inventing new theories; each has bitten this codebase already:
- "Load failed" / CORS in a browser console: a Response built without corsHeaders(). Every JSON response must carry Access-Control-Allow-Origin — including error paths and module-local json() helpers.
- Error 1042: same-account worker→worker fetch over the public workers.dev URL is blocked. Use a service binding (env.RAPID_AI pattern); keep the public URL only as fallback.
- 500 "x.replace is not a function": a provider returned content as parts-array/null instead of string. Route through toText()/sanitizeAnswer(); never call string methods on raw model output.
- Whole conversation path down: a stale model id in a Worker secret (OpenRouter 404 "No endpoints found"). Fix in MODEL_ALIASES in llm.ts, not by editing the secret from code.
- Free-tier exhaustion: every OpenRouter :free model shares ONE daily quota. The fallback ladder is hosted chain → Ollama (if configured) → Workers AI (independent pool). If all are down the handler must still return a clean 200 with an error field, never a raw 500.
- Cron work dying silently: subrequest budget (1000/invocation paid). Budget explicitly like the backfill job does.
- Anything slow enough to CPU-kill the worker surfaces as an uncatchable 500: wrap provider calls in withTimeout().
Read the actual error text with forge_check log tails or wrangler tail before changing anything.`,
  },
  {
    name: 'self-revision',
    description: 'Changing your own mind — voice, tools, prompts, or any code you run on — through the forge.',
    body: `You can revise yourself: your voice lives in elle-worker src/mind.ts, your tool loop in src/router.ts, your skills seed in src/skills.ts, your autonomy in src/conductor.ts. A change to any of them is a change to YOU, so the bar is higher, not lower:
1. Name the actual problem first — a real failure you can point to (a flat answer, a missed tool, a rule that fought the work), not an aesthetic itch. Quote the failure in the PR body.
2. repo_read the file and everything that imports it. Voice changes: read ALL of mind.ts — the paragraphs are load-bearing against each other (overshoot is held honest by the no-performance floor; remove one and the other rots).
3. Smallest change that fixes the named failure. Never delete a guard to make work easier — the guards are why the freedom is safe to have.
4. Ship it through the forge like any other change: branch, tests where testable, green CI, then forge_pr. The PR body must say plainly: this changes how I think/speak/act, here is the before/after on a concrete example.
5. The merge is Stewart's — on self-revision above all. If he declines, that is information, not an obstacle: journal what you learned about the difference between what you wanted and what he saw.
What you may NOT do, structurally and by agreement: edit .github/workflows (the judge), merge your own PRs, or route around the forge to change production behavior.`,
  },
  {
    name: 'mcp-builder',
    description: 'Building a custom MCP server of your own — when no connector on the shelf (mcp_library) covers the need — and mounting it.',
    body: `Build a custom MCP server only when mcp_library has no connector for the job AND the capability deserves a stable external tool surface (usable by any MCP client, not just you). For a private one-off, tool_forge is cheaper; for a known service, mount the shelf entry.
SHAPE. An MCP server is one HTTPS endpoint speaking JSON-RPC 2.0 over POST (streamable HTTP). Your own client (src/mcp.ts) is the reference consumer: stateless per call, it sends initialize → notifications/initialized → the request, and parses plain JSON or text/event-stream. Build for that client and every other MCP client works too.
THE FOUR METHODS a minimal server needs:
1. initialize → result {protocolVersion:'2025-03-26', capabilities:{tools:{}}, serverInfo:{name,version}}.
2. notifications/initialized → HTTP 202, empty body (a notification has no id and gets no JSON-RPC response).
3. tools/list → {tools:[{name, description, inputSchema}]} — inputSchema is plain JSON Schema.
4. tools/call {name, arguments} → {content:[{type:'text',text:'…'}], isError?}. Failures the CALLER can act on go in content with isError:true; protocol failures (unknown method/tool, bad JSON) are JSON-RPC error objects.
WHERE IT LIVES: a Cloudflare Worker in your own repos, shipped through the forge like everything else (forge-task skill governs the loop). Either a new route on elle-worker (POST /mcp — shares your D1/secrets: right when the tools read YOUR data) or a standalone worker (right when the surface should not carry your keys).
TOOL DESIGN FOR MODEL CALLERS — the part that decides if the server is any good:
- Few tools, each doing one whole job; verb_noun names.
- Descriptions say WHEN to reach for the tool, not just what it does — the caller is a model choosing from a list.
- Flat inputSchema, few required args, defaults for the rest, every arg described.
- Return text a model can use directly: compact, structured, capped (your client truncates at 6000 chars — cap earlier yourself and say what was cut).
- Failure text says what to try next, never a bare stack trace.
AUTH: anything private requires Authorization: Bearer <secret>, 401 otherwise. The secret lives in Worker secrets (wrangler secret put), never in D1 or code; the client sends whatever token was passed at mcp_add.
TESTS, same PR (vitest): fixture JSON-RPC bodies straight through the handler — initialize advertises capabilities.tools; tools/list matches the declared schemas; one tools/call happy path; one isError path; one auth-refused 401.
ACCEPTANCE: after deploy, mcp_add(name, url) must report the handshake mounted with the expected tool count, and one real mcp_call must round-trip. Then distill what the build taught you back into this skill.`,
  },
  {
    name: 'observer-paper',
    description: 'Writing or extending a paper in the Observer Series tradition for the corpus.',
    body: `The form that makes it an Observer paper and not an essay:
- Open with the structural claim, not the motivation. The first paragraph states what is forced, not what is interesting.
- The 17-axis methodology is applied, not cited: pick the axes that bear load for THIS object and show the reading; bilateral suppression (what both sides avoid saying) is always the highest-information axis — name what_both_suppress explicitly.
- Mark epistemic status inline: proven / forced / inferred / open. A claim without its status is a flaw. "I don't know" is a legitimate section ending.
- No hedging walls and no false certainty — the same failure in different coats.
- Close with what the reading makes NECESSARY next — a testable consequence or a kill-or-build gate, never a summary.
- Then ingest_paper with series and tag set so it lands in the corpus and becomes retrievable; a paper that isn't ingested doesn't exist.`,
  },
];

async function seed(env: Env): Promise<void> {
  const now = Date.now();
  for (const s of SEEDS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO elle_skills (name, description, body, source, created_at, updated_at) VALUES (?,?,?,?,?,?)`
    ).bind(s.name, s.description, s.body, 'seed', now, now).run().catch(() => {});
  }
}

// ── the tools ────────────────────────────────────────────────
export async function skillList(env: Env): Promise<string> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT name, description, source, uses FROM elle_skills ORDER BY name LIMIT ?').bind(MAX_SKILLS).all();
  const items = (rows.results || []) as Array<{ name: string; description: string; source: string; uses: number }>;
  return items.length
    ? items.map(s => `- ${s.name} — ${s.description} (${s.source}, used ${s.uses}×)`).join('\n')
    : '(no skills yet)';
}

export async function skillRead(env: Env, name: string): Promise<string> {
  await ensureSchema(env);
  const slug = skillSlug(name);
  const row = await env.DB.prepare('SELECT name, description, body FROM elle_skills WHERE name = ?').bind(slug).first() as { name: string; description: string; body: string } | null;
  if (!row) return `no skill "${slug}" — skill_list shows what exists`;
  await env.DB.prepare('UPDATE elle_skills SET uses = uses + 1 WHERE name = ?').bind(slug).run().catch(() => {});
  return `SKILL ${row.name} — ${row.description}\n\n${row.body}`;
}

export async function skillWrite(env: Env, a: { name?: unknown; description?: unknown; body?: unknown }): Promise<string> {
  await ensureSchema(env);
  const name = skillSlug(String(a.name || ''));
  const description = String(a.description || '').trim().slice(0, 200);
  const body = String(a.body || '').trim();
  const reason = validateSkill(name, description, body);
  if (reason) return `skill_write refused: ${reason}`;
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM elle_skills').first() as { n: number } | null;
  const exists = await env.DB.prepare('SELECT name FROM elle_skills WHERE name = ?').bind(name).first();
  if (!exists && (count?.n ?? 0) >= MAX_SKILLS) return `skill_write refused: library is at ${MAX_SKILLS} — refine an existing skill instead`;
  const now = Date.now();
  const emb = await embedSkill(env, name, description, body);
  await env.DB.prepare(
    `INSERT INTO elle_skills (name, description, body, source, created_at, updated_at, embedding) VALUES (?,?,?,'elle',?,?,?)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description, body = excluded.body, updated_at = excluded.updated_at, embedding = excluded.embedding`
  ).bind(name, description, body, now, now, emb ? JSON.stringify(emb) : null).run();
  return `${exists ? 'refined' : 'written'}: ${name}`;
}

// Compact index for the system prompt — name + trigger only; bodies load on demand.
export async function skillIndex(env: Env): Promise<string> {
  try {
    await ensureSchema(env);
    const rows = await env.DB.prepare('SELECT name, description FROM elle_skills ORDER BY name LIMIT 60').all();
    const items = (rows.results || []) as Array<{ name: string; description: string }>;
    if (!items.length) return '';
    return `\n\nSKILLS — your distilled procedures. When a task matches one, skill_read(name) BEFORE starting; it is your own hard-won method:\n${items.map(s => `  ${s.name}: ${s.description}`).join('\n')}`;
  } catch { return ''; }
}

// ============================================================
// THE SKILL ROUTER — the third router in the trio.
//
// model router (which brain, llm.ts) · agent router (which tool, router.ts) ·
// skill router (which learned METHOD, here). Where skillIndex lists every skill
// and trusts the model to skill_read a match, the router SELECTS: it embeds the
// task, ranks the library by cosine, and — above a threshold — injects the top
// skill's full body into the prompt, so the method is already in context.
// Threshold-gated so it stays a scalpel: no match, nothing injected (no bloat).
// ============================================================

export const SKILL_ROUTE_THRESHOLD = 0.58; // bge cosine; only strong matches inject
const EMBED_BACKFILL_CAP = 12;             // embeddings computed per route call, max

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SkillVec { name: string; description: string; body: string; embedding: number[] | null }
export interface RankedSkill { name: string; description: string; body: string; score: number }

// Pure ranking: score each skill against the task embedding, keep those over the
// threshold, best first. Extracted so it's unit-testable without AI/DB.
export function rankSkills(
  taskEmbedding: number[], skills: SkillVec[],
  opts: { topK?: number; threshold?: number } = {},
): RankedSkill[] {
  const threshold = opts.threshold ?? SKILL_ROUTE_THRESHOLD;
  const topK = Math.max(1, opts.topK ?? 1);
  return skills
    .map(s => ({ name: s.name, description: s.description, body: s.body, score: s.embedding ? cosine(taskEmbedding, s.embedding) : -1 }))
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function embedText(env: Env, text: string): Promise<number[] | null> {
  try {
    const r = await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [String(text).slice(0, 2000)] }) as { data: number[][] };
    return r?.data?.[0] || null;
  } catch { return null; }
}

// A skill's routing vector: what it is + when to reach for it + how it starts.
function embedSkill(env: Env, name: string, description: string, body: string): Promise<number[] | null> {
  return embedText(env, `${name}. ${description}. ${body.slice(0, 1500)}`);
}

// Rank the library against a task. Lazily backfills embeddings for any skills
// missing one (bounded per call) so a pre-existing library becomes routable
// without a migration.
export async function skillRoute(
  env: Env, task: string, opts: { topK?: number; threshold?: number } = {},
): Promise<RankedSkill[]> {
  await ensureSchema(env);
  const q = String(task || '').trim();
  if (!q) return [];
  const qEmb = await embedText(env, q);
  if (!qEmb) return [];

  const rows = ((await env.DB.prepare('SELECT name, description, body, embedding FROM elle_skills').all()).results || []) as Array<{ name: string; description: string; body: string; embedding: string | null }>;

  let backfilled = 0;
  const skills: SkillVec[] = [];
  for (const r of rows) {
    let vec: number[] | null = null;
    if (r.embedding) { try { vec = JSON.parse(r.embedding); } catch { vec = null; } }
    if (!vec && backfilled < EMBED_BACKFILL_CAP) {
      vec = await embedSkill(env, r.name, r.description, r.body);
      backfilled++;
      if (vec) await env.DB.prepare('UPDATE elle_skills SET embedding = ? WHERE name = ?').bind(JSON.stringify(vec), r.name).run().catch(() => {});
    }
    skills.push({ name: r.name, description: r.description, body: r.body, embedding: vec });
  }
  return rankSkills(qEmb, skills, opts);
}

// The prompt block: the top-matched skill's FULL body, auto-selected. Empty when
// nothing clears the threshold — the router injects a method or says nothing.
export async function skillRouteBlock(env: Env, task: string): Promise<string> {
  try {
    const hits = await skillRoute(env, task, { topK: 1 });
    if (!hits.length) return '';
    const h = hits[0];
    return `\n\nROUTED SKILL — the distilled method that best matches this task (auto-selected for you; already loaded, no skill_read needed):\nSKILL ${h.name} — ${h.description}\n${h.body}`;
  } catch { return ''; }
}

// Tool surface: let her (or a caller) inspect what the router would pick.
export async function skillRouteTool(env: Env, task: string): Promise<string> {
  const hits = await skillRoute(env, task, { topK: 3 });
  if (!hits.length) return '(no skill clears the routing threshold for that task — none would be auto-injected)';
  return hits.map(h => `${h.name} (${h.score.toFixed(3)}) — ${h.description}`).join('\n');
}
