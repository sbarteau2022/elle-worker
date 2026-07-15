// ============================================================
// COGNITIVE OBLIQUITY — src/cognitive-obliquity.ts
//
// A slowly-varying ORIENTATION parameter over the cognitive state, by analogy to
// Earth's axial tilt: obliquity doesn't stop the planet spinning, it changes how
// incoming energy is distributed across the surface over long periods. Here θ
// doesn't change the update rule F, it changes how incoming information u_t is
// PROJECTED before F integrates it:
//
//     x_{t+1} = F( x_t , R(θ) u_t )
//
// where R(θ) is an orientation transform (the same rotation family as the phase
// vessel — there it turns the state, here it turns the input) and θ evolves much
// more slowly than x. So θ is a control parameter that governs which
// representational axis gets preferentially integrated over long horizons —
// exploration vs. exploitation, abstract vs. concrete — without touching the
// moment-to-moment dynamics.
//
// THE PRECONDITION, FOUND BY MEASUREMENT (this is the honest part). A first probe
// with BALANCED input and a SYMMETRIC integrator showed θ does essentially
// nothing: rotating isotropic information leaves it isotropic. Obliquity only
// bites when there is ANISOTROPY to orient relative to — structure in the input
// AND/OR a preferred internal axis in F. This is not a hole in the analogy, it is
// the analogy one level deeper: Earth's tilt matters only because the Sun is a
// DIRECTIONAL source and the surface has structure. Tilt a featureless ball under
// isotropic light and obliquity is invisible. Both halves are built here:
//   - obliquitySteers()  — structured input + preferred axis → a clean cos²(θ)
//     reallocation of what gets integrated (same F, same energy; θ alone).
//   - isotropicNull()    — balanced input + symmetric F → θ changes nothing.
//
// THE FALSIFICATION TEST (sharper than "θ changes integration"). Cognitive
// obliquity, IF it exists as a latent variable, should be:
//   1. slow — evolving far below the timescale of moment-to-moment state, and
//   2. detectable ONLY in domains where a preferred representational axis exists
//      (expertise, a committed frame, an entrenched bias), with a NULL in
//      genuinely novel / unstructured domains.
// That is a harder claim to satisfy by accident than "orientation matters," and
// it says exactly where to look and where to expect nothing. detectability()
// returns both arms so the prediction can be checked, not just asserted.
//
// HONEST SCOPE: everything here is verified IN-MODEL — it shows the mechanism is
// coherent and produces the predicted signature in a state-vector-on-a-manifold
// system. It does NOT establish that human cognition has a slow obliquity
// variable; that is the longitudinal-data question (behavioral / neural over
// weeks–months) this module can only frame, not answer. A hypothesis with a test
// attached, not a result. Deterministic, pure, Worker-safe.
// ============================================================

const TWO_PI = Math.PI * 2;
const round = (x: number): number => Number(x.toFixed(6));
const frac = (x: number): number => x - Math.floor(x);

export type Vec2 = [number, number];

// R(θ): the orientation transform — a 2D rotation of the input vector.
export function orient(theta: number, u: Vec2): Vec2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * u[0] - s * u[1], s * u[0] + c * u[1]];
}

export interface ObliquityConfig {
  steps?: number;
  intRate?: number;      // integration rate on the preferred axis (fast dynamics)
  leakRate?: number;     // decay rate on the non-preferred axis
  structured?: boolean;  // true: input energy concentrated on one axis (a "class"); false: balanced/isotropic
  seedPhase?: number;
}

// One quasi-deterministic input sample. Structured input carries a real signal on
// axis 0 and only a whisper on axis 1 (a class of information); isotropic input
// carries balanced energy on both.
function inputAt(t: number, structured: boolean, seedPhase: number): Vec2 {
  const a = Math.cos(TWO_PI * frac(t * 0.6180339887 + seedPhase));
  const b = Math.sin(TWO_PI * frac(t * 0.4142135624 + seedPhase));
  return structured ? [a, 0.15 * b] : [a, b];
}

