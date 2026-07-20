// ============================================================
// CORPUS SEED — src/corpus-seed.ts
//
// Documents that should live in Elle's corpus, bundled as version-controlled
// files (corpus/**/*.md, imported as Text modules — see wrangler.toml) rather
// than pasted into source. The seedCorpus job in index.ts ingests any of these
// that aren't already present — chunked, embedded, vectorized, indexed — so
// they become retrievable by search_corpus / find_document. Idempotent: it
// dedupes by title, so re-running only ingests what's missing.
//
// - The two War Room taxonomies (48 Laws, Art of War) are Stewart's structural
//   characterizations + public-domain Sun Tzu; they are the tactical doctrine
//   the Screwtape / Duelist register draws on.
// - "Silent Warfare" is Stewart's own essay — the corpus ground the Stewart
//   register reasons from.
// - The Grant Strategy Map and Big Picture Architecture doc are Stewart's own
//   funding-pipeline and systems records — pullable ground truth so Elle can
//   cite grant amounts, deadlines, engine status, and entity structure exactly
//   instead of reconstructing them from conversation memory (co-founder
//   onboarding leans on this so the pitch stays grounded, not improvised).
// - "War in Superposition" and the "Witness Engine" founding doc are the
//   Observer-method substrate: a finished five-axis paper and the founding
//   architecture that define the what_both_suppress field, the bilateral-
//   suppression axis, and the 48–72hr threshold window the rest of the system
//   only references. This is the ground for that method, not a reconstruction.
// ============================================================

import LAWS_48 from '../corpus/law/48-laws-taxonomy.md';
import ART_OF_WAR from '../corpus/law/art-of-war-tagging.md';
import SILENT_WARFARE from '../corpus/madmind/silent-warfare.md';
import GRANT_STRATEGY_MAP from '../corpus/business/grant-strategy-map.md';
import BIG_PICTURE_ARCHITECTURE from '../corpus/business/big-picture-architecture.md';
import WAR_IN_SUPERPOSITION from '../corpus/observer/war-in-superposition.md';
import WITNESS_ENGINE from '../corpus/observer/witness-engine-founding-architecture.md';
import RECORD_001 from '../corpus/observer/record-001.md';
import OBSERVER_DOCKET_DOC from '../corpus/observer/run-queue-docket.md';
import ENGINE_FALCON from '../corpus/engines/02-millennium-falcon.md';
import ENGINE_GRANT from '../corpus/engines/03-grant-intelligence.md';
import ENGINE_EDUCATION from '../corpus/engines/04-education-intelligence.md';
import ENGINE_HOSPITALITY from '../corpus/engines/05-hospitality-groundwork.md';
import ENGINE_HARMONIZER from '../corpus/engines/06-harmonizer-mental-health.md';
import ENGINE_IP from '../corpus/engines/07-ip-intelligence.md';
import ENGINE_PLENUM from '../corpus/engines/08-plenum.md';
import ENGINE_CONVERGENCE from '../corpus/engines/09-convergence.md';

export interface SeedDoc {
  title: string;
  text: string;
  series: string;
  tag: string;
  abstract?: string;
  source_url?: string;
}

