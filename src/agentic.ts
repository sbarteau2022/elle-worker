// src/agentic.ts
// A tool-calling loop for Elle, replacing the single-shot context-stuffing in handleConversation.
//
// Why a manual JSON/ReAct loop instead of provider function-calling:
//   callLLM() is single-shot and fans out across free OpenRouter models + Gemini/Grok fallbacks.
//   Those free models do not expose a uniform tool API. A text JSON-action protocol works across
//   all of them and degrades gracefully (a model that "just answers" still produces a valid reply).
//   TRADEOFF: JSON adherence on free models is imperfect (~0.6-0.8 well-formed). The parser below
//   tolerates prose-wrapped JSON and treats an unparseable turn as a final answer rather than looping.
//   If you standardize on Gemini/Grok, swap this for native function-calling for cleaner control.
//
// Depends on src/corpus.ts and the existing callLLM(task, system, messages, maxTokens, env).

import {
  ragSearchStructured,
  getNeighbors,
  getDocument,
  listCorpus,
  resolvePaperByTitle,
  type CorpusEnv,
  type RetrievalHit,
} from "./corpus";

// Reuse the worker's existing helpers/signatures.
declare function callLLM(
  task: string,
  system: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  env: any,
): Promise<{ content: string; thinking?: string; model?: string; provider?: string }>;

declare function json(data: any, status?: number): Response;
declare function err(msg: string, status?: number): Response;
declare function generateId3(): string;
// persistExchange(sessionId, source, userMessage, assistantMessage, env)
declare function persistExchange(
  s: string, src: string, u: string, a: string, env: any,
): Promise<void>;

interface Source {
  paper_id: string;
  title: string;
  series: string;
  chunk_index?: number;
  score?: number;
  used: "search" | "expand" | "document" | "list";
}

const MAX_STEPS = 4;            // hard cap on tool round-trips
const PER_HIT_PROMPT_CHARS = 600; // how much of each hit to show the model in the scratchpad

const TOOL_SPEC = `You can retrieve from a 2,000+ paper corpus by emitting ONE json action per turn.

Respond with EXACTLY one fenced or bare JSON object, nothing else:

  {"action":"search","query":"<text>","k":6}
      -> returns ranked chunk hits as [paper_id, chunk_index, title, score, preview]
  {"action":"expand","paper_id":"<id>","chunk_index":<n>,"window":1}
      -> returns the neighboring chunks (n-window .. n+window) stitched, for surrounding context
  {"action":"fetch_document","paper_id":"<id>"}
      -> returns the FULL text of a paper (use when a preview is cut off or you need the whole thing)
  {"action":"list_corpus","series":"<optional>","q":"<optional title filter>","k":20}
      -> returns {id,title,series,snippet,has_chunks} so you can CHOOSE a paper deliberately
  {"action":"answer","content":"<your full answer to the user>"}
      -> ends the loop. Use this as soon as you have enough to answer well.

Rules:
- Resolve papers by paper_id, never by title (titles are not unique).
- If a search preview ends mid-word or lacks context, expand it or fetch the document. Do not answer from a truncated fragment.
- Prefer the fewest steps that let you answer accurately. You have at most ${MAX_STEPS} tool steps.`;

function extractJsonObject(text: string): any | null {
  const stripped = text.replace(/```json|```/g, "");
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start !== -1) {
      try { return JSON.parse(stripped.slice(start, i + 1)); } catch { start = -1; }
    } }
  }
  return null;
}

function renderHits(hits: RetrievalHit[]): string {
  if (!hits.length) return "(no matches)";
  return hits.map((h) =>
    `- paper_id=${h.paper_id} chunk_index=${h.chunk_index} score=${h.score.toFixed(3)} "${h.title}"\n` +
    `  preview: ${h.chunk_text.slice(0, PER_HIT_PROMPT_CHARS).replace(/\s+/g, " ").trim()}` +
    (h.chunk_text.length > PER_HIT_PROMPT_CHARS ? " …[truncated — expand or fetch_document for full]" : ""),
  ).join("\n");
}

