// ============================================================
// ELLE — CORPUS LINEAGE BACKFILL · src/corpus-lineage.ts
//
// The graph memory kernel (graph.ts) already defines a `supersedes` edge kind
// ("B replaces A — follow to the newest") but nothing has ever populated it.
// Meanwhile the corpus holds real version chains — manuscript drafts ingested
// as separate, undeduplicated rows: "0010_TheSuperposition_v2",
// "0015_TheSuperposition v3", "0029_TheSuperposition_v4", etc. — because the
// bulk/trusted ingest path that brought them in skips the near-duplicate gate
// entirely (see ingest-gate.ts). Right now those sit as unlinked clones; a
// reader (or Elle) has no way to know v4 is the one to trust.
//
// This is a one-shot, idempotent activation pass: parse the version number out
// of every corpus_papers title, group by normalized base title, and link each
// consecutive pair with a `supersedes` edge (older -> newer) via the existing
// GraphStore. No re-ingestion, no re-embedding — corpus_papers rows and their
// Vectorize embeddings are untouched; this only adds edges over IDs that
// already exist. Edges use corpus_papers.id directly as node identifiers:
// elle_memory_edges has no FK to elle_memory specifically (graph.ts treats
// src/dst as opaque IDs), so a paper's own id is a valid, stable endpoint even
// though papers don't get an elle_memory row of their own (only a same-titled
// "reading" memory does, unlinked by any id column — see index.ts's
// paper_ingested queue consumer).
//
// Safe to re-run: link() upserts with ON CONFLICT(src,dst,kind), so a repeat
// pass (e.g. after ingesting more drafts) only reinforces or adds new edges,
// never duplicates them. Trigger via POST /api/cron { job:
// "corpus_lineage_backfill" } (admin-gated, same surface as optimus_backfill).
// ============================================================

import type { Env } from './index';
import { CloudGraphStore } from './graph';

export interface VersionedTitle { id: string; base: string; version: number; title: string }

// Strip a leading ingest-order prefix ("0005_"), then pull a trailing version
// marker ("v2", "_v3", " v4", with an optional "Foundation" token before it —
// "TheThreshold Foundation v1" is still version 1 of "thethreshold"). Returns
// null for titles with no parseable version (most of the corpus — this is
// deliberately conservative rather than guessing).
export function parseVersionedTitle(rawTitle: string): { base: string; version: number } | null {
  const stripped = (rawTitle || '').replace(/^\d+_/, '');
  const m = stripped.match(/^(.+?)[\s_]+(?:Foundation[\s_]+)?v(\d+)\s*$/i);
  if (!m) return null;
  const base = m[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const version = parseInt(m[2], 10);
  if (!base || !Number.isFinite(version) || version <= 0) return null;
  return { base, version };
}

export function groupVersionFamilies(rows: Array<{ id: string; title: string }>): Map<string, VersionedTitle[]> {
  const families = new Map<string, VersionedTitle[]>();
  for (const r of rows) {
    const parsed = parseVersionedTitle(r.title);
    if (!parsed) continue;
    const list = families.get(parsed.base) || [];
    list.push({ id: r.id, base: parsed.base, version: parsed.version, title: r.title });
    families.set(parsed.base, list);
  }
  // Singletons (only one version found) have nothing to chain — drop them.
  for (const [base, list] of families) if (list.length < 2) families.delete(base);
  return families;
}

export async function runCorpusLineageBackfill(
  env: Env,
): Promise<{ families: number; papers: number; edges: number; samples: string[] }> {
  const rows = await env.DB.prepare('SELECT id, title FROM corpus_papers').all()
    .catch(() => ({ results: [] as Array<{ id: string; title: string }> }));
  const families = groupVersionFamilies((rows.results || []) as Array<{ id: string; title: string }>);

  const store = new CloudGraphStore(env.DB);
  await store.ensureSchema();

  let edgeCount = 0;
  let paperCount = 0;
  const samples: string[] = [];
  const edges: Array<{ src: string; dst: string; kind: 'supersedes' }> = [];

  for (const [base, versions] of families) {
    versions.sort((a, b) => a.version - b.version);
    paperCount += versions.length;
    for (let i = 0; i < versions.length - 1; i++) {
      edges.push({ src: versions[i].id, dst: versions[i + 1].id, kind: 'supersedes' });
      edgeCount++;
    }
    if (samples.length < 10) {
      samples.push(`${base} — v${versions[0].version}..v${versions[versions.length - 1].version} (${versions.length} drafts)`);
    }
  }

  // D1 .batch() caps request size; link() itself batches internally per call,
  // so chunk the edge list to stay well under that ceiling.
  for (let i = 0; i < edges.length; i += 50) await store.link(edges.slice(i, i + 50));

  console.log(`[LINEAGE] backfill: ${edgeCount} supersedes edges across ${families.size} version families (${paperCount} papers)`);
  return { families: families.size, papers: paperCount, edges: edgeCount, samples };
}
