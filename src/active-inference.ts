// ============================================================
// THE POLICY COMPASS — src/active-inference.ts
//
// Expected Free Energy G(π) over the router's tool policies, built on the
// regulator's variational free energy F = U + T·A over the coherence triad
// (structural, relational, harmonic). Discrete active inference in the
// Friston/Da Costa form:
//
//   G(π) = D_KL[ q(o|π) ‖ p(o) ]              (pragmatic risk)
//        + E_{q(s)}[ ℋ( p(o|s,π) ) ]           (epistemic ambiguity)
//   σ(π) = exp(−γ·G(π)) / Σ_π' exp(−γ·G(π'))   (policy posterior, precision γ)
//
// Generative model (deliberately minimal, two states × two outcomes):
//   latent s ∈ {resolved, ambiguous} with q(ambiguous) = ℋ(q(o|s)) — the
//   observation-state ambiguity, measured as the φ-weighted binary entropy
//   of the coherence triad (bits, so ℋ ∈ [0,1]);
//   outcome o ∈ {progress, no-progress}, preferred prior p(progress)=0.95;
//   each policy carries two likelihoods: competence when the state is
//   resolved (g) and when it is ambiguous (b). Epistemic tools keep b high
//   (information-seeking works BECAUSE the state is ambiguous); pragmatic
//   tools collapse under ambiguity (acting blind mostly misses).
//
// The regime switch the spec gates on — ℋ > 0.40 ⇒ >65% posterior mass on
// the epistemic tools {diagnose, search_corpus, pfar, vfar} — is NOT coded
// as a threshold rule anywhere below. It emerges from the model: above the
// threshold, pragmatic policies pay both higher risk (their predicted
// progress drops toward b) and higher ambiguity (H_b(b) is large for small
// b), so their G climbs and the softmax mass drains to the epistemic four.
// γ is chosen analytically, not fitted: at the worst gated point (ℋ→0.40⁺)
// the epistemic/pragmatic gap is ΔG ≈ 0.23 bits; a 4-vs-4 roster needs
// γ·ΔG > ln(0.65/0.35) ≈ 0.62 ⇒ γ > 2.7. γ = 4 clears it with margin, and
// the fixture suite (active-inference.test.ts, gate B4) sweeps the whole
// region rather than trusting the bound.
//
// All entropies and divergences are in BITS (log2) so the spec's 0.40
// threshold reads as 40% of maximal binary ambiguity. Numbers are rounded
// to 6dp like the regulator's, for stable wire payloads.
// ============================================================

import { freeEnergy, regulate, PHI_WEIGHTS, type Coherence, type RegulatorStep } from './regulator';
import { readAtlasPoints, type AtlasStoreEnv } from './atlas-store';

// ── Spec constants (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md §4.4 / B4) ────
export const AMBIGUITY_THRESHOLD = 0.40;   // ℋ(q(o|s)) trigger, bits
export const EPISTEMIC_MASS_FLOOR = 0.65;  // required σ mass above the trigger
export const POLICY_PRECISION_GAMMA = 4;   // γ — analytic choice, see header
export const PREFERRED_PROGRESS = 0.95;    // p(o=progress) prior preference

export const EPISTEMIC_TOOLS = ['diagnose', 'search_corpus', 'pfar', 'vfar'] as const;

export interface PolicyModel {
  name: string;                      // real router tool name (router.ts registry)
  kind: 'epistemic' | 'pragmatic';
  resolved_competence: number;       // g = p(progress | s=resolved, π)
  ambiguous_competence: number;      // b = p(progress | s=ambiguous, π)
}

// The default roster: the spec's four epistemic tools against four real
// pragmatic (act-on-the-world / commit-state) tools from the same registry.
// Competences are declared model priors — documented beliefs about the
// tools, not parameters fitted to pass B4 (γ is where the gate math lives,
// and it is derived, not tuned).
export const DEFAULT_POLICIES: readonly PolicyModel[] = [
  { name: 'diagnose',       kind: 'epistemic', resolved_competence: 0.70, ambiguous_competence: 0.85 },
  { name: 'search_corpus',  kind: 'epistemic', resolved_competence: 0.70, ambiguous_competence: 0.85 },
  { name: 'pfar',           kind: 'epistemic', resolved_competence: 0.70, ambiguous_competence: 0.85 },
  { name: 'vfar',           kind: 'epistemic', resolved_competence: 0.70, ambiguous_competence: 0.85 },
  { name: 'calc',           kind: 'pragmatic', resolved_competence: 0.90, ambiguous_competence: 0.25 },
  { name: 'remember',       kind: 'pragmatic', resolved_competence: 0.90, ambiguous_competence: 0.25 },
  { name: 'notebook_write', kind: 'pragmatic', resolved_competence: 0.90, ambiguous_competence: 0.25 },
  { name: 'code_engine',    kind: 'pragmatic', resolved_competence: 0.90, ambiguous_competence: 0.25 },
];

