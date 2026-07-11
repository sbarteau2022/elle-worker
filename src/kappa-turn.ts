// ============================================================
// PER-TURN κ DYNAMICS for the chat path.
//
// Wraps the shared finite-difference module (kappa-dynamics.ts) with the
// worker-side I/O the chat needs: it reuses the EXISTING κ function
// (computeKappa, from journal.ts — fed the model OUTPUT ONLY), maintains the
// per-session κ series in elle_conversation_turns.kappa, and returns one
// KappaPoint for the current assistant turn so the chat header can display it.
//
// Imported by BOTH chat callsites — handleConversation (index.ts) and the
// router's finish() (router.ts) — so the dynamics are identical wherever Elle
// answers.
//
// INPUT PERTURBATION: wired here as the cosine distance between the embedding of
// the current user turn and the embedding of the immediately prior user turn
// (env.AI bge-large embeddings, via the injected `embed`). It exists so that
// output-κ change can later be separated from input-driven change. If embedding
// is unavailable or there is no prior user turn, it is null (never silently
// omitted).
// ============================================================

import type { Env } from './index';
import { computeKappa, KAPPA_DEF } from './journal';
import { latestPoint, type KappaPoint } from './kappa-dynamics';

type EmbedFn = (text: string, env: Env) => Promise<number[]>;

// elle_conversation_turns is created out-of-band (no in-repo DDL), so add the
// per-turn κ columns best-effort. Each ALTER throws "duplicate column" once it
// exists, which we swallow. kappa_def records WHICH formula produced the value
// (NULL = legacy v1, the fixed-point formula) so series never mix regimes.
let convKappaReady = false;
export async function ensureConvKappaColumn(env: Env): Promise<void> {
  if (convKappaReady) return;
  await env.DB.prepare('ALTER TABLE elle_conversation_turns ADD COLUMN kappa REAL').run().catch(() => {});
  await env.DB.prepare('ALTER TABLE elle_conversation_turns ADD COLUMN kappa_def TEXT').run().catch(() => {});
  convKappaReady = true;
}

function cosineDistance(a: number[], b: number[]): number | null {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return null;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Number((1 - cos).toFixed(6));
}

// Compute the dynamics point for the current assistant turn. Read-only w.r.t.
// the current turn: it loads the PRIOR session κ series (the current turn is
// persisted separately, with its κ, by persistExchange). Best-effort throughout
// — any failure degrades to nulls rather than breaking the answer.
export async function computeTurnDynamics(
  env: Env,
  embed: EmbedFn,
  sessionId: string,
  outputText: string,
  userText: string,
): Promise<KappaPoint> {
  await ensureConvKappaColumn(env);

  // κ over the MODEL OUTPUT ONLY (not the user input, not the whole turn).
  const kappa = computeKappa(outputText);

  // Prior assistant κ for this session, oldest → newest. Rows without a stored
  // κ (pre-column history) are skipped, so the series is dense and the null/zero
  // semantics of the finite differences stay correct. Same-definition rows ONLY
  // (kappa_def = current) — the legacy formula parked 84% of turns on exactly
  // 0.5, and differencing against those would fabricate dynamics at the seam.
  const prior = await env.DB.prepare(
    "SELECT kappa FROM elle_conversation_turns WHERE session_id = ? AND role = 'assistant' AND kappa IS NOT NULL AND kappa_def = ? ORDER BY created_at ASC"
  ).bind(sessionId, KAPPA_DEF).all().catch(() => ({ results: [] as Array<{ kappa: number }> }));
  const series = [...(prior.results || []).map((r: any) => Number(r.kappa)).filter(Number.isFinite), kappa];

  // input_perturbation: cosine distance between this user turn and the prior one.
  let inputPerturbation: number | null = null;
  try {
    const prevUser = await env.DB.prepare(
      "SELECT content FROM elle_conversation_turns WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1"
    ).bind(sessionId).first() as { content?: string } | null;
    if (prevUser?.content && userText) {
      const [cur, prev] = await Promise.all([embed(userText, env), embed(String(prevUser.content), env)]);
      inputPerturbation = cosineDistance(cur, prev);
    }
  } catch { inputPerturbation = null; }

  return latestPoint(series, inputPerturbation);
}
