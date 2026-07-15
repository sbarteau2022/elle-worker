// ============================================================
// CONVERGENCE — src/convergence.ts
//
// The index between convergence and fact: when independent sources agree, how
// much should that raise confidence? Falcon (falcon.ts) already has the right
// SHAPE for this — parallel independent readings, then an adversarial
// Validation Tier that names drift, considers alternative conclusions, and
// states what would change the analysis, before anything is allowed to
// synthesize. That shape is reused here honestly: Falcon's actual 16 axes are
// LLM-prompted and product-intelligence-specific (market/financial/UX), so this
// is NOT "calling Falcon" — it is the same pattern (parallel → adversarial
// cross-check → named dissent), rebuilt as deterministic, testable machinery
// for corpus corroboration instead of product analysis.
//
// THE HONEST DISTINCTION THIS EXISTS TO PROTECT: agreement across sources is
// CORROBORATION, not GROUNDING. Multiple texts agreeing is still text — it can
// mean independent confirmation, or it can mean an echo (the same author, the
// same lab, one paper citing another in a closed loop). This module refuses to
// count an echo as corroboration: sources are grouped by ORIGIN (author/paper),
// and only CROSS-ORIGIN agreement counts toward the convergence index. This is
// the same discipline as the grounding gate (harmonic-coherence.ts):
// consistency ≠ correspondence, now applied to "many documents agreeing with
// each other" ≠ "independently confirmed."
//
// Composes with reasoning.ts as a THIRD independent axis, never merged into
// the modality-driven grounding ceiling: structure (semantic channel),
// grounding (world-coupled channels: audio/vision), and now corroboration
// (independent-origin textual agreement). Three different kinds of evidence,
// reported separately, never conflated into one fake score.
// ============================================================

const round = (x: number): number => Number(x.toFixed(4));

// A short stopword list matters here in a way it didn't in the mind-map
// pipeline's topic-clustering: claims are short, so shared function words
// ("the", "and", "this") can fake relevance/agreement between UNRELATED texts.
// Excluding them is what keeps the echo/corroboration distinction honest.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'this', 'that', 'with', 'from', 'have',
  'has', 'its', 'our', 'here', 'not', 'but', 'you', 'your', 'all', 'can',
  'his', 'her', 'she', 'him', 'they', 'them', 'their', 'were', 'been', 'being',
  'into', 'over', 'than', 'then', 'also', 'just', 'more', 'most', 'some',
  'any', 'each', 'such', 'only', 'own', 'same', 'about', 'against', 'between',
]);

