import { describe, it, expect } from 'vitest';
import { toolAllowed } from '../router';
import type { Course } from './course-types.ts';
import { newLearnerState, type SessionRecord } from './state.ts';
import { sealReading, verifyChain } from './seal.ts';
import { availableUnits, completeUnit, recordSession, unitById } from './engine.ts';
import { detectSignals } from './signals.ts';
import { sessionBrief } from './brief.ts';
import aiEngineerStackJson from './courses/ai-engineer-stack.json';
import aiEngineerCurriculumJson from './courses/ai-engineer-curriculum.json';

// The vendored engine running against the REAL bundled course artifact —
// the same object the worker serves. If the JSON drifts out of shape with
// the engine (a bad re-sync), these fail before deploy does.
const course = aiEngineerStackJson as unknown as Course;

const T0 = new Date('2026-08-01T09:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const LONG = 'A deliberately long tier reading with enough substance to clear the minimum sealing threshold.';

function fresh() {
  return newLearnerState('u1', course.id, course.version, T0);
}
function session(unitId: string, d: number, minutes: number, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { unitId, at: day(d).toISOString(), minutes, ...extra };
}

describe('bundled course artifact', () => {
  it('is the ai-engineer-stack with 21 units, 4 phases, and contracts everywhere', () => {
    expect(course.id).toBe('ai-engineer-stack');
    expect(course.units.length).toBe(21);
    expect(course.phases.length).toBe(4);
    for (const u of course.units) {
      expect(u.adaptation.watchFor.length, u.id).toBeGreaterThan(0);
      expect(u.tiers.observerReading.length, u.id).toBeGreaterThan(40);
    }
  });

  it('schedules month 1 with the no-prereq phase-1 units', () => {
    const ids = availableUnits(course, fresh(), day(3)).map(u => u.id);
    expect(ids).toContain('a1-python-automation');
    expect(ids).not.toContain('b2-ml-specialization'); // prereq b1 not started
    expect(ids).not.toContain('a2-meta-backend'); // phase window closed
  });
});

describe('contract execution', () => {
  it('three sessions on the same wall → the unit’s own reroute instruction in the brief', () => {
    const state = fresh();
    for (const d of [1, 3, 5]) {
      recordSession(course, state, session('a1-python-automation', d, 60, { blocker: 'KeyError looping over dict keys' }));
    }
    const brief = sessionBrief(course, state, day(6));
    const unit = unitById(course, 'a1-python-automation');
    expect(brief.markdown).toContain('Contract move: REROUTE');
    expect(brief.markdown).toContain(unit.adaptation.moves.reroute);
    expect(state.adaptationLog.some(e => e.signal === 'struggle-blocked' && e.move === 'reroute')).toBe(true);
  });

  it('different walls with evidence landing read as struggle-productive', () => {
    const state = fresh();
    recordSession(course, state, session('a1-python-automation', 1, 60, { blocker: 'git merge conflicts during rebase' }));
    recordSession(course, state, session('a1-python-automation', 3, 60, { blocker: 'regex lookahead syntax confusing' }));
    recordSession(course, state, session('a1-python-automation', 5, 60, {
      blocker: 'virtualenv path issues on startup',
      evidence: [{ pillar: 'structure', artifact: 'program anatomy diagram' }],
    }));
    const signals = detectSignals(unitById(course, 'a1-python-automation'), state.units['a1-python-automation']!, state.sessions, day(6));
    expect(signals.some(s => s.signal === 'struggle-productive')).toBe(true);
    expect(signals.some(s => s.signal === 'struggle-blocked')).toBe(false);
  });
});

describe('the completion gate', () => {
  it('refuses without full pillars + a sealed unit-close reading, then admits', () => {
    const state = fresh();
    recordSession(course, state, session('b1-ai-for-everyone', 1, 120, {
      evidence: [{ pillar: 'structure', artifact: 'map' }],
    }));
    const refused = completeUnit(course, state, 'b1-ai-for-everyone', day(20));
    expect(refused.completed).toBe(false);
    expect(state.adaptationLog.some(e => e.signal === 'shallow-completion')).toBe(true);

    recordSession(course, state, session('b1-ai-for-everyone', 21, 120, {
      evidence: [
        { pillar: 'readingReasoning', artifact: 'claims analysis' },
        { pillar: 'testing', artifact: 'vocabulary test log' },
        { pillar: 'building', artifact: 'project landscape map' },
      ],
    }));
    sealReading(state, {
      kind: 'unit-close', unitId: 'b1-ai-for-everyone',
      tier1MaterialGround: LONG, tier2ObserverReading: LONG, tier3SitWithThis: LONG,
    }, day(22));
    expect(completeUnit(course, state, 'b1-ai-for-everyone', day(23)).completed).toBe(true);
  });
});

describe('the sealed chain', () => {
  it('verifies intact and breaks forever on tampering', () => {
    const state = fresh();
    for (let i = 0; i < 3; i++) {
      sealReading(state, { kind: 'weekly', tier1MaterialGround: LONG + i, tier2ObserverReading: LONG, tier3SitWithThis: LONG }, day(7 * (i + 1)));
    }
    expect(verifyChain(state.sealedReadings)).toEqual([]);
    state.sealedReadings[1]!.tier3SitWithThis = 'rewritten history';
    expect(verifyChain(state.sealedReadings).length).toBeGreaterThan(0);
  });

  it('refuses thin readings', () => {
    const state = fresh();
    expect(() => sealReading(state, { kind: 'weekly', tier1MaterialGround: 'thin', tier2ObserverReading: LONG, tier3SitWithThis: LONG }, T0))
      .toThrow(/refusing to seal/);
  });
});

describe('scope', () => {
  const EDU = ['edu_enroll', 'edu_brief', 'edu_log', 'edu_seal', 'edu_complete', 'edu_status'];
  it('members and full scope run course sessions; public and hospitality never see them', () => {
    for (const t of EDU) {
      expect(toolAllowed('member', t), t).toBe(true);
      expect(toolAllowed('full', t), t).toBe(true);
      expect(toolAllowed('public', t), t).toBe(false);
      expect(toolAllowed('hospitality', t), t).toBe(false);
    }
  });
});

describe('ai-engineer-curriculum — the first-party, ours-to-teach course', () => {
  const curriculumCourse = aiEngineerCurriculumJson as unknown as Course;

  it('is real, generated content covering the foundation tier, with contracts everywhere', () => {
    expect(curriculumCourse.id).toBe('ai-engineer-curriculum');
    expect(curriculumCourse.units.length).toBe(39); // 6 foundation courses' worth of module packets
    for (const u of curriculumCourse.units) {
      expect(u.adaptation.watchFor.length, u.id).toBeGreaterThan(0);
      expect(u.tiers.observerReading.length, u.id).toBeGreaterThan(40);
      // pacing text is EXTRACTED from that module's own authored materials,
      // not boilerplate — every unit's moves must be non-generic per-unit text.
      expect(u.adaptation.moves.reroute.length, u.id).toBeGreaterThan(20);
    }
  });

  it('schedules the front-door unit first with no prerequisites', () => {
    const state = newLearnerState('u2', curriculumCourse.id, curriculumCourse.version, T0);
    const avail = availableUnits(curriculumCourse, state, day(1)).map((u) => u.id);
    expect(avail).toContain('AIE-100-M01');
  });

  it('runs the same engine end to end: log, brief, seal, gate', () => {
    const state = newLearnerState('u3', curriculumCourse.id, curriculumCourse.version, T0);
    recordSession(curriculumCourse, state, {
      unitId: 'AIE-100-M01',
      at: day(1).toISOString(),
      minutes: 45,
      evidence: [{ pillar: 'structure', artifact: 'drew the pointer model' }],
    });
    const brief = sessionBrief(curriculumCourse, state, day(2));
    expect(brief.markdown).toContain('AIE-100-M01');
    const refused = completeUnit(curriculumCourse, state, 'AIE-100-M01', day(3));
    expect(refused.completed).toBe(false); // only one of four pillars evidenced
  });
});
