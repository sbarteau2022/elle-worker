// VENDORED from CustomCourseBuilder src/runtime/brief.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * The session brief — the bridge between the deterministic engine and
 * Elle's conversational layer.
 *
 * The engine decides; Elle speaks. This module renders everything the
 * conversational model needs at session start — active units, today's
 * contract decisions with their verbatim instructions, ethics-spine
 * obligations, phase state, corpus integrity — as one markdown document.
 * The model reads it under the stance in docs/FACILITATOR.md and runs
 * the session in her own voice. Nothing in the brief is advisory prose
 * from another model: every line traces to state plus named thresholds,
 * so Elle can always answer "why are you telling me this?" with evidence.
 */
import type { Course, Unit } from "./course-types.ts";
import type { LearnerState } from "./state.ts";
import { PILLAR_KEYS } from "./state.ts";
import { advise, availableUnits, currentMonth, phaseForMonth, unitById, type Advice } from "./engine.ts";
import { evidenceFraction } from "./signals.ts";
import { verifyChain } from "./seal.ts";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface EthicsSpineStatus {
  /** Program week, 1-based, from enrollment. */
  week: number;
  weeklySealed: number;
  /** Weekly readings owed so far minus weekly readings sealed (>= 0). */
  weeklyOwed: number;
  /** Units completed but — impossible via the gate, tracked anyway — missing a unit-close reading. */
  missingUnitClose: string[];
  chainIntact: boolean;
}

export interface SessionBrief {
  at: string;
  learnerId: string;
  courseTitle: string;
  month: number;
  phase: { id: string; title: string; theme: string; isFinalMonthOfPhase: boolean };
  advice: Advice;
  ethics: EthicsSpineStatus;
  /** Units available but not yet started — what Elle may offer next. */
  openings: { unitId: string; title: string; track: string }[];
  markdown: string;
}

export function ethicsSpineStatus(course: Course, state: LearnerState, now: Date): EthicsSpineStatus {
  const week = Math.max(
    1,
    Math.floor((now.getTime() - new Date(state.enrolledAt).getTime()) / MS_PER_WEEK) + 1,
  );
  const weeklySealed = state.sealedReadings.filter((r) => r.kind === "weekly").length;
  // A weekly reading is owed for every *completed* program week.
  const weeklyOwed = Math.max(0, week - 1 - weeklySealed);
  const missingUnitClose = Object.values(state.units)
    .filter((p) => p.status === "complete")
    .map((p) => p.unitId)
    .filter(
      (unitId) =>
        !state.sealedReadings.some((r) => r.kind === "unit-close" && r.unitId === unitId),
    );
  return {
    week,
    weeklySealed,
    weeklyOwed,
    missingUnitClose,
    chainIntact: verifyChain(state.sealedReadings).length === 0,
  };
}

function pillarGaps(course: Course, state: LearnerState, unitId: string): string[] {
  const progress = state.units[unitId];
  if (!progress) return [...PILLAR_KEYS];
  const unit = unitById(course, unitId);
  return PILLAR_KEYS.filter((p) => progress.pillarEvidence[p].length === 0).map(
    (p) => `${p}: ${unit.pillars[p]}`,
  );
}