function tokens(s: string): Set<string> {
  return new Set(
    String(s || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Source {
  id: string;      // a stable id for this piece of text (chunk id, doc id)
  origin: string;  // the INDEPENDENT unit: author/paper/series — same origin ⇒ not independent
  text: string;
}

export interface DissentEntry {
  id: string;
  origin: string;
  reason: string;
}

export type ConvergenceTier = 'no_sources' | 'single_source' | 'echoed' | 'corroborated' | 'contested';

export interface ConvergenceResult {
  claim: string;
  relevant_sources: number;
  distinct_origins: number;
  convergence_index: number;   // 0..1 — mean CROSS-ORIGIN agreement only (echoes excluded by construction)
  tier: ConvergenceTier;
  dissent: DissentEntry[];     // the named Rupture: sources that don't back up the rest
  note: string;
}

export interface ConvergenceOptions {
  relevanceThreshold?: number; // a source must overlap the claim at least this much to count
  agreeThreshold?: number;     // cross-origin overlap at/above this counts as "backing it up"
}

// The convergence engine: parallel independent reads (each source scored
// against the claim) → cross-origin agreement only (echoes filtered by
// construction) → named dissent (the Rupture) → a tier that never overstates
// what "documents agree" can mean.
export function convergence(claim: string, sources: Source[], opts: ConvergenceOptions = {}): ConvergenceResult {
  const relThresh = opts.relevanceThreshold ?? 0.05;
  const agreeThresh = opts.agreeThreshold ?? 0.18;
  const claimT = tokens(claim);

  const scored = sources
    .filter((s) => s && s.text)
    .map((s) => ({ ...s, t: tokens(s.text), rel: jaccard(claimT, tokens(s.text)) }))
    .filter((s) => s.rel >= relThresh);

  if (scored.length === 0) {
    return {
      claim, relevant_sources: 0, distinct_origins: 0, convergence_index: 0, tier: 'no_sources', dissent: [],
      note: 'No source in the corpus was relevant to this claim — there is nothing to converge on.',
    };
  }

  const origins = [...new Set(scored.map((s) => s.origin))];

  if (origins.length === 1) {
    return {
      claim, relevant_sources: scored.length, distinct_origins: 1, convergence_index: 0,
      tier: scored.length === 1 ? 'single_source' : 'echoed', dissent: [],
      note: scored.length === 1
        ? 'Exactly one relevant source — nothing to corroborate it against.'
        : `${scored.length} relevant passages, but all from the same origin (${origins[0]}) — that is an echo, not independent corroboration. A single voice repeating itself does not converge.`,
    };
  }

  // cross-origin agreement ONLY — same-origin pairs never contribute (the echo guard)
  let pairSum = 0, pairCount = 0;
  const bestCross = new Map<string, number>();
  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      if (scored[i].origin === scored[j].origin) continue;
      const a = jaccard(scored[i].t, scored[j].t);
      pairSum += a; pairCount++;
      bestCross.set(scored[i].id, Math.max(bestCross.get(scored[i].id) ?? 0, a));
      bestCross.set(scored[j].id, Math.max(bestCross.get(scored[j].id) ?? 0, a));
    }
  }
  const convergence_index = pairCount ? round(pairSum / pairCount) : 0;

  const dissent: DissentEntry[] = scored
    .filter((s) => (bestCross.get(s.id) ?? 0) < agreeThresh)
    .map((s) => ({ id: s.id, origin: s.origin, reason: 'no other independent origin backs this passage up on the claim' }));

  const tier: ConvergenceTier =
    convergence_index >= agreeThresh && dissent.length === 0 ? 'corroborated' : 'contested';

  return {
    claim, relevant_sources: scored.length, distinct_origins: origins.length, convergence_index, tier, dissent,
    note: tier === 'corroborated'
      ? `${origins.length} independent origins agree on this claim — real cross-source corroboration, not an echo.`
      : dissent.length
        ? `${dissent.length} of ${scored.length} relevant passages found no independent backing — named, not hidden. This is contested, not settled.`
        : `${origins.length} independent origins are relevant but do not substantially agree — inconclusive, not corroborated.`,
  };
}

// ============================================================
// self-test — the sharpest check is that an echo can NEVER be mistaken for
// corroboration, no matter how similar the repeated text is.
// ============================================================
export interface ConvergenceSelfTest {
  ok: boolean;
  no_sources_when_irrelevant: boolean;
  single_source_alone: boolean;
  echo_is_not_corroboration: boolean;  // the load-bearing guarantee
  independent_agreement_corroborates: boolean;
  dissent_is_named_not_hidden: boolean;
  note: string;
}

export function convergenceSelfTest(): ConvergenceSelfTest {
  const claim = 'the golden ratio governs the phase of the architecture';

  const irrelevant = convergence(claim, [{ id: 'a', origin: 'paperA', text: 'the weather today is mild and sunny' }]);
  const no_sources_when_irrelevant = irrelevant.tier === 'no_sources';

  const alone = convergence(claim, [{ id: 'a', origin: 'paperA', text: 'the golden ratio governs the phase of this architecture directly' }]);
  const single_source_alone = alone.tier === 'single_source';

  // SAME origin repeating itself in three "different" chunks — must NOT corroborate
  const echoText = 'the golden ratio governs the phase of the architecture, as established here';
  const echoed = convergence(claim, [
    { id: 'a1', origin: 'paperA', text: echoText },
    { id: 'a2', origin: 'paperA', text: echoText },
    { id: 'a3', origin: 'paperA', text: echoText },
  ]);
  const echo_is_not_corroboration = echoed.tier === 'echoed' && echoed.convergence_index === 0;

  // genuinely DIFFERENT origins independently saying compatible things
  const independent = convergence(claim, [
    { id: 'b1', origin: 'paperB', text: 'the golden ratio sets the phase of this architecture in our analysis' },
    { id: 'c1', origin: 'paperC', text: 'independently, the phase of the architecture follows the golden ratio' },
  ]);
  const independent_agreement_corroborates = independent.tier === 'corroborated' && independent.distinct_origins === 2;

  // one clear dissenter among otherwise-agreeing independent origins. Note the
  // dissenting text shares NO vocabulary with the claim beyond "architecture" —
  // this engine detects topical divergence (does this source use the same
  // vocabulary as the others?), not logical negation ("architecture has
  // nothing to do with any golden ratio" would still SHARE the keywords and
  // lexically look like agreement — a real, documented limit, not a bug).
  const withDissent = convergence(claim, [
    { id: 'd1', origin: 'paperD', text: 'the golden ratio sets the phase of this architecture in our analysis' },
    { id: 'e1', origin: 'paperE', text: 'independently, the phase of the architecture follows the golden ratio' },
    { id: 'f1', origin: 'paperF', text: 'this architecture is better explained by seasonal migration patterns of urban wildlife populations' },
  ]);
  const dissent_is_named_not_hidden = withDissent.dissent.length >= 1 && withDissent.dissent.some((d) => d.origin === 'paperF');

  const ok = no_sources_when_irrelevant && single_source_alone && echo_is_not_corroboration &&
    independent_agreement_corroborates && dissent_is_named_not_hidden;

  return {
    ok, no_sources_when_irrelevant, single_source_alone, echo_is_not_corroboration,
    independent_agreement_corroborates, dissent_is_named_not_hidden,
    note: 'The load-bearing guarantee: three chunks from the SAME origin repeating the same claim score convergence_index=0 and tier="echoed" — an echo can never be mistaken for corroboration, no matter how similar the repeated text is. Real cross-origin agreement corroborates; a genuine dissenter is named, never hidden — the Rupture, kept honest.',
  };
}