export interface PolicyEvaluation {
  pragmatic_risk: number;        // D_KL[q(o|π) ‖ p(o)], bits
  epistemic_ambiguity: number;   // E_{q(s)}[H_b(p(o|s,π))], bits
  total_G: number;               // risk + ambiguity
  selection_probability: number; // σ(π)
}

// Spec §5.1 ActiveInferenceState — the wire/log shape.
export interface ActiveInferenceState {
  coherence_triad: { structural: number; relational: number; harmonic: number };
  free_energy: { F: number; internal_energy_U: number; entropy_S: number; anisotropy_A: number };
  observation_ambiguity_H: number;  // ℋ(q(o|s)), bits ∈ [0,1]
  epistemic_trigger: boolean;       // ℋ > AMBIGUITY_THRESHOLD
  expected_free_energy_G: Record<string, PolicyEvaluation>;
  selected_policy: string;          // argmax σ(π)
  epistemic_mass: number;           // Σ σ over EPISTEMIC_TOOLS in the roster
}

// ── Information-theory primitives (bits) ───────────────────────────────────
const round = (x: number): number => Number(x.toFixed(6));
const LOG2 = Math.log(2);
const log2 = (x: number): number => Math.log(x) / LOG2;

// Binary entropy H_b(p) in bits; 0 at the endpoints by continuity.
export function binaryEntropy(p: number): number {
  if (!(p > 0) || !(p < 1)) return 0;
  return -p * log2(p) - (1 - p) * log2(1 - p);
}

// KL divergence between Bernoulli(p) and Bernoulli(q), bits. q is clamped
// away from {0,1} so a hard preference prior can't produce Infinity.
export function bernoulliKL(p: number, q: number): number {
  const qc = Math.min(1 - 1e-9, Math.max(1e-9, q));
  const term = (a: number, b: number): number => (a > 0 ? a * log2(a / b) : 0);
  return term(p, qc) + term(1 - p, 1 - qc);
}

// ℋ(q(o|s)) — observation-state ambiguity: φ-weighted binary entropy of the
// coherence triad. Each channel c_k is read as p(coherent observation on
// channel k); ambiguity peaks (ℋ = 1) when every channel sits at 0.5 and
// vanishes as the triad commits to either pole. Range [0,1] since the
// φ-weights are normalized.
export function observationAmbiguity(c: Coherence, weights: readonly number[] = PHI_WEIGHTS): number {
  const cs = [c.structural, c.relational, c.harmonic];
  let h = 0;
  for (let k = 0; k < 3; k++) h += weights[k] * binaryEntropy(Math.min(1, Math.max(0, cs[k])));
  return round(h);
}

// ── Expected Free Energy per policy ────────────────────────────────────────
export function evaluatePolicy(
  H: number, policy: PolicyModel, preferredProgress = PREFERRED_PROGRESS,
): Omit<PolicyEvaluation, 'selection_probability'> {
  const h = Math.min(1, Math.max(0, H));
  const { resolved_competence: g, ambiguous_competence: b } = policy;
  // q(o=progress | π): the two-state mixture under q(ambiguous) = ℋ.
  const qProgress = h * b + (1 - h) * g;
  const pragmatic_risk = bernoulliKL(qProgress, preferredProgress);
  // E_{q(s)}[H_b(p(o|s,π))]: expected outcome-likelihood entropy.
  const epistemic_ambiguity = h * binaryEntropy(b) + (1 - h) * binaryEntropy(g);
  return {
    pragmatic_risk: round(pragmatic_risk),
    epistemic_ambiguity: round(epistemic_ambiguity),
    total_G: round(pragmatic_risk + epistemic_ambiguity),
  };
}

// σ(π) = softmax(−γ·G), numerically stable (shift by min G).
export function policyPosterior(Gs: readonly number[], gamma = POLICY_PRECISION_GAMMA): number[] {
  if (Gs.length === 0) return [];
  const gMin = Math.min(...Gs);
  const ws = Gs.map((G) => Math.exp(-gamma * (G - gMin)));
  const Z = ws.reduce((s, w) => s + w, 0);
  return ws.map((w) => round(w / Z));
}

export interface ActiveInferenceInput {
  coherence: Coherence;
  T?: number;                        // regulator temperature (default matches regulate's 0.5)
  gamma?: number;
  policies?: readonly PolicyModel[];
}

