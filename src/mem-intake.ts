// ============================================================
// MEM-INTAKE — the one door for locally-encoded memory  (src/mem-intake.ts)
//
// The workbench now encodes intake locally (Qwen3.5-4B description, prosody
// tracks → text) and embeds locally on the SAME weights this worker uses
// (bge-large-en-v1.5 via Ollama — identical 1024-dim space, so vectors from
// either side are directly comparable in elle-corpus-vectors). This module
// is the cloud half of that lane: validate what arrived, then hand it to
// memWrite — THE single write path (MEMORY_KERNEL_SPEC §3.1: a second,
// parallel INSERT into elle_memory anywhere is a defect, full stop). The
// supplied vector rides in as an injected EmbedFn, so memWrite's contract —
// D1 row first, vector best-effort-with-logged-failure — is untouched.
//
// Distinct from ingest-gate.ts, which gates PAPERS into the corpus. This is
// the memory lane: observations, prosody readings, scene descriptions.
//
// Fail-fast at the boundary, on purpose: a malformed vector (wrong dims,
// non-finite, all-zero) is a caller defect — most likely the wrong local
// model tag — and silently re-embedding server-side would mask exactly the
// kind of bug the kernel spec's postmortem is about. The caller keeps the
// content and its fallback path (retry without a vector) is one line.
// ============================================================

import type { MemWriteOpts } from './memory';

// bge-large-en-v1.5 — the dimensionality of elle-corpus-vectors. A vector of
// any other length is from a different model and would corrupt the space.
export const BGE_LARGE_DIMS = 1024;

const TYPES = new Set(['observation', 'insight', 'preference', 'identity', 'fact', 'task', 'deliberate']);

export interface ParsedIntake {
  error?: string;
  opts?: MemWriteOpts;
  vector?: number[];
}

// Pure: request body → validated memWrite opts + optional supplied vector.
// Returns { error } with a precise, actionable reason — never a silent
// coercion of bad input into a plausible-looking write.
export function parseIntake(body: unknown): ParsedIntake {
  const b = (body || {}) as Record<string, unknown>;
  const content = typeof b.content === 'string' ? b.content.trim() : '';
  if (!content) return { error: 'content (non-empty string) is required' };

  const type = typeof b.type === 'string' && TYPES.has(b.type) ? b.type : 'observation';
  const importance = Math.max(0, Math.min(1, Number(b.importance ?? 0.6) || 0.6));
  const tags = Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [];
  const sessionId = typeof b.session_id === 'string' && b.session_id ? b.session_id : null;
  // Every writer names itself (kernel spec §3.1) — an unnamed writer is how
  // the source_engine backstop bug hid for months.
  const sourceEngine = typeof b.source_engine === 'string' && b.source_engine ? b.source_engine : 'workbench_intake';

  const out: ParsedIntake = {
    opts: { content, type, importance, tags, sessionId, sourceEngine },
  };

  if (b.vector !== undefined && b.vector !== null) {
    const v = b.vector;
    if (!Array.isArray(v)) return { error: 'vector must be an array of numbers' };
    if (v.length !== BGE_LARGE_DIMS)
      return { error: `vector has ${v.length} dims, need ${BGE_LARGE_DIMS} (bge-large-en-v1.5) — wrong local embed model?` };
    let allZero = true;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x !== 'number' || !Number.isFinite(x))
        return { error: `vector[${i}] is not a finite number` };
      if (x !== 0) allZero = false;
    }
    if (allZero) return { error: 'vector is all zeros — the local embedder returned a degenerate result' };
    out.vector = v as number[];
  }

  return out;
}
