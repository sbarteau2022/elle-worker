// VENDORED from CustomCourseBuilder src/types/course.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * CustomCourseBuilder — core course schema.
 *
 * Two things are first-class citizens here and cannot be omitted:
 *
 * 1. Ethics — every unit carries a three-tier reading (material ground →
 *    observer reading → sit-with-this), the same structure the Education
 *    Intelligence Engine applies to any domain of knowledge. A unit that
 *    teaches a capability without naming what the field suppresses about
 *    that capability does not type-check.
 *
 * 2. Adaptation — every unit carries an adaptation contract for Elle:
 *    the pacing envelope, the signals she watches for in real time, and
 *    the moves she is allowed to make (accelerate, reinforce, reroute).
 *    A unit without an adaptation contract does not type-check.
 *
 * Learning method is the four pillars from the program charter:
 * Structure → Reading/Logic Reasoning → Testing → Building.
 */

/** The four pillars. Every unit states what the learner does under each. */
export interface Pillars {
  /** Map the system before touching it: diagrams, schemas, decomposition. */
  structure: string;
  /** Read source, docs, papers; reason about why it is shaped this way. */
  readingReasoning: string;
  /** Prove understanding by breaking and verifying: tests written first. */
  testing: string;
  /** Ship something real that exists only because this unit was learned. */
  building: string;
}

/**
 * The three-tier reading applied to the unit's subject matter.
 * Tier names follow the Education Intelligence Engine spec (v1.0, 2026-03).
 */
export interface ThreeTierReading {
  /**
   * Tier 1 — Material ground. What is verifiably true about this
   * technology or practice: what it does, what it costs, who runs it.
   * No inference beyond what is documented.
   */
  materialGround: string;
  /**
   * Tier 2 — Observer reading. What the field suppresses about this
   * subject: what the dominant framing cannot acknowledge, what the
   * critics idealize, what both leave unnamed.
   */
  observerReading: string;
  /**
   * Tier 3 — Sit with this. The question the learner carries out of the
   * unit and cannot unknow. Written as a question, not an answer.
   */
  sitWithThis: string;
}

/** Signals Elle watches while witnessing the learner work this unit. */
export type AdaptationSignal =
  | "pace-ahead" // completing work faster than the pacing envelope
  | "pace-behind" // falling behind the envelope without struggle markers
  | "struggle-productive" // slow but progressing; errors are informative
  | "struggle-blocked" // repeated identical failures; no new information
  | "shallow-completion" // artifacts pass but pillar evidence is thin
  | "disengagement" // sessions shortening, gaps growing
  | "mastery-early"; // pillar evidence complete before scheduled close

/** Moves Elle may make in response to signals on this unit. */
export interface AdaptationMoves {
  /** What to do on mastery-early / pace-ahead. */
  accelerate: string;
  /** What to do on struggle-productive / pace-behind. */
  reinforce: string;
  /** What to do on struggle-blocked / disengagement — the exit ramp. */
  reroute: string;
}

/** The pacing envelope Elle holds the learner inside — hours per week. */
export interface PacingEnvelope {
  minHoursPerWeek: number;
  targetHoursPerWeek: number;
  maxHoursPerWeek: number;
  /** Scheduled duration in weeks at target pace. */
  targetWeeks: number;
}

/** The full adaptation contract between a unit and Elle. */
export interface AdaptationContract {
  pacing: PacingEnvelope;
  /** Signals that are meaningful for this unit (subset Elle prioritizes). */
  watchFor: AdaptationSignal[];
  moves: AdaptationMoves;
}

export type TrackId = "A" | "B" | "C" | "D" | "E";

export interface Track {
  id: TrackId;
  name: string;
  focus: string;
  /** Display color, matching the founder-stack visual language. */
  color: string;
}

export type CredentialKind =
  | "professional-certificate"
  | "specialization"
  | "course"
  | "short-course"
  | "vendor-certification"
  | "audit";

export interface ExternalCredential {
  name: string;
  provider: string;
  kind: CredentialKind;
  /** True when the content is free to audit or the credential itself is free. */
  freeToAudit: boolean;
  /** Approximate cost in USD if the paid credential is taken; 0 if free. */
  paidCostUSD: number;
}

/**
 * A unit is one credential-bearing block of work inside a phase.
 * Ethics (tiers) and adaptation are required — the type system is the
 * enforcement mechanism for "first-class citizen."
 */
export interface Unit {
  id: string;
  track: TrackId;
  title: string;
  summary: string;
  /** External credentials earned inside this unit (one or more). */
  credentials: ExternalCredential[];
  /** Unit ids that should be complete (or in progress) before starting. */
  prerequisites: string[];
  /** What this unit contributes to the Elle build — the applied thread. */
  buildThread: string;
  pillars: Pillars;
  tiers: ThreeTierReading;
  adaptation: AdaptationContract;
}

/** A phase is a quarter of the program: a window with concurrent units. */
export interface Phase {
  id: string;
  title: string;
  /** 1-indexed month window, inclusive. */
  months: [start: number, end: number];
  theme: string;
  unitIds: string[];
}

/**
 * A spine runs the full length of the course rather than living inside a
 * phase. The ethics spine is mandatory on every course.
 */
export interface Spine {
  id: string;
  title: string;
  cadence: string;
  practice: string;
}

/**
 * The credential model: the learner's sealed observer readings are the
 * credential, per the Education Intelligence Engine's alternative
 * credentialing design.
 */
export interface CredentialModel {
  /** What one sealed reading consists of for this course. */
  sealedReading: string;
  /** How many sealed readings constitute the completed credential. */
  corpusSize: number;
  /** What the corpus demonstrates that external certificates cannot. */
  demonstrates: string;
}

export interface Course {
  id: string;
  title: string;
  version: string;
  mission: string;
  durationMonths: number;
  tracks: Track[];
  phases: Phase[];
  units: Unit[];
  /** Mandatory: at least the ethics spine. */
  spines: Spine[];
  credentialModel: CredentialModel;
  costModel: {
    minUSD: number;
    maxUSD: number;
    note: string;
  };
}