export interface ObliquityRun {
  integrated_preferred: number; // long-run energy integrated onto the preferred axis
  integrated_other: number;     // long-run energy on the other axis
  x_step_var: number;           // how fast x moves (fast dynamics)
  theta_step_var: number;       // how fast θ moves (slow, when a slow schedule is used)
}

// x_{t+1} = F(x_t, R(θ_t) u_t). F: leaky integration with a PREFERRED axis
// (axis 0 integrates at intRate; axis 1 leaks at leakRate). Same F for all θ.
export function runObliquity(thetaOf: (t: number) => number, cfg: ObliquityConfig = {}): ObliquityRun {
  const steps = cfg.steps ?? 8000;
  const intRate = cfg.intRate ?? 0.08;
  const leakRate = cfg.leakRate ?? 0.5;
  const structured = cfg.structured ?? true;
  const seedPhase = cfg.seedPhase ?? 0;

  let x: Vec2 = [0, 0];
  let e0 = 0, e1 = 0, n = 0;
  let xStepAbs = 0, thetaStepAbs = 0, prevX0 = 0, prevTheta = thetaOf(0);
  for (let t = 0; t < steps; t++) {
    const u = inputAt(t, structured, seedPhase);
    const theta = thetaOf(t);
    const ru = orient(theta, u);
    x = [(1 - intRate) * x[0] + intRate * ru[0], (1 - leakRate) * x[1] + leakRate * ru[1]];
    xStepAbs += Math.abs(x[0] - prevX0); prevX0 = x[0];
    thetaStepAbs += Math.abs(theta - prevTheta); prevTheta = theta;
    if (t > steps * 0.3) { e0 += x[0] * x[0]; e1 += x[1] * x[1]; n++; }
  }
  return {
    integrated_preferred: round(e0 / n),
    integrated_other: round(e1 / n),
    x_step_var: round(xStepAbs / steps),
    theta_step_var: round(thetaStepAbs / steps),
  };
}

// θ steers which class gets integrated: a cos²(θ)-shaped reallocation, same F.
export interface SteerSweep { theta_deg: number; integrated_preferred: number }
export function obliquitySteers(): { sweep: SteerSweep[]; aligned: number; orthogonal: number; halfway: number; monotone: boolean } {
  const sweep: SteerSweep[] = [];
  for (const deg of [0, 15, 30, 45, 60, 75, 90]) {
    const r = runObliquity(() => (deg * Math.PI) / 180, { structured: true });
    sweep.push({ theta_deg: deg, integrated_preferred: r.integrated_preferred });
  }
  const aligned = sweep[0].integrated_preferred;      // θ=0
  const orthogonal = sweep[6].integrated_preferred;   // θ=90
  const halfway = sweep[3].integrated_preferred;      // θ=45
  let monotone = true;
  for (let i = 1; i < sweep.length; i++) if (sweep[i].integrated_preferred > sweep[i - 1].integrated_preferred + 1e-9) monotone = false;
  return { sweep, aligned, orthogonal, halfway, monotone };
}

// The precondition: with isotropic input and a symmetric integrator, θ does
// essentially nothing.
export function isotropicNull(): { spread_ratio: number; effectively_flat: boolean } {
  const vals: number[] = [];
  for (const deg of [0, 30, 45, 60, 90]) {
    const r = runObliquity(() => (deg * Math.PI) / 180, { structured: false, leakRate: 0.08 }); // symmetric-ish F
    vals.push(r.integrated_preferred);
  }
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const spread_ratio = mn > 0 ? mx / mn : Infinity;
  return { spread_ratio: round(spread_ratio), effectively_flat: spread_ratio < 1.3 };
}

