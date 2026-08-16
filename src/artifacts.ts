// ============================================================
// ARTIFACTS — src/artifacts.ts
//
// The things a run LEAVES BEHIND. When Elle makes a picture (vfar generate,
// vfar resynth) or Flock renders brand media, the bytes land in R2 and the
// tool hands back a PATH — /vfar/<id>.jpg, /flock/asset/<id>.png. Until now
// that path only ever existed inside a tool observation, which means the one
// place it never reached was the answer: she made a picture and the person
// got a string.
//
// This module is the grammar of those paths, in one place. It mirrors EXACTLY
// what index.ts serves — same shapes, same id widths, same extensions — so a
// ref collected here is always a URL that resolves, and a path that could
// never be served is never offered as one. The router scans each observation
// through collectArtifacts and carries the result out on RouterResult, so a
// surface that can render an image renders it and one that can't still has
// the path.
//
// Deterministic and pure: no env, no I/O, no model. Just the grammar.
// ============================================================

export type ArtifactKind = 'image' | 'video';

export interface ArtifactRef {
  /** Worker-absolute path, exactly as served (e.g. /vfar/<32hex>.jpg). */
  path: string;
  kind: ArtifactKind;
  /** The tool whose observation produced it, when known — provenance. */
  tool?: string;
}

// One entry per public artifact route in index.ts. Each `source` is deliberately
// the SAME shape as the route's own 404 guard: if a path wouldn't be served, it
// isn't an artifact. Held as source STRINGS rather than literals so each use
// below can compile its own RegExp — anchored for the whole-string test, /g for
// the scan — with no lastIndex shared between calls.
const ROUTES: ReadonlyArray<{ source: string; kindFor: (ext: string) => ArtifactKind }> = [
  // index.ts: /^\/vfar\/[0-9a-f]{32}\.(png|jpg)$/
  { source: '\\/vfar\\/[0-9a-f]{32}\\.(png|jpg)', kindFor: () => 'image' },
  // index.ts: /^\/flock\/asset\/[0-9a-f]{32}\.(png|jpg|jpeg|mp4)$/
  { source: '\\/flock\\/asset\\/[0-9a-f]{32}\\.(png|jpg|jpeg|mp4)', kindFor: (ext) => (ext === 'mp4' ? 'video' : 'image') },
];

/** A run can't hand back an unbounded gallery — the cap is the whole run's. */
export const MAX_ARTIFACTS = 12;

/**
 * Scan arbitrary text (a tool observation, or her finished answer) for paths
 * that name a servable artifact. Order is preserved and duplicates within the
 * scan collapse — a describe→rip round trip names the same image three times.
 */
export function collectArtifacts(text: unknown, tool?: string): ArtifactRef[] {
  if (typeof text !== 'string' || !text) return [];
  const out: ArtifactRef[] = [];
  const seen = new Set<string>();
  for (const { source, kindFor } of ROUTES) {
    // `\b` after the extension so ".png" doesn't match inside ".pngx"; a fresh
    // RegExp per scan keeps matchAll's lastIndex strictly local.
    for (const m of text.matchAll(new RegExp(source + '\\b', 'g'))) {
      const path = m[0];
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, kind: kindFor(m[1].toLowerCase()), ...(tool ? { tool } : {}) });
    }
  }
  return out;
}

/**
 * Fold new refs into an accumulator, de-duplicated by path and capped. The
 * FIRST sighting wins its provenance: the tool that made the picture is more
 * informative than the one that later mentioned it. Mutates and returns `acc`
 * so the router's hot loop doesn't rebuild an array per step.
 */
export function addArtifacts(acc: ArtifactRef[], refs: ArtifactRef[]): ArtifactRef[] {
  for (const ref of refs) {
    if (acc.length >= MAX_ARTIFACTS) break;
    if (acc.some((a) => a.path === ref.path)) continue;
    acc.push(ref);
  }
  return acc;
}

/** True when the path is one this worker will actually serve — whole string. */
export function isArtifactPath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  return ROUTES.some(({ source }) => new RegExp(`^${source}$`).test(path));
}
