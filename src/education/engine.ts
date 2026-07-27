// VENDORED from CustomCourseBuilder src/runtime/engine.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * The engine — executes adaptation contracts.
 *
 * Everything here is a pure-ish function over (course, state, now):
 * mutations happen only on the passed state object, time always arrives
 * as an argument, and every decision is written to the adaptation log.
 * The witness spine is not a feature of the engine; it is the engine.
 */
import type { AdaptationSignal, Course, Phase, Unit } from "./course-types.ts";
import type {
  AdaptationEntry,
  AdaptationMove,
  LearnerState,
  SessionRecord,
  UnitProgress,
} from "./state.ts";
import { emptyProgress } from "./state.ts";
import { detectSignals, detectShallowCompletion, evidenceFraction } from "./signals.ts";

const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000;

/** The schema's documented signal → move mapping, made executable. */
export const SIGNAL_MOVE: Record<AdaptationSignal, AdaptationMove> = {
  "mastery-early": "accelerate",
  "pace-ahead": "accelerate",
  "struggle-productive": "reinforce",
  "pace-behind": "reinforce",
  "shallow-completion": "reinforce",
  "struggle-blocked": "reroute",
  disengagement: "reroute",
};

/** When several signals fire at once, the most urgent one drives the move. */
const SIGNAL_PRIORITY: AdaptationSignal[] = [
  "struggle-blocked",
  "disengagement",
  "pace-behind",
  "struggle-productive",
  "shallow-completion",
  "mastery-early",
  "pace-ahead",
];

export function unitById(course: Course, unitId: string): Unit {
  const unit = course.units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`unknown unit: ${unitId}`);
  return unit;
}

export function currentMonth(state: LearnerState, now: Date): number {
  const elapsed = now.getTime() - new Date(state.enrolledAt).getTime();
  return Math.min(Math.max(1, Math.floor(elapsed / MS_PER_MONTH) + 1), 120);
}

export function phaseForMonth(course: Course, month: number): Phase {
  const found = course.phases.find((p) => month >= p.months[0] && month <= p.months[1]);
  return found ?? (course.phases.at(-1) as Phase);
}

export function progressFor(state: LearnerState, unitId: string): UnitProgress {
  let p = state.units[unitId];
  if (!p) {
    p = emptyProgress(unitId);
    state.units[unitId] = p;
  }
  return p;
}

function prereqsSatisfied(course: Course, state: LearnerState, unit: Unit): boolean {
  // Per the schema: prerequisites should be complete or at least in progress.
  return unit.prerequisites.every((id) => {
    const status = state.units[id]?.status;
    return status === "complete" || status === "in-progress";
  });
}

/** Units whose phase window has opened, prereqs allow, and are not done. */
export function availableUnits(course: Course, state: LearnerState, now: Date): Unit[] {
  const month = currentMonth(state, now);
  return course.units.filter((unit) => {
    const phase = course.phases.find((p) => p.unitIds.includes(unit.id));
    if (!phase) return false;
    if (month < phase.months[0]) return false;
    const status = state.units[unit.id]?.status ?? "not-started";
    if (status === "complete") return false;
    return prereqsSatisfied(course, state, unit);
  });
}

/** Record a working session. Starts the unit on first contact. */
export function recordSession(course: Course, state: LearnerState, record: SessionRecord): UnitProgress {
  const unit = unitById(course, record.unitId);
  const progress = progressFor(state, unit.id);
  if (progress.status === "complete") {
    throw new Error(`unit ${unit.id} is already complete; log follow-on work under a later unit`);
  }
  if (progress.status === "not-started") {
    progress.status = "in-progress";
    progress.startedAt = record.at;
  }
  for (const ev of record.evidence ?? []) {
    progress.pillarEvidence[ev.pillar].push(ev.artifact);
  }
  state.sessions.push(record);
  return progress;
}

export interface UnitAdvice {
  unitId: string;
  title: string;
  signals: { signal: AdaptationSignal; evidence: string; watched: boolean }[];
  decision: { move: AdaptationMove; signal: AdaptationSignal; instruction: string } | null;
}

export interface Advice {
  at: string;
  month: number;
  phase: { id: string; title: string };
  units: UnitAdvice[];
  corpus: { sealed: number; target: number; chainIntact: boolean };
}

/**
 * The core loop: detect signals on every in-progress unit, execute the
 * unit's contract for the highest-priority watched signal, and append
 * everything — acted on or merely observed — to the witness log.
 */
export function advise(
  course: Course,
  state: LearnerState,
  now: Date,
  chainIntact: boolean,
): Advice {
  const month = currentMonth(state, now);
  const phase = phaseForMonth(course, month);
  const units: UnitAdvice[] = [];

  for (const unit of course.units) {
    const progress = state.units[unit.id];
    if (!progress || progress.status !== "in-progress") continue;
    const sessions = state.sessions
      .filter((s) => s.unitId === unit.id)
      .sort((a, b) => a.at.localeCompare(b.at));
    const detected = detectSignals(unit, progress, sessions, now);
    if (detected.length === 0) {
      units.push({ unitId: unit.id, title: unit.title, signals: [], decision: null });
      continue;
    }

    const annotated = detected.map((d) => ({
      ...d,
      watched: unit.adaptation.watchFor.includes(d.signal),
    }));
    const primary = SIGNAL_PRIORITY.map((sig) =>
      annotated.find((d) => d.signal === sig && d.watched),
    ).find((d) => d !== undefined);

    let decision: UnitAdvice["decision"] = null;
    if (primary) {
      const move = SIGNAL_MOVE[primary.signal];
      decision = { move, signal: primary.signal, instruction: unit.adaptation.moves[move] };
    }

    for (const d of annotated) {
      const acted = d === primary;
      const entry: AdaptationEntry = {
        at: now.toISOString(),
        unitId: unit.id,
        signal: d.signal,
        move: acted && decision ? decision.move : null,
        instruction: acted && decision ? decision.instruction : null,
        evidence: d.evidence,
      };
      state.adaptationLog.push(entry);
    }
    units.push({ unitId: unit.id, title: unit.title, signals: annotated, decision });
  }

  return {
    at: now.toISOString(),
    month,
    phase: { id: phase.id, title: phase.title },
    units,
    corpus: {
      sealed: state.sealedReadings.length,
      target: course.credentialModel.corpusSize,
      chainIntact,
    },
  };
}