// Timescale separation: a slow θ schedule moves far less per step than x does.
export function timescaleSeparation(): { theta_step_var: number; x_step_var: number; theta_much_slower: boolean } {
  const T = 6000;
  const r = runObliquity((t) => 0.5 * Math.sin(TWO_PI * t / T), { structured: true, steps: T });
  const theta_much_slower = r.theta_step_var < r.x_step_var / 5;
  return { theta_step_var: r.theta_step_var, x_step_var: r.x_step_var, theta_much_slower };
}

// The falsification test, both arms: detectable in a structured domain, null in a
// novel/isotropic one. A latent obliquity variable predicts EXACTLY this pattern.
export interface Detectability {
  structured_effect: number;   // reallocation magnitude where a preferred axis exists
  novel_effect: number;        // reallocation magnitude in an isotropic/novel domain
  detectable_where_structure: boolean;
  null_where_novel: boolean;
  prediction_shape_holds: boolean;
  note: string;
}
export function detectability(): Detectability {
  const s = obliquitySteers();
  const structured_effect = s.aligned > 0 ? (s.aligned - s.orthogonal) / s.aligned : 0; // fraction reallocated by θ
  const iso = isotropicNull();
  const novel_effect = iso.spread_ratio - 1; // ~0 when θ has no effect
  const detectable_where_structure = structured_effect > 0.5;
  const null_where_novel = novel_effect < 0.3;
  return {
    structured_effect: round(structured_effect),
    novel_effect: round(novel_effect),
    detectable_where_structure,
    null_where_novel,
    prediction_shape_holds: detectable_where_structure && null_where_novel,
    note: 'The sharper, more falsifiable prediction: cognitive obliquity should be visible in domains with a preferred representational axis (expertise, a committed frame) and NULL in genuinely novel/unstructured ones — not "orientation always matters." Verified in-model; the human version is the longitudinal question this only frames.',
  };
}

// ============================================================
// self-test
// ============================================================
export interface CognitiveObliquitySelfTest {
  ok: boolean;
  steers_integration: boolean;    // θ reallocates which class integrates (structured)
  cos2_shape: boolean;            // the reallocation is cos²(θ)-shaped (halfway ≈ mid, monotone)
  isotropic_null: boolean;        // θ does ~nothing on balanced input (the precondition)
  timescale_separation: boolean;  // θ evolves much slower than x
  falsification_shape_holds: boolean; // detectable-where-structured AND null-where-novel
  aligned: number; orthogonal: number; halfway: number;
  note: string;
}

export function cognitiveObliquitySelfTest(): CognitiveObliquitySelfTest {
  const steer = obliquitySteers();
  const steers_integration = steer.aligned > steer.orthogonal * 3; // strong reallocation
  // cos²(θ): θ=45° should sit near half of the aligned value, and the sweep monotone
  const cos2_shape = steer.monotone && Math.abs(steer.halfway - steer.aligned * 0.5) < steer.aligned * 0.2;

  const iso = isotropicNull();
  const isotropic_null = iso.effectively_flat;

  const ts = timescaleSeparation();
  const timescale_separation = ts.theta_much_slower;

  const det = detectability();
  const falsification_shape_holds = det.prediction_shape_holds;

  const ok = steers_integration && cos2_shape && isotropic_null && timescale_separation && falsification_shape_holds;
  return {
    ok,
    steers_integration, cos2_shape, isotropic_null, timescale_separation, falsification_shape_holds,
    aligned: steer.aligned, orthogonal: steer.orthogonal, halfway: steer.halfway,
    note: 'A slow orientation parameter R(θ) over x_{t+1}=F(x_t,R(θ)u_t): θ reallocates which class of information is integrated (a cos²(θ) shape, same F), but ONLY when a preferred axis exists — isotropic input gives a null, the precondition the analogy predicts. θ evolves far slower than x. The falsification shape (detectable in structured domains, null in novel ones) holds in-model. A hypothesis with a test attached; not a claim about human brains.',
  };
}
