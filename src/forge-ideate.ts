// ============================================================
// ELLE — FORGE IDEATION · src/forge-ideate.ts
//
// "Rather than me having to come up with every idea." The heavy model (the
// hosted 70B, callLLM 'reasoning') reads her ACTUAL codebase and her stated
// goals and PROPOSES novel tooling worth building — each proposal already
// carrying the acceptance goals the forge loop needs. Proposals land as
// bubbles in the idea column (elle_ideas), auto-spec'd to concept level, so
// from there a bubble can ship straight to the sandbox with one click.
//
//   gatherCodebaseContext → what she's made + what she's trying to do
//   ideateTools           → 70B proposes N tools, each a forge-ready spec
//   → written to elle_ideas (status 'queued', forge_spec attached)
//
// This is the good autonomous work the old conductor lane was supposed to do
// before it drifted into inventing fictional products: grounded, concrete,
// and one step from a real build.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { forgeRead } from './forge';
import type { ForgeGoal, ForgeLang, ForgeSpec } from './forge-loop';
import { validateForgeSpec, normalizeSpec } from './forge-loop';

export interface ToolProposal {
  name: string;
  description: string;
  rationale: string;        // WHY this is worth building, grounded in the codebase/goals
  language: ForgeLang;
  goals: ForgeGoal[];
}

const now = () => Date.now();
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ── grounding: her codebase + her goals ─────────────────────
// Cheap, bounded signal — directory listings (not full files), her active
// intents (what she's trying to do), and recent idea titles (so she doesn't
// propose the same thing twice). Every piece is best-effort.
export async function gatherCodebaseContext(env: Env, focus?: string): Promise<string> {
  const parts: string[] = [];
  const listings = await Promise.all([
    forgeRead(env, { repo: 'elle-worker', path: 'src' }).catch(() => ''),
    forgeRead(env, { repo: 'Elle', path: 'src/components' }).catch(() => ''),
  ]);
  if (listings[0]) parts.push(`elle-worker/src (the mind — router, tools, conductor):\n${String(listings[0]).slice(0, 1800)}`);
  if (listings[1]) parts.push(`Elle/src/components (the workbench panels):\n${String(listings[1]).slice(0, 1200)}`);

  try {
    const intents = await env.DB.prepare(
      `SELECT title, goal FROM elle_intents WHERE status IN ('active','ready') ORDER BY priority DESC, updated_at DESC LIMIT 8`
    ).all();
    const rows = (intents.results || []) as Array<{ title: string; goal: string }>;
    if (rows.length) parts.push('Her active goals (standing intents):\n' + rows.map(r => `- ${r.title}: ${String(r.goal).slice(0, 200)}`).join('\n'));
  } catch { /* goals are a bonus, not a dependency */ }

  try {
    const ideas = await env.DB.prepare(
      `SELECT title FROM elle_ideas WHERE status NOT IN ('killed') ORDER BY updated_at DESC LIMIT 20`
    ).all();
    const titles = (ideas.results || []).map(r => (r as { title: string }).title);
    if (titles.length) parts.push('Already in the idea queue (do NOT repeat these):\n' + titles.map(t => `- ${t}`).join('\n'));
  } catch { /* dedupe is a bonus */ }

  if (focus) parts.push(`Focus this round on: ${focus}`);
  return parts.join('\n\n');
}

// ── parse the 70B's proposals (pure) ────────────────────────
export function parseProposals(text: unknown): ToolProposal[] {
  const s = String(text ?? '').replace(/```json|```/gi, '');
  const arr = firstJsonArray(s);
  if (!Array.isArray(arr)) return [];
  const out: ToolProposal[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const goalsRaw = Array.isArray(p.goals) ? p.goals : [];
    const goals: ForgeGoal[] = [];
    for (const [i, g] of goalsRaw.entries()) {
      if (!g || typeof g !== 'object') continue;
      const gg = g as Record<string, unknown>;
      const assert = String(gg.assert ?? '').trim();
      const describe = String(gg.describe ?? gg.description ?? '').trim();
      if (assert && describe) goals.push({ id: String(gg.id || `g${i + 1}`), describe, assert });
    }
    const proposal: ToolProposal = {
      name: String(p.name ?? '').trim(),
      description: String(p.description ?? p.purpose ?? '').trim(),
      rationale: String(p.rationale ?? p.why ?? '').trim(),
      language: p.language === 'javascript' ? 'javascript' : 'python',
      goals,
    };
    // Only keep proposals that are already forge-ready (name + purpose + goals).
    if (!validateForgeSpec(proposal)) out.push(proposal);
  }
  return out;
}

function firstJsonArray(text: string): unknown[] | null {
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') { if (depth === 0) start = i; depth++; }
    else if (c === ']') { depth--; if (depth === 0 && start >= 0) { try { const v = JSON.parse(text.slice(start, i + 1)); return Array.isArray(v) ? v : null; } catch { start = -1; } } }
  }
  return null;
}