function renderMarkdown(
  course: Course,
  state: LearnerState,
  now: Date,
  advice: Advice,
  ethics: EthicsSpineStatus,
  openings: SessionBrief["openings"],
  isFinalMonthOfPhase: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# Session brief — ${state.learnerId}`);
  lines.push("");
  lines.push(
    `${course.title} · month ${advice.month} of ${course.durationMonths} · week ${ethics.week} · phase: ${advice.phase.title}`,
  );
  lines.push("");

  // Ethics spine first — it is first-class here too.
  lines.push(`## Ethics spine`);
  lines.push("");
  lines.push(
    `Corpus: ${advice.corpus.sealed}/${advice.corpus.target} sealed readings. Chain: ${
      ethics.chainIntact ? "intact" : "**BROKEN — surface this immediately, before any other work**"
    }.`,
  );
  if (ethics.weeklyOwed > 0) {
    lines.push("");
    lines.push(
      `**${ethics.weeklyOwed} weekly reading${ethics.weeklyOwed > 1 ? "s" : ""} owed.** ` +
        `Open the session here: ask what this week's material surfaced, and seal a reading before new coursework. ` +
        `The spine is non-optional; the program's claim to be different lives or dies here.`,
    );
  } else {
    lines.push("");
    lines.push(`Weekly readings current (${ethics.weeklySealed} sealed). Hold the habit.`);
  }
  for (const unitId of ethics.missingUnitClose) {
    lines.push(`- Completed unit ${unitId} has no unit-close reading — this should be impossible; investigate.`);
  }
  lines.push("");

  lines.push(`## Active units`);
  for (const u of advice.units) {
    const unit = unitById(course, u.unitId);
    const progress = state.units[u.unitId];
    const hours =
      state.sessions.filter((s) => s.unitId === u.unitId).reduce((m, s) => m + s.minutes, 0) / 60;
    lines.push("");
    lines.push(`### ${unit.title} (\`${u.unitId}\`, track ${unit.track})`);
    lines.push(
      `Evidence ${progress ? Math.round(evidenceFraction(progress) * 100) : 0}% · ${hours.toFixed(1)}h logged · ` +
        `envelope ${unit.adaptation.pacing.minHoursPerWeek}–${unit.adaptation.pacing.maxHoursPerWeek} hrs/wk over ~${unit.adaptation.pacing.targetWeeks} weeks`,
    );
    if (u.decision) {
      lines.push("");
      lines.push(`**Contract move: ${u.decision.move.toUpperCase()}** (signal: ${u.decision.signal}).`);
      lines.push(`Instruction, verbatim: "${u.decision.instruction}"`);
      lines.push(
        `Deliver this as Elle, in conversation — not as a system notice. The evidence behind the signal:`,
      );
      for (const s of u.signals.filter((s) => s.watched)) {
        lines.push(`- ${s.signal}: ${s.evidence}`);
      }
    } else if (u.signals.length > 0) {
      lines.push("");
      lines.push(`Observed (unwatched — no move; mention only if the learner raises it):`);
      for (const s of u.signals) lines.push(`- ${s.signal}: ${s.evidence}`);
    } else {
      lines.push(`Steady. No signals.`);
    }
    const gaps = pillarGaps(course, state, u.unitId);
    if (gaps.length > 0 && gaps.length < 4) {
      lines.push(`Pillars still without evidence:`);
      for (const g of gaps) lines.push(`- ${g}`);
    }
  }
  if (advice.units.length === 0) {
    lines.push("");
    lines.push(`No units in progress. Open one from the openings below.`);
  }
  lines.push("");

  if (openings.length > 0) {
    lines.push(`## Openings`);
    lines.push("");
    for (const o of openings) {
      lines.push(`- \`${o.unitId}\` — ${o.title} (track ${o.track})`);
    }
    lines.push("");
  }

  if (isFinalMonthOfPhase) {
    lines.push(`## Phase boundary approaching`);
    lines.push("");
    lines.push(
      `This is the final month of "${advice.phase.title}". Schedule the witness review with the learner: ` +
        `read the adaptation log together, seal the phase-synthesis reading, and name what the log says about how this mind learns.`,
    );
    lines.push("");
  }

  lines.push(`---`);
  lines.push(
    `Every line above traces to logged state and named thresholds. If the learner asks "why", the evidence is the answer. ` +
      `Stance: docs/FACILITATOR.md.`,
  );
  return lines.join("\n");
}

/**
 * Build the full session brief. Calls advise() — so generating a brief
 * writes the witness log, exactly as a CLI advise would. One brief per
 * session start is the intended cadence.
 */
export function sessionBrief(course: Course, state: LearnerState, now: Date): SessionBrief {
  const ethics = ethicsSpineStatus(course, state, now);
  const adviceResult = advise(course, state, now, ethics.chainIntact);
  const month = currentMonth(state, now);
  const phase = phaseForMonth(course, month);
  const isFinalMonthOfPhase = month === phase.months[1];
  const openings = availableUnits(course, state, now)
    .filter((u: Unit) => (state.units[u.id]?.status ?? "not-started") === "not-started")
    .map((u: Unit) => ({ unitId: u.id, title: u.title, track: u.track }));

  return {
    at: now.toISOString(),
    learnerId: state.learnerId,
    courseTitle: course.title,
    month,
    phase: { id: phase.id, title: phase.title, theme: phase.theme, isFinalMonthOfPhase },
    advice: adviceResult,
    ethics,
    openings,
    markdown: renderMarkdown(course, state, now, adviceResult, ethics, openings, isFinalMonthOfPhase),
  };
}
