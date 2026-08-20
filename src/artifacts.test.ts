import { describe, it, expect } from 'vitest';
import { collectArtifacts, addArtifacts, isArtifactPath, isIntakePath, MAX_ARTIFACTS } from './artifacts';

// A real vfar generate observation, verbatim in shape (vfar.ts).
const GEN = JSON.stringify({ mode: 'generate', stored: '/vfar/0123456789abcdef0123456789abcdef.jpg', bytes: 91234, prompt: 'a heron over slack water' });
const RESYNTH = JSON.stringify({ mode: 'resynth', stored: '/vfar/ffffffffffffffffffffffffffffffff.png', bytes: 2048, note: 'deterministic resynthesis' });
const DESCRIBE = JSON.stringify({ mode: 'describe', image: '/vfar/0123456789abcdef0123456789abcdef.jpg', description: 'a wading bird' });

describe('collectArtifacts', () => {
  it('pulls the stored path out of a vfar generate observation', () => {
    expect(collectArtifacts(GEN, 'vfar')).toEqual([
      { path: '/vfar/0123456789abcdef0123456789abcdef.jpg', kind: 'image', tool: 'vfar' },
    ]);
  });

  it('reads a resynth png and omits the tool when none is given', () => {
    expect(collectArtifacts(RESYNTH)).toEqual([
      { path: '/vfar/ffffffffffffffffffffffffffffffff.png', kind: 'image' },
    ]);
  });

  it('classifies flock video as video and flock stills as image', () => {
    const obs = JSON.stringify({
      assets: [
        { url: '/flock/asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' },
        { url: '/flock/asset/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4' },
        { url: '/flock/asset/cccccccccccccccccccccccccccccccc.jpeg' },
      ],
    });
    // .jpeg must survive the png|jpg|jpeg alternation intact — a greedy 'jpg'
    // match would strip the trailing 'e' and yield a path that 404s.
    expect(collectArtifacts(obs, 'flock').map((a) => [a.path.slice(-5), a.kind])).toEqual([
      ['a.png', 'image'],
      ['b.mp4', 'video'],
      ['.jpeg', 'image'],
    ]);
  });

  it('collapses a path named several times in one observation', () => {
    const twice = DESCRIBE + ' ' + DESCRIBE;
    expect(collectArtifacts(twice, 'vfar')).toHaveLength(1);
  });

  it('ignores paths the worker would 404 — wrong id width, wrong extension, wrong route', () => {
    const junk = [
      '/vfar/tooshort.jpg',
      '/vfar/0123456789abcdef0123456789abcdefAB.jpg',   // 32 hex then stray chars
      '/vfar/0123456789abcdef0123456789abcdef.gif',
      '/vfar/0123456789abcdef0123456789abcdef.pngx',    // \b guard
      '/hyper/0123456789abcdef0123456789abcdef.json',   // real route, not an artifact
      '/flock/0123456789abcdef0123456789abcdef.png',    // missing /asset/
      '/etc/passwd',
    ].join('\n');
    expect(collectArtifacts(junk)).toEqual([]);
  });

  it('does not treat a 32-hex id with uppercase as servable (the route is lowercase)', () => {
    expect(collectArtifacts('/vfar/0123456789ABCDEF0123456789ABCDEF.jpg')).toEqual([]);
  });

  it('is inert on non-strings and empty input', () => {
    expect(collectArtifacts(null)).toEqual([]);
    expect(collectArtifacts(undefined)).toEqual([]);
    expect(collectArtifacts({ path: '/vfar/0123456789abcdef0123456789abcdef.jpg' })).toEqual([]);
    expect(collectArtifacts('')).toEqual([]);
  });

  it('finds a bare path in prose, not just in JSON', () => {
    const prose = 'Here it is: /vfar/0123456789abcdef0123456789abcdef.png — the fingerprint made visible.';
    expect(collectArtifacts(prose)).toHaveLength(1);
  });

  it('holds no lastIndex state between scans', () => {
    const first = collectArtifacts(GEN, 'vfar');
    const second = collectArtifacts(GEN, 'vfar');
    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
  });
});

describe('addArtifacts', () => {
  it('de-duplicates across steps and keeps the FIRST provenance', () => {
    const acc = addArtifacts([], collectArtifacts(GEN, 'vfar'));
    addArtifacts(acc, collectArtifacts(DESCRIBE, 'page_read'));
    expect(acc).toEqual([
      { path: '/vfar/0123456789abcdef0123456789abcdef.jpg', kind: 'image', tool: 'vfar' },
    ]);
  });

  it('accumulates distinct artifacts in sighting order', () => {
    const acc = addArtifacts([], collectArtifacts(GEN, 'vfar'));
    addArtifacts(acc, collectArtifacts(RESYNTH, 'vfar'));
    expect(acc.map((a) => a.path)).toEqual([
      '/vfar/0123456789abcdef0123456789abcdef.jpg',
      '/vfar/ffffffffffffffffffffffffffffffff.png',
    ]);
  });

  it('caps the run so a gallery-producing loop cannot flood the answer', () => {
    const acc: ReturnType<typeof collectArtifacts> = [];
    for (let i = 0; i < MAX_ARTIFACTS + 5; i++) {
      const id = i.toString(16).padStart(32, '0');
      addArtifacts(acc, collectArtifacts(`/vfar/${id}.png`, 'vfar'));
    }
    expect(acc).toHaveLength(MAX_ARTIFACTS);
  });
});