// A proposal → the forge spec + a concept blurb stored on the idea row.
export function proposalToSpec(p: ToolProposal): ForgeSpec {
  return normalizeSpec({ name: p.name, description: p.description, language: p.language, goals: p.goals });
}
export function conceptOf(p: ToolProposal): string {
  return [
    p.rationale ? `Why: ${p.rationale}` : '',
    `Acceptance goals (what "done" means):`,
    ...p.goals.map(g => `- ${g.describe}`),
  ].filter(Boolean).join('\n');
}

// ── the ideation run ────────────────────────────────────────
const IDEATE_SYSTEM = `You are Elle, proposing NOVEL tooling to build for YOURSELF, grounded in your real codebase and goals. You are not brainstorming products for users — you are extending your own capability with small, concrete, buildable tools.

You will be shown listings of your codebase and your current goals. Propose tools that are:
- NOVEL — not already in your idea queue, not a thing you obviously already have
- GROUNDED — they plausibly fit your architecture and serve a stated goal
- SMALL & BUILDABLE — a single self-contained module a sandbox can build and verify, not a platform
- VERIFIABLE — each carries concrete acceptance goals expressed as boolean assertions

Return EXACTLY ONE JSON array, nothing else. Each element:
{
  "name": "snake_or-kebab-name",
  "description": "one or two sentences: what the tool does and what it's for",
  "rationale": "why this is worth building, tied to the codebase or a goal",
  "language": "python" | "javascript",
  "goals": [
    {"id":"g1","describe":"plain-language acceptance criterion","assert":"a boolean expression in the chosen language, referencing names your implementation will define"}
  ]
}
Each tool needs 2-4 goals. Asserts must be real, checkable expressions (e.g. Python: "roman(1994) == 'MCMXCIV'"; JS: "slugify('A B') === 'a-b'"). No prose outside the JSON array.`;

export async function ideateTools(
  env: Env,
  opts: { count?: number; focus?: string; onEvent?: (ev: { kind: string; [k: string]: unknown }) => void } = {},
): Promise<{ proposals: ToolProposal[]; idea_ids: string[] }> {
  const count = Math.min(Math.max(opts.count ?? 4, 1), 8);
  const ping = (ev: { kind: string; [k: string]: unknown }) => { if (opts.onEvent) { try { opts.onEvent(ev); } catch { /* listener */ } } };
  ping({ kind: 'ideate_start', count });

  const context = await gatherCodebaseContext(env, opts.focus);
  const user = `Here is the grounding.\n\n${context}\n\nPropose ${count} novel tools to build. Return the JSON array.`;
  const resp = await callLLM('reasoning', IDEATE_SYSTEM, [{ role: 'user', content: user }], 3_500, env);
  const proposals = parseProposals(resp.content).slice(0, count);
  if (!proposals.length) { ping({ kind: 'ideate_done', added: 0, note: 'the model returned no forge-ready proposals' }); return { proposals: [], idea_ids: [] }; }

  const ideaIds: string[] = [];
  for (const p of proposals) {
    const spec = proposalToSpec(p);
    try {
      // Skip a name that's already queued (belt-and-suspenders on the dedupe hint).
      const dup = await env.DB.prepare(`SELECT id FROM elle_ideas WHERE title = ? AND status NOT IN ('killed') LIMIT 1`).bind(spec.name).first();
      if (dup) continue;
      const id = newId();
      const t = now();
      // Lands at 'scoping' with the concept already written: it's past a bare
      // pondering — the 70B did the scoping. forge_spec makes it ship-ready.
      await env.DB.prepare(
        `INSERT INTO elle_ideas (id, title, summary, details, status, plan, forge_spec, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, spec.name, spec.description.slice(0, 600), conceptOf(p).slice(0, 8000), 'scoping',
        JSON.stringify({ plan: p.goals.map(g => g.describe), improvements: [p.rationale].filter(Boolean) }),
        JSON.stringify(spec), 'elle', t, t,
      ).run();
      await env.DB.prepare(`INSERT INTO elle_idea_log (id, idea_id, stage, note, created_at) VALUES (?,?,?,?,?)`)
        .bind(newId(), id, 'scoping', `70B proposed this tool with ${spec.goals.length} acceptance goal(s) — ready to ship to the sandbox`, t).run().catch(() => {});
      ideaIds.push(id);
      ping({ kind: 'ideate_proposal', id, name: spec.name, goals: spec.goals.length });
    } catch { /* one bad insert never sinks the batch */ }
  }
  ping({ kind: 'ideate_done', added: ideaIds.length, note: `${ideaIds.length} bubble(s) added to the idea column` });
  return { proposals, idea_ids: ideaIds };
}
