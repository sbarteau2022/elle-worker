// VENDORED from CustomCourseBuilder src/runtime/state.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * Learner state — everything the runtime knows about one learner in one
 * course. Persisted as JSON (see store.ts); every mutation flows through
 * the engine so the witness spine sees it.
 */
import type { AdaptationSignal } from "./course-types.ts";

export type PillarKey = "structure" | "readingReasoning" | "testing" | "building";

export const PILLAR_KEYS: PillarKey[] = ["structure", "readingReasoning", "testing", "building"];

/** One logged working session on one unit. The raw material of witnessing. */
export interface SessionRecord {
  unitId: string;
  /** ISO timestamp of the session. */
  at: string;
  minutes: number;
  note?: string;
  /**
   * Present when the learner reports being stuck. The text matters: the
   * engine compares consecutive blockers to tell a learner who is stuck
   * on the same wall (struggle-blocked) from one moving through
   * different hard things (struggle-productive).
   */
  blocker?: string;
  /** Pillar evidence produced this session: what was made, where it lives. */
  evidence?: { pillar: PillarKey; artifact: string }[];
}

export type UnitStatus = "not-started" | "in-progress" | "complete";

export interface UnitProgress {
  unitId: string;
  status: UnitStatus;
  startedAt?: string;
  completedAt?: string;
  /** Accumulated artifacts per pillar. A unit completes only when all four are non-empty. */
  pillarEvidence: Record<PillarKey, string[]>;
}

export type ReadingKind = "weekly" | "unit-close" | "phase-synthesis" | "build-retro";

/**
 * A sealed observer reading. Sealed means tamper-evident: each reading's
 * hash covers its content plus the previous reading's hash, forming a
 * chain — edit any past reading and every hash after it breaks.
 */
export interface SealedReading {
  seq: number;
  at: string;
  kind: ReadingKind;
  unitId?: string;
  phaseId?: string;
  tier1MaterialGround: string;
  tier2ObserverReading: string;
  tier3SitWithThis: string;
  prevHash: string;
  hash: string;
}

export type AdaptationMove = "accelerate" | "reinforce" | "reroute";

/** One witness-spine entry: a signal seen, and what was done about it. */
export interface AdaptationEntry {
  at: string;
  unitId: string;
  signal: AdaptationSignal;
  /**
   * Move executed per the unit's contract, or null when the signal was
   * observed but is not in the unit's watchFor list (logged anyway —
   * Elle watching herself watch is the point of the witness spine).
   */
  move: AdaptationMove | null;
  /** The contract's instruction text for the move, verbatim. */
  instruction: string | null;
  /** Why the engine believes the signal fired — human-readable evidence. */
  evidence: string;
}

export interface LearnerState {
  learnerId: string;
  courseId: string;
  courseVersion: string;
  enrolledAt: string;
  sessions: SessionRecord[];
  units: Record<string, UnitProgress>;
  sealedReadings: SealedReading[];
  adaptationLog: AdaptationEntry[];
}

export function newLearnerState(
  learnerId: string,
  courseId: string,
  courseVersion: string,
  now: Date,
): LearnerState {
  return {
    learnerId,
    courseId,
    courseVersion,
    enrolledAt: now.toISOString(),
    sessions: [],
    units: {},
    sealedReadings: [],
    adaptationLog: [],
  };
}

export function emptyProgress(unitId: string): UnitProgress {
  return {
    unitId,
    status: "not-started",
    pillarEvidence: { structure: [], readingReasoning: [], testing: [], building: [] },
  };
}
