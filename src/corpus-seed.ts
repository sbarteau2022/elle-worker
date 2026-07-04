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
// ============================================================

import LAWS_48 from '../corpus/law/48-laws-taxonomy.md';
import ART_OF_WAR from '../corpus/law/art-of-war-tagging.md';
import SILENT_WARFARE from '../corpus/madmind/silent-warfare.md';
import GRANT_STRATEGY_MAP from '../corpus/business/grant-strategy-map.md';
import BIG_PICTURE_ARCHITECTURE from '../corpus/business/big-picture-architecture.md';

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
];