// The full evaluation: F from the regulator (REUSED, never re-derived), ℋ
// from the triad, G(π) and σ(π) per policy, argmax selection.
export function evaluateActiveInference(input: ActiveInferenceInput): ActiveInferenceState {
  const { coherence } = input;
  const T = input.T ?? 0.5;
  const gamma = input.gamma ?? POLICY_PRECISION_GAMMA;
  const policies = input.policies ?? DEFAULT_POLICIES;

  const fe = freeEnergy(coherence, T);
  const H = observationAmbiguity(coherence);

  const partial = policies.map((p) => evaluatePolicy(H, p));
  const sigma = policyPosterior(partial.map((e) => e.total_G), gamma);

  const G: Record<string, PolicyEvaluation> = {};
  let selected = policies[0]?.name ?? '';
  let best = -1;
  let epistemicMass = 0;
  const epistemicSet = new Set<string>(EPISTEMIC_TOOLS);
  policies.forEach((p, i) => {
    G[p.name] = { ...partial[i], selection_probability: sigma[i] };
    if (sigma[i] > best) { best = sigma[i]; selected = p.name; }
    if (epistemicSet.has(p.name)) epistemicMass += sigma[i];
  });

  return {
    coherence_triad: {
      structural: round(coherence.structural),
      relational: round(coherence.relational),
      harmonic: round(coherence.harmonic),
    },
    free_energy: { F: fe.F, internal_energy_U: fe.U, entropy_S: fe.S, anisotropy_A: fe.A },
    observation_ambiguity_H: H,
    epistemic_trigger: H > AMBIGUITY_THRESHOLD,
    expected_free_energy_G: G,
    selected_policy: selected,
    epistemic_mass: round(epistemicMass),
  };
}

// ── D1 log (schema.ts: elle_active_inference_log) ──────────────────────────
export async function logActiveInference(
  env: AtlasStoreEnv, state: ActiveInferenceState, turnId: string, userId: string, now = Date.now(),
): Promise<void> {
  const sel = state.expected_free_energy_G[state.selected_policy];
  await env.DB.prepare(
    `INSERT OR REPLACE INTO elle_active_inference_log
       (turn_id, user_id, structural_coherence, relational_coherence, harmonic_coherence,
        free_energy_F, internal_energy_U, entropy_S, selected_tool_policy, expected_free_energy_G, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  ).bind(
    turnId, userId,
    state.coherence_triad.structural, state.coherence_triad.relational, state.coherence_triad.harmonic,
    state.free_energy.F, state.free_energy.internal_energy_U, state.free_energy.entropy_S,
    state.selected_policy, sel ? sel.total_G : 0, now,
  ).run();
}

// ── The cognitive-map snapshot behind /api/cognitive/map (SSE) ─────────────
// Poincaré disk positions + winding vectors from the persisted atlas, the
// regulator's Lyapunov descent trace from the given triad, and the active-
// inference state. The route (index.ts) streams these as frames via sseDoor.

export interface DiskPoint {
  id: string;
  disk: [number, number];        // norm-preserving 2-D projection of the ball point
  radial_depth: number;
  winding_vector: number[];
  delta_hyperbolicity: number;
  cycle_rank_b1: number;
}

// Project a B^128 point onto the unit disk: direction from the first two
// coordinates, magnitude = the FULL ball norm — radial structure (depth
// hierarchy) survives the projection exactly even when the leading pair
// carries little of the vector.
export function toDisk(ball: readonly number[]): [number, number] {
  let n2 = 0;
  for (const x of ball) n2 += x * x;
  // Margin 2e-6: coordinates are rounded to 6 decimals afterwards, and a
  // 1e-9 margin can round back OUTSIDE the open disk (hypot > 1).
  const norm = Math.min(Math.sqrt(n2), 1 - 2e-6);
  const lead = Math.hypot(ball[0] ?? 0, ball[1] ?? 0);
  if (lead < 1e-12) return [round(norm), 0];
  return [round(((ball[0] ?? 0) / lead) * norm), round(((ball[1] ?? 0) / lead) * norm)];
}

export interface CognitiveMapSnapshot {
  active_inference: ActiveInferenceState;
  atlas: DiskPoint[];
  lyapunov: RegulatorStep[];
}

export async function cognitiveMapSnapshot(
  env: AtlasStoreEnv, userId: string, coherence: Coherence,
  opts: { limit?: number; steps?: number; T?: number } = {},
): Promise<CognitiveMapSnapshot> {
  const points = await readAtlasPoints(env, userId, opts.limit ?? 200);
  const state = evaluateActiveInference({ coherence, T: opts.T });
  const lyapunov = regulate(coherence, { T: opts.T ?? 0.5, steps: opts.steps ?? 60 }).trace;
  return {
    active_inference: state,
    atlas: points.map((p) => ({
      id: p.id,
      disk: toDisk(p.hyperbolic_ball),
      radial_depth: p.radial_depth,
      winding_vector: p.winding_vector,
      delta_hyperbolicity: p.delta_hyperbolicity,
      cycle_rank_b1: p.cycle_rank_b1,
    })),
    lyapunov,
  };
}
