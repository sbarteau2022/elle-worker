import { describe, it, expect } from 'vitest';
import {
  SECURITY_DECK, tacticsFor, postureFor, actionFor, decayedScore, nextScore,
  scanBuffer, sha256Hex,
} from './security-network';

describe('SECURITY_DECK — taxonomy integrity', () => {
  it('every tactic has a unique id and mirrors the 48L/AOW doctrine', () => {
    const ids = SECURITY_DECK.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of SECURITY_DECK) {
      expect(['48L', 'AOW']).toContain(t.src);
      expect(t.counter.length).toBeGreaterThan(10);
    }
  });
  it('own-move tactics carry zero weight — they never accrue attacker score', () => {
    for (const t of SECURITY_DECK) if (t.ownMove) expect(t.weight).toBe(0);
  });
});

describe('tacticsFor — signal classification', () => {
  it('maps a known signal kind to its tactic(s)', () => {
    const ts = tacticsFor('auth.bad_credentials');
    expect(ts.map(t => t.id)).toContain('thumbscrew');
  });
  it('maps SSRF blocks to the "make others come to you" tactic', () => {
    expect(tacticsFor('ssrf.blocked').map(t => t.id)).toContain('come_to_you');
  });
  it('returns nothing for an unknown signal — fail-open, not fail-crash', () => {
    expect(tacticsFor('totally.unknown.kind')).toEqual([]);
  });
});

describe('decayedScore / postureFor / actionFor — escalation ladder', () => {
  it('decays one point per hour and never goes negative', () => {
    expect(decayedScore(10, 3_600_000)).toBe(9);
    expect(decayedScore(2, 10 * 3_600_000)).toBe(0);
    expect(decayedScore(0, 3_600_000)).toBe(0);
  });
  it('escalates normal → watch → throttled → blocked as score rises', () => {
    expect(postureFor(0)).toBe('normal');
    expect(postureFor(2)).toBe('watch');
    expect(postureFor(6)).toBe('throttled');
    expect(postureFor(12)).toBe('blocked');
  });
  it('maps posture to the operational action', () => {
    expect(actionFor('normal')).toBe('allow');
    expect(actionFor('watch')).toBe('challenge');
    expect(actionFor('throttled')).toBe('throttle');
    expect(actionFor('blocked')).toBe('block');
  });
  it('nextScore combines decay of the old score with the new hit weight', () => {
    const now = 1_000_000;
    const prevAt = now - 2 * 3_600_000; // 2 hours ago
    expect(nextScore(5, prevAt, now, 3)).toBe(6); // 5 - 2 decay + 3
  });
  it('repeated formlessness hits (weight 4) escalate an actor to blocked within a few hits', () => {
    let score = 0, at = 0;
    for (let i = 0; i < 3; i++) { score = nextScore(score, at, at, 4); }
    expect(postureFor(score)).toBe('blocked');
  });
});

describe('scanBuffer — malware/polyglot heuristics', () => {
  it('flags a PE header hidden inside a file named like an image as critical', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const fs = scanBuffer(bytes, 'vacation-photo.png');
    expect(fs.some(f => f.kind === 'polyglot.exe.pe' && f.severity === 'critical')).toBe(true);
  });
  it('flags an ELF header with no executable extension as high, not critical', () => {
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02]);
    const fs = scanBuffer(bytes, 'data-file');
    expect(fs.some(f => f.kind === 'exe.elf' && f.severity === 'high')).toBe(true);
  });
  it('does not flag a real ELF binary named with an executable extension', () => {
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02]);
    const fs = scanBuffer(bytes, 'tool.bin');
    expect(fs.length).toBe(0);
  });
  it('flags embedded script markers inside a document-typed file', () => {
    const text = '%PDF-ish header stuff <script>evil()</script>';
    const bytes = new TextEncoder().encode(text);
    const fs = scanBuffer(bytes, 'report.pdf');
    expect(fs.some(f => f.kind === 'polyglot.embedded-script')).toBe(true);
  });
  it('leaves an ordinary text file alone', () => {
    const bytes = new TextEncoder().encode('just some notes, nothing executable here');
    expect(scanBuffer(bytes, 'notes.txt')).toEqual([]);
  });
});

describe('sha256Hex', () => {
  it('hashes deterministically', async () => {
    const bytes = new TextEncoder().encode('hello');
    const h1 = await sha256Hex(bytes);
    const h2 = await sha256Hex(bytes);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