export interface CompletionResult {
  completed: boolean;
  reasons: string[];
}

/**
 * The completion gate — ethics first-class at runtime. A unit completes
 * only with all four pillars evidenced AND a sealed unit-close reading.
 * A refused completion is itself a witnessed event.
 */
export function completeUnit(
  course: Course,
  state: LearnerState,
  unitId: string,
  now: Date,
): CompletionResult {
  const unit = unitById(course, unitId);
  const progress = progressFor(state, unitId);
  if (progress.status === "complete") return { completed: true, reasons: ["already complete"] };
  if (progress.status === "not-started") {
    return { completed: false, reasons: ["unit has no logged sessions — nothing to complete"] };
  }

  const hasUnitClose = state.sealedReadings.some(
    (r) => r.kind === "unit-close" && r.unitId === unitId,
  );
  const shallow = detectShallowCompletion(progress, hasUnitClose);
  if (shallow) {
    const watched = unit.adaptation.watchFor.includes("shallow-completion");
    state.adaptationLog.push({
      at: now.toISOString(),
      unitId,
      signal: "shallow-completion",
      move: watched ? "reinforce" : null,
      instruction: watched ? unit.adaptation.moves.reinforce : null,
      evidence: shallow.evidence,
    });
    const reasons = [shallow.evidence];
    if (watched) reasons.push(`contract says: ${unit.adaptation.moves.reinforce}`);
    return { completed: false, reasons };
  }

  progress.status = "complete";
  progress.completedAt = now.toISOString();
  return { completed: true, reasons: [] };
}

export interface PhaseReview {
  phaseId: string;
  title: string;
  units: {
    unitId: string;
    status: string;
    evidencePct: number;
    hours: number;
  }[];
  signalsSeen: Partial<Record<AdaptationSignal, number>>;
  movesExecuted: Partial<Record<AdaptationMove, number>>;
  /** What the log says about how this particular mind learns. */
  observations: string[];
}

/** The phase-boundary witness review: learner and Elle read the log together. */
export function phaseReview(course: Course, state: LearnerState, phaseId: string): PhaseReview {
  const phase = course.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`unknown phase: ${phaseId}`);

  const units = phase.unitIds.map((unitId) => {
    const progress = state.units[unitId] ?? emptyProgress(unitId);
    const hours =
      state.sessions.filter((s) => s.unitId === unitId).reduce((m, s) => m + s.minutes, 0) / 60;
    return {
      unitId,
      status: progress.status,
      evidencePct: Math.round(evidenceFraction(progress) * 100),
      hours: Math.round(hours * 10) / 10,
    };
  });

  const entries = state.adaptationLog.filter((e) => phase.unitIds.includes(e.unitId));
  const signalsSeen: Partial<Record<AdaptationSignal, number>> = {};
  const movesExecuted: Partial<Record<AdaptationMove, number>> = {};
  for (const e of entries) {
    signalsSeen[e.signal] = (signalsSeen[e.signal] ?? 0) + 1;
    if (e.move) movesExecuted[e.move] = (movesExecuted[e.move] ?? 0) + 1;
  }

  const observations: string[] = [];
  const struggles = (signalsSeen["struggle-blocked"] ?? 0) + (signalsSeen["struggle-productive"] ?? 0);
  const accelerations = movesExecuted["accelerate"] ?? 0;
  const reroutes = movesExecuted["reroute"] ?? 0;
  if (struggles > 0 && (signalsSeen["struggle-productive"] ?? 0) >= (signalsSeen["struggle-blocked"] ?? 0)) {
    observations.push("Struggle in this phase was mostly productive: walls got climbed, not circled.");
  }
  if ((signalsSeen["struggle-blocked"] ?? 0) > (signalsSeen["struggle-productive"] ?? 0)) {
    observations.push(
      "Blocked-struggle outweighed productive struggle: the reroutes are worth reading closely — the pattern in what blocks says more than the blocks themselves.",
    );
  }
  if (accelerations > 0 && reroutes === 0) {
    observations.push("The program bent toward acceleration with no reroutes: envelopes may be set too loose for this learner.");
  }
  if ((signalsSeen["shallow-completion"] ?? 0) > 0) {
    observations.push(
      "At least one completion was refused for thin evidence. That refusal is the course working, not failing.",
    );
  }
  if (entries.length === 0) {
    observations.push("No signals fired this phase: either the pacing fit well, or too little was logged for Elle to witness anything. Check hours against envelopes.");
  }

  return { phaseId, title: phase.title, units, signalsSeen, movesExecuted, observations };
}