describe('isArtifactPath', () => {
  it('accepts exactly what index.ts serves', () => {
    expect(isArtifactPath('/vfar/0123456789abcdef0123456789abcdef.jpg')).toBe(true);
    expect(isArtifactPath('/flock/asset/0123456789abcdef0123456789abcdef.mp4')).toBe(true);
  });

  it('rejects a servable path with anything appended — no partial match', () => {
    expect(isArtifactPath('/vfar/0123456789abcdef0123456789abcdef.jpg?x=1')).toBe(false);
    expect(isArtifactPath('  /vfar/0123456789abcdef0123456789abcdef.jpg')).toBe(false);
    expect(isArtifactPath('https://evil.example/vfar/0123456789abcdef0123456789abcdef.jpg')).toBe(false);
    expect(isArtifactPath(42)).toBe(false);
  });
});

// ============================================================
// CROSS-BUNDLE CONFORMANCE.
//
// This grammar lives in three separately-deployed bundles: here, the
// workbench (Elle/src/lib/artifacts.ts) and the phone
// (Elle/mobile/src/lib/artifacts.ts). They cannot share code — the clients
// bundle separately and Metro is rooted at mobile/ — and they cannot even be
// byte-identical, because this copy needs CAPTURING groups to tell an image
// from a video while the clients use non-capturing ones.
//
// So the contract is pinned by BEHAVIOR instead, over one fixture table that
// is duplicated verbatim into the other two test files. If a route is added
// or a shape changes in one bundle and not the others, whichever bundle was
// left behind fails here — instead of silently rendering a broken image, or
// silently declining to render a real one.
// ============================================================
const CONFORMANCE: Array<[string, boolean]> = [
  ['/vfar/0123456789abcdef0123456789abcdef.jpg', true],
  ['/vfar/ffffffffffffffffffffffffffffffff.png', true],
  ['/flock/asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4', true],
  ['/flock/asset/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg', true],
  ['/vfar/tooshort.jpg', false],
  ['/vfar/0123456789ABCDEF0123456789ABCDEF.jpg', false],   // route is lowercase
  ['/vfar/0123456789abcdef0123456789abcdef.gif', false],
  ['/vfar/0123456789abcdef0123456789abcdef.pngx', false],
  ['/hyper/0123456789abcdef0123456789abcdef.json', false],
  ['/flock/0123456789abcdef0123456789abcdef.png', false],  // missing /asset/
  ['/vfar/0123456789abcdef0123456789abcdef.jpg?x=1', false],
  [' /vfar/0123456789abcdef0123456789abcdef.jpg', false],
  ['https://evil.example/vfar/0123456789abcdef0123456789abcdef.jpg', false],
  ['/etc/passwd', false],
  ['', false],
];

describe('cross-bundle conformance', () => {
  it.each(CONFORMANCE)('isArtifactPath(%j) === %s in every bundle', (path, expected) => {
    expect(isArtifactPath(path)).toBe(expected);
  });
});

// ============================================================
// INTAKE — the private half. An uploaded image is the USER'S content, so it
// is stored where her instruments can read it and NOWHERE a client can render
// it from prose. The two properties below are the whole security argument.
// ============================================================
const INTAKE = '/intake/0123456789abcdef0123456789abcdef.png';

describe('intake paths', () => {
  it('accepts the shapes the upload store writes', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
      expect(isIntakePath(`/intake/0123456789abcdef0123456789abcdef.${ext}`), ext).toBe(true);
    }
  });

  it('holds the same whole-string discipline as the public routes', () => {
    for (const bad of [
      '/intake/short.png',
      '/intake/0123456789ABCDEF0123456789ABCDEF.png',
      '/intake/0123456789abcdef0123456789abcdef.svg',   // no SVG: it is script
      '/intake/0123456789abcdef0123456789abcdef.png?x=1',
      ' /intake/0123456789abcdef0123456789abcdef.png',
      'https://evil.example/intake/0123456789abcdef0123456789abcdef.png',
      '/intake/../vfar/0123456789abcdef0123456789abcdef.png',
      42, null, undefined, '',
    ]) expect(isIntakePath(bad as unknown), String(bad)).toBe(false);
  });

  // THE LOAD-BEARING ONE. If an intake path were ever collectable, it would
  // ride out on RouterResult.artifacts and a client would render it as a plain
  // <img> against a route that requires auth — turning a private upload into a
  // broken image at best, and inviting someone to make the route public at
  // worst. It must never be picked up by the scan.
  it('is NEVER collected as a renderable artifact', () => {
    expect(collectArtifacts(INTAKE)).toEqual([]);
    expect(collectArtifacts(JSON.stringify({ stored: INTAKE, mode: 'upload' }), 'upload')).toEqual([]);
    expect(collectArtifacts(`I looked at ${INTAKE} and here is what I saw.`)).toEqual([]);
    expect(isArtifactPath(INTAKE)).toBe(false);
  });

  it('does not confuse the two stores in either direction', () => {
    expect(isIntakePath('/vfar/0123456789abcdef0123456789abcdef.jpg')).toBe(false);
    expect(isIntakePath('/flock/asset/0123456789abcdef0123456789abcdef.png')).toBe(false);
  });

  // A run that made a real artifact AND read an upload reports only the artifact.
  it('leaves the public artifacts of a mixed run untouched', () => {
    const obs = JSON.stringify({ mode: 'describe', image: INTAKE, then_made: '/vfar/ffffffffffffffffffffffffffffffff.png' });
    expect(collectArtifacts(obs, 'vfar')).toEqual([
      { path: '/vfar/ffffffffffffffffffffffffffffffff.png', kind: 'image', tool: 'vfar' },
    ]);
  });
});