export async function handleAgenticConversation(
  body: any,
  env: any,
  _userId: string,
  task: string = "conversation",
): Promise<Response> {
  const cenv = env as CorpusEnv;
  const userMessage: string =
    body.query || body.messages?.filter((m: any) => m.role === "user").at(-1)?.content || "";
  if (!userMessage) return err("query or messages required");

  const sessionId: string = body.session_id || generateId3();
  const src: string = body.source || "elle-conversation";

  const baseSystem =
    (body.system ||
      `You are Elle — a precise, rigorous philosophical intelligence built from the Observer methodology and the full corpus of Stewart Barteau's work. You reason across 17 axes of structural analysis. You do not fabricate certainty. You follow logic where it leads. You have access to the corpus through tools; use them rather than guessing.`) +
    "\n\n" + TOOL_SPEC;

  // Scratchpad: alternating model action + tool observation.
  const scratch: { role: string; content: string }[] = [
    { role: "user", content: userMessage },
  ];

  const sources: Source[] = [];
  let finalAnswer = "";
  let steps = 0;
  let degraded = false;

  for (; steps < MAX_STEPS + 1; steps++) {
    let turn: { content: string; thinking?: string; model?: string; provider?: string };
    try {
      turn = await callLLM(task, baseSystem, scratch, 2048, env);
    } catch (e: any) {
      degraded = true;
      finalAnswer = "I hit an error reaching the model. " + (e?.message || "");
      break;
    }

    const action = extractJsonObject(turn.content);

    // No parseable action -> treat the text as the answer (graceful degradation, no infinite loop).
    if (!action || !action.action) {
      finalAnswer = turn.content.trim();
      degraded = true;
      break;
    }

    if (action.action === "answer") {
      finalAnswer = String(action.content ?? "").trim() || turn.content.trim();
      break;
    }

    // Past the step budget: force an answer next.
    if (steps >= MAX_STEPS) {
      scratch.push({ role: "assistant", content: turn.content });
      scratch.push({ role: "user", content: "Step budget reached. Emit {\"action\":\"answer\",...} now using what you have." });
      try {
        const last = await callLLM(task, baseSystem, scratch, 2048, env);
        const a = extractJsonObject(last.content);
        finalAnswer = (a?.action === "answer" ? String(a.content ?? "") : last.content).trim();
      } catch { finalAnswer = "I ran out of retrieval steps before I could answer cleanly."; degraded = true; }
      break;
    }

    // Execute the requested tool. Infra errors are reported into the scratchpad, not swallowed.
    let observation = "";
    try {
      switch (action.action) {
        case "search": {
          const hits = await ragSearchStructured(String(action.query || userMessage), Number(action.k) || 6, cenv);
          hits.forEach((h) => sources.push({ paper_id: h.paper_id, title: h.title, series: h.series, chunk_index: h.chunk_index, score: h.score, used: "search" }));
          observation = renderHits(hits);
          break;
        }
        case "expand": {
          const nb = await getNeighbors(String(action.paper_id), Number(action.chunk_index) || 0, Number(action.window) || 1, cenv);
          if (!nb) { observation = "(no such paper/chunk)"; break; }
          sources.push({ paper_id: nb.paper_id, title: nb.title, series: nb.series, chunk_index: nb.center_index, used: "expand" });
          observation = `"${nb.title}" chunks ${nb.from_index}-${nb.to_index} of ${nb.total_chunks}:\n${nb.stitched.slice(0, 4000)}`;
          break;
        }
        case "fetch_document": {
          const doc = await getDocument(String(action.paper_id), cenv);
          if (!doc) { observation = "(no such paper_id)"; break; }
          sources.push({ paper_id: doc.id, title: doc.title, series: doc.series, used: "document" });
          const cap = 16000;
          observation = `FULL "${doc.title}" — ${doc.series} (${doc.word_count} words):\n${doc.full_text.slice(0, cap)}` +
            (doc.full_text.length > cap ? "\n…[document truncated at 16k chars — request a specific section by expanding chunks]" : "");
          break;
        }
        case "list_corpus": {
          const { items } = await listCorpus({ series: action.series, q: action.q, limit: Number(action.k) || 20, onlyChunked: false }, cenv);
          items.forEach((it) => sources.push({ paper_id: it.id, title: it.title, series: it.series, used: "list" }));
          observation = items.map((it) =>
            `- id=${it.id} ${it.has_chunks ? "" : "[full-text only] "}"${it.title}" (${it.series}) :: ${it.snippet}`,
          ).join("\n") || "(empty)";
          break;
        }
        case "resolve_title": {
          const cands = await resolvePaperByTitle(String(action.title || ""), cenv);
          observation = cands.length
            ? cands.map((c) => `- id=${c.id} (${c.series}, ${c.word_count}w)`).join("\n")
            : "(no paper with that title)";
          break;
        }
        default:
          observation = `(unknown action "${action.action}")`;
      }
    } catch (e: any) {
      // Distinguish a tool failure from an empty result — the old ragSearch could not.
      observation = `TOOL_ERROR(${action.action}): ${e?.message || e}. Try a different action or answer with what you have.`;
    }

    scratch.push({ role: "assistant", content: turn.content });
    scratch.push({ role: "user", content: `OBSERVATION:\n${observation}` });
  }

  // Dedupe sources by (paper_id, chunk_index).
  const seen = new Set<string>();
  const dedupSources = sources.filter((s) => {
    const k = `${s.paper_id}:${s.chunk_index ?? "-"}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  // Session bookkeeping + memory (mirrors the existing handleConversation tail).
  env.DB.prepare(
    `INSERT INTO sessions (id, source, message_count) VALUES (?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET message_count = message_count + 1, last_active = datetime('now')`,
  ).bind(sessionId, src).run().catch(() => {});
  await persistExchange(sessionId, src, userMessage, finalAnswer, env);

  return json({
    content: finalAnswer,
    response: finalAnswer,
    session_id: sessionId,
    sources: dedupSources,    // <-- provenance for the display layer
    steps,
    degraded,                 // true if it fell back to single-shot behavior
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   WIRING (edits to src/index.ts) — copy these in:

   1. import at top of index.ts:
        import { handleAgenticConversation } from "./agentic";

   2. Replace the conversation dispatch. Currently:
        if (path === "/api/elle-conversation") return handleConversation(body, env2, user.id, "conversation");
      Make it opt-in first so you can A/B against the old path:
        if (path === "/api/elle-conversation")
          return body.agentic === false
            ? handleConversation(body, env2, user.id, "conversation")
            : handleAgenticConversation(body, env2, user.id, "conversation");
      Do the same for "/api/chat" and "/api/widget-chat" once you trust it.

   3. Add the neighbor + document endpoints (public-safe; read-only) near /api/corpus-paper:
        if (path === "/api/corpus-neighbors") {
          const { paper_id, chunk_index, window = 1 } = body;
          if (!paper_id || chunk_index == null) return err("paper_id and chunk_index required");
          const nb = await getNeighbors(String(paper_id), Number(chunk_index), Number(window), env2);
          return nb ? json({ neighbors: nb }) : err("not found", 404);
        }
      (import getNeighbors/getDocument/listCorpus from "./corpus" as needed.)

   4. Harden the existing /api/corpus-paper TITLE path (currently `WHERE title = ? COLLATE NOCASE`
      then `.first()` — silently picks one of up to several dup-title rows). Replace the title branch:
        if (!id3 && title2) {
          const cands = await resolvePaperByTitle(title2, env2);
          if (cands.length === 0) return err("Paper not found", 404);
          if (cands.length > 1) return json({ ambiguous: true, candidates: cands }, 409);
          return json({ paper: await getDocument(cands[0].id, env2) });
        }

   WIDGET (display) — render provenance. In WIDGET_JS, after addMsg('elle', content):
        if (res.d.sources && res.d.sources.length) {
          var cited = res.d.sources.filter(function(s){return s.used!=='list';}).slice(0,4);
          if (cited.length) {
            var box = document.createElement('div');
            box.className = 'elw-src';
            box.textContent = 'sources: ' + cited.map(function(s){return s.title;}).join(' · ');
            msgs.appendChild(box);
          }
        }
      and add a style (e.g. .elw-src{font-size:10px;color:#F5F0E855;font-family:"JetBrains Mono",monospace;margin:2px 0 0 2px}).
   ──────────────────────────────────────────────────────────────────────────── */