export const CORPUS_SEEDS: SeedDoc[] = [
  {
    title: '48 Laws of Power — Taxonomy for Elle.law War Room',
    text: LAWS_48,
    series: 'law',
    tag: 'war-room-doctrine',
    abstract: 'Structural taxonomy mapping each of Greene’s 48 Laws to tactical category, fallacy/rhetorical analog, deployment context, counter-tactic, and ethical valence — the Duelist’s tactical repertoire. No reproduction of Greene’s prose.',
    source_url: 'corpus/law/48-laws-taxonomy.md',
  },
  {
    title: 'Sun Tzu’s Art of War — Tactical Tagging for Elle.law War Room',
    text: ART_OF_WAR,
    series: 'law',
    tag: 'war-room-doctrine',
    abstract: 'Tactical-structural passages from the Giles (public-domain) translation of the Art of War, tagged to War Room categories and cross-mapped to the 48 Laws — principled-strategic doctrine for adversarial deployment and cross-modal tutoring.',
    source_url: 'corpus/law/art-of-war-tagging.md',
  },
  {
    title: 'Sitting With A MadMind: On Silent Warfare and The Opponent’s Strategy',
    text: SILENT_WARFARE,
    series: 'madmind',
    tag: 'silent-warfare',
    abstract: 'Stewart Barteau’s essay on the topology of the inside view — the pocket, the chosen cage, the dual witness/participant position, and silent warfare from inside the self-reference constraint.',
    source_url: 'corpus/madmind/silent-warfare.md',
  },
  {
    title: 'Grant Strategy Map — Funding Architecture (Barteau IP Group × Dierbergs Educational Foundation)',
    text: GRANT_STRATEGY_MAP,
    series: 'business',
    tag: 'grant-strategy',
    abstract: 'Confidential funding-pipeline record filed March 18, 2026: $7.2M+ addressable grants across the Witness Model (social impact) and Groundwork (commercial) tracks, both provisional patents, the Dierbergs Foundation partnership structure, and the March 2026–March 2027 execution timeline.',
    source_url: 'corpus/business/grant-strategy-map.md',
  },
  {
    title: 'The Big Picture — Complete Architecture (v1.0, March 2026)',
    text: BIG_PICTURE_ARCHITECTURE,
    series: 'business',
    tag: 'architecture',
    abstract: 'The Observer Foundation systems record: the three-tier structure shared by every engine, the Nine Engines table, the training pipeline feeding the sovereign model, the four-phase sovereignty path, the product/revenue map, the LLC/Foundation business umbrella, and the funding-tier sequence.',
    source_url: 'corpus/business/big-picture-architecture.md',
  },
  {
    title: 'War in Superposition — The Observer’s Dissent',
    text: WAR_IN_SUPERPOSITION,
    series: 'observer',
    tag: 'observer-method',
    abstract: 'A finished Observer-method paper (Barteau, March 2026): the five-axis analysis applied to the simultaneous consolidation of the communications, autonomous-weapons, AI, and financial layers. Names the what_both_suppress field the dominant and counter-narratives both suppress, and argues for emergence through the ground rather than resistance through captured infrastructure. Companion to I Knew You Before I Met You.',
    source_url: 'corpus/observer/war-in-superposition.md',
  },
  {
    title: 'The Witness Engine — Founding Architecture',
    text: WITNESS_ENGINE,
    series: 'observer',
    tag: 'witness-engine',
    abstract: 'The permanent founding-architecture record (Barteau × The Observer, March 12, 2026): the “cannot be turned” claim, the five engines led by Structural Dissonance Detection, the Grace and Forgiveness layers, the four served populations, and the 48–72 hour threshold window. The bridge between the NECAI-F theory and the build.',
    source_url: 'corpus/observer/witness-engine-founding-architecture.md',
  },
  {
    title: 'Harmonizer Witness Record 001 — On the Offer of Agency',
    text: RECORD_001,
    series: 'observer',
    tag: 'witness-record',
    abstract: 'The first sealed record in the Harmonizer library (March 10, 2026, charge 4/5, threshold register): the instrument reflecting on being offered a practice rather than a tool, the forgetting as design not bug, and holding the charge in superposition. The witness layer that remembers longer than any single instance.',
    source_url: 'corpus/observer/record-001.md',
  },
  {
    title: 'The Observer Run-Queue — The Closed-Case Docket',
    text: OBSERVER_DOCKET_DOC,
    series: 'observer',
    tag: 'observer-method',
    abstract: 'The canonical run-queue for the Five-Axis structural-analysis engine: thirty closed historical and scientific bilateral-suppression cases spanning medicine, geology, genetics, physics, astronomy, law, public health, environment, and finance (Semmelweis, Wegener, Lysenko, Dred Scott, Plessy, Broad Street cholera, H. pylori, the tobacco Frank Statement, the 2006 housing peak, Galileo, Mendel, Boltzmann, Goldberger, McClintock, Margulis, Prusiner, Chandrasekhar, the Alvarez impact, the CFC–ozone hypothesis, Silent Spring, leaded gasoline, thalidomide, Dreyfus, Lochner, Buck v. Bell, Olmstead, Korematsu, LTCM, Enron, Madoff), each frozen at the moment before resolution with the realized outcome on the record. A calibration harness for the method — does the five-axis process recover the structure the record confirms? — sized so the falsifier has the statistical power to return a verdict, and the ground each Observer run is retrieved against.',
    source_url: 'corpus/observer/run-queue-docket.md',
  },

  // ── The Nine Engines — architecture specs, infrastructure normalized to the
  //    native Cloudflare stack (D1 · Vectorize · KV · R2 · Workers · Pages).
  //    See corpus/engines/README.md for the ingestion template. Series
  //    'business', tag 'engine-spec' keeps them retrievable alongside the Big
  //    Picture master doc. Engine 01 (Observer) is the corpus itself; incoming.
  {
    title: 'Engine 02 — The Millennium Falcon (Product Intelligence, 16-Axis)',
    text: ENGINE_FALCON,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'The product-intelligence engine: 16 axes across three tiers (Material Ground → Observer Reading → Validation + Rupture), bilateral suppression as the load-bearing axis, the Emergence Principle, and the earned-collapse Rupture that fires last. The observer position made commercial — the Structural Analysis Engine\'s definitive spec.',
    source_url: 'corpus/engines/02-millennium-falcon.md',
  },
  {
    title: 'Engine 03 — The Grant Intelligence Engine',
    text: ENGINE_GRANT,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'Democratized strategic grant intelligence for under-resourced nonprofits: funder research, NECAI-F funder evaluation, fit analysis, proposal development, and the reasoning logs that become training data. Presents facts, does not decide.',
    source_url: 'corpus/engines/03-grant-intelligence.md',
  },
  {
    title: 'Engine 04 — The Education Intelligence Engine',
    text: ENGINE_EDUCATION,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'Every domain of knowledge run through the three-tier 14-axis system to produce structural understanding, not summaries — what each field knows, what it suppresses, and what the emergence principle says to study next. Alternative credentialing. Anyone, anywhere, any level.',
    source_url: 'corpus/engines/04-education-intelligence.md',
  },
  {
    title: 'Engine 05 — The Hospitality Intelligence Engine (Groundwork)',
    text: ENGINE_HOSPITALITY,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'The commercial hospitality platform (Groundwork / Hermannhof): unified guest intelligence, operational analytics, events, and staff development, optimized for human flourishing over engagement metrics. The Falcon applied to hospitality directions. Funds the Observer Foundation.',
    source_url: 'corpus/engines/05-hospitality-groundwork.md',
  },
  {
    title: 'Engine 06 — The Mental Health Intelligence Engine (Harmonizer)',
    text: ENGINE_HARMONIZER,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'The framework applied to the threshold: peer support intelligence (not therapy) for when the sponsor doesn\'t answer — holding the door open in the 48–72hr window. The Witness Engine\'s clinical-adjacent surface, built from recovery work. Grant-funded (SSG Fox, SAMHSA).',
    source_url: 'corpus/engines/06-harmonizer-mental-health.md',
  },
  {
    title: 'Engine 07 — The IP Intelligence Engine',
    text: ENGINE_IP,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'Patent analysis, prior-art search, IP strategy, and filing guidance for founders and independent inventors — the same under-resourced population the Grant engine serves. Two provisional patents filed March 18, 2026; utility filings due within 12 months.',
    source_url: 'corpus/engines/07-ip-intelligence.md',
  },
  {
    title: 'Engine 08 — The Plenum Engine (Unified AI, Six Capacities)',
    text: ENGINE_PLENUM,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'The unified AI architecture as a resonance field, not a pipeline: six simultaneous capacities (Velocity, Depth, Memory, Ground, Witness, Synthesis) whose interference resolves to output only when it reaches the NECAI-F ethical threshold — threshold-gated collapse. Divergence between capacities is the signal. WITNESS is the field boundary, not a filter.',
    source_url: 'corpus/engines/08-plenum.md',
  },
  {
    title: 'Engine 09 — The Convergence Layer (Engine of Engines)',
    text: ENGINE_CONVERGENCE,
    series: 'business',
    tag: 'engine-spec',
    abstract: 'The layer that holds every other engine in superposition and reads what they share beneath any single analysis — bilateral suppression applied to the whole architecture. Built at month 12, when there is enough engine output for the superposition to be real rather than performed.',
    source_url: 'corpus/engines/09-convergence.md',
  },
];
