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
// ============================================================

import LAWS_48 from '../corpus/law/48-laws-taxonomy.md';
import ART_OF_WAR from '../corpus/law/art-of-war-tagging.md';
import SILENT_WARFARE from '../corpus/madmind/silent-warfare.md';

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
];
