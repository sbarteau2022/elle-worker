// VENDORED from CustomCourseBuilder src/runtime/signals.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * Signal detection — pure functions from (unit, progress, sessions, now)
 * to the signals defined in the course schema. Deterministic on purpose:
 * every threshold is named, so a signal can always be explained to the
 * learner in the witness review. No vibes.
 */
import type { AdaptationSignal, Unit } from "./course-types.ts";
import { PILLAR_KEYS, type SessionRecord, type UnitProgress } from "./state.ts";

export interface DetectedSignal {
  signal: AdaptationSignal;
  evidence: string;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Fraction of schedule elapsed vs fraction of pillar evidence produced. */
const PACE_MARGIN = 0.25;
/** All pillars evidenced before this fraction of targetWeeks → mastery-early. */
const MASTERY_EARLY_FRACTION = 0.6;
/** Days without a session on an in-progress unit → disengagement. */
const DISENGAGEMENT_DAYS = 14;
/** Consecutive blocked sessions on the same wall → struggle-blocked. */
const BLOCKED_STREAK = 3;
/** Window (weeks) used for hours and recent-evidence measurements. */
const RECENT_WEEKS = 2;

function weeksBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / MS_PER_WEEK);
}

/** Crude but stable similarity: shared significant words / smaller set. */
export function similarBlockers(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return true; // vague blockers count as the same wall
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

export function evidenceFraction(progress: UnitProgress): number {
  const covered = PILLAR_KEYS.filter((p) => progress.pillarEvidence[p].length > 0).length;
  return covered / PILLAR_KEYS.length;
}

/**
 * Detect all signals currently live on one in-progress unit.
 * `sessions` must be this unit's sessions in chronological order.
 */
export function detectSignals(
  unit: Unit,
  progress: UnitProgress,
  sessions: SessionRecord[],
  now: Date,
): DetectedSignal[] {
  if (progress.status !== "in-progress" || !progress.startedAt) return [];
  const signals: DetectedSignal[] = [];
  const started = new Date(progress.startedAt);
  const weeksElapsed = weeksBetween(started, now);
  const { targetWeeks, minHoursPerWeek } = unit.adaptation.pacing;
  const expected = Math.min(1, weeksElapsed / targetWeeks);
  const actual = evidenceFraction(progress);

  const last = sessions.at(-1);
  const daysSinceLast = last
    ? (now.getTime() - new Date(last.at).getTime()) / (24 * 60 * 60 * 1000)
    : (now.getTime() - started.getTime()) / (24 * 60 * 60 * 1000);

  const recentCutoff = now.getTime() - RECENT_WEEKS * MS_PER_WEEK;
  const recentSessions = sessions.filter((s) => new Date(s.at).getTime() >= recentCutoff);
  const recentHoursPerWeek =
    recentSessions.reduce((m, s) => m + s.minutes, 0) / 60 / RECENT_WEEKS;
  const recentEvidence = recentSessions.some((s) => (s.evidence?.length ?? 0) > 0);

  // Struggle: look at the trailing run of sessions that report blockers.
  const tail = sessions.slice(-BLOCKED_STREAK);
  const blockedTail =
    tail.length === BLOCKED_STREAK &&
    tail.every((s) => s.blocker !== undefined) &&
    tail.every((s) => similarBlockers(s.blocker as string, tail[0]?.blocker as string));
  const anyRecentBlocker = recentSessions.some((s) => s.blocker !== undefined);

  if (blockedTail) {
    signals.push({
      signal: "struggle-blocked",
      evidence: `last ${BLOCKED_STREAK} sessions blocked on the same wall: "${tail[0]?.blocker}"`,
    });
  } else if (anyRecentBlocker && recentEvidence) {
    signals.push({
      signal: "struggle-productive",
      evidence: `blockers reported in the last ${RECENT_WEEKS} weeks, but new pillar evidence still landed`,
    });
  }

  if (daysSinceLast >= DISENGAGEMENT_DAYS) {
    signals.push({
      signal: "disengagement",
      evidence: `${Math.floor(daysSinceLast)} days since the last session on this unit`,
    });
  }

  const allPillars = actual === 1;
  if (allPillars && weeksElapsed < MASTERY_EARLY_FRACTION * targetWeeks) {
    signals.push({
      signal: "mastery-early",
      evidence: `all four pillars evidenced at week ${weeksElapsed.toFixed(1)} of ${targetWeeks}`,
    });
  } else if (actual >= expected + PACE_MARGIN) {
    signals.push({
      signal: "pace-ahead",
      evidence: `evidence ${(actual * 100).toFixed(0)}% vs ${(expected * 100).toFixed(0)}% expected at week ${weeksElapsed.toFixed(1)}`,
    });
  }

  // Pace-behind only when it is genuinely pace, not struggle: low hours,
  // no blockers to explain the gap.
  if (
    weeksElapsed >= 1 &&
    actual <= expected - PACE_MARGIN &&
    recentHoursPerWeek < minHoursPerWeek &&
    !anyRecentBlocker &&
    !blockedTail
  ) {
    signals.push({
      signal: "pace-behind",
      evidence:
        `evidence ${(actual * 100).toFixed(0)}% vs ${(expected * 100).toFixed(0)}% expected; ` +
        `${recentHoursPerWeek.toFixed(1)} hrs/wk against a ${minHoursPerWeek} hr/wk floor, no blockers reported`,
    });
  }

  return signals;
}

/**
 * Shallow completion is detected at the completion gate, not from
 * session flow: completion requested while pillar evidence or the
 * unit-close reading is missing.
 */
export function detectShallowCompletion(
  progress: UnitProgress,
  hasUnitCloseReading: boolean,
): DetectedSignal | null {
  const missingPillars = PILLAR_KEYS.filter((p) => progress.pillarEvidence[p].length === 0);
  if (missingPillars.length === 0 && hasUnitCloseReading) return null;
  const parts: string[] = [];
  if (missingPillars.length > 0) parts.push(`no evidence for: ${missingPillars.join(", ")}`);
  if (!hasUnitCloseReading) parts.push("no sealed unit-close reading");
  return {
    signal: "shallow-completion",
    evidence: `completion requested with ${parts.join(" and ")}`,
  };
}
