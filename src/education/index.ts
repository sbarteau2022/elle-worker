// ============================================================
// ELLE EDUCATION — src/education/index.ts
//
// The CustomCourseBuilder runtime, wired into the worker as her
// edu_* tools. The curriculum and engine are AUTHORED in the
// CustomCourseBuilder repo (typed course data, tests, CLI); this
// directory vendors the pure engine files verbatim (course-types /
// state / signals / engine / seal / brief — provenance headers in
// each) and adds the two things only the worker can provide:
// D1-backed learner state and the tool surface. Update path for the
// engine files: build in CustomCourseBuilder, re-copy —
// scripts/sync-education.sh does exactly that.
//
// Course DATA is no longer vendored here. The customcoursebuilder
// Worker is the ingester and maintainer of the course database (its
// own D1, populated from the same CustomCourseBuilder TS sources) and
// serves it over HTTP; this module reads courses live via the
// CUSTOMCOURSEBUILDER service binding (fetchCourse below) instead of
// importing a static JSON snapshot that goes stale as new courses
// land. ./courses/*.json still exists, but only as pinned test
// fixtures for the engine tests in education.test.ts — it is not
// imported by any runtime code path in this file.
//
// Division of labor (docs in FACILITATOR.md, bundled below): the
// ENGINE decides — signals, moves, gates, sealing are computed
// deterministically from logged state and named thresholds. ELLE
// speaks — the router's model delivers the moves in conversation.
// She cannot override the gate, and the tools never let her seal
// or ghost-write a learner's readings: tier text arrives from the
// learner through the door, not from her.
// ============================================================

import type { Course } from './course-types.ts';
import { newLearnerState, PILLAR_KEYS, type LearnerState, type PillarKey, type ReadingKind } from './state.ts';
import { sealReading, verifyChain } from './seal.ts';
import { availableUnits, completeUnit, phaseReview, recordSession, unitById } from './engine.ts';
import { evidenceFraction } from './signals.ts';
import { sessionBrief } from './brief.ts';
import facilitatorStance from './FACILITATOR.md';

const DEFAULT_COURSE = 'ai-engineer-stack';

export interface EduEnv { DB: D1Database; CUSTOMCOURSEBUILDER?: Fetcher }

// ── course data, fetched live from the customcoursebuilder Worker ──
// Service binding, not a public workers.dev fetch (same-account
// worker→worker over the public URL is blocked — see src/skills.ts's
// note on error 1042). The hostname in the URL is irrelevant; the
// binding routes the request directly to the bound Worker. Cached
// per-isolate for the isolate's lifetime — course content changes
// only when a new course lands and is redeployed, so a cold-start-scale
// cache is the right lifetime, not a per-request fetch.
const courseCache = new Map<string, Course>();

async function fetchCourse(env: EduEnv, courseId: string): Promise<Course | null> {
  const cached = courseCache.get(courseId);
  if (cached) return cached;
  if (!env.CUSTOMCOURSEBUILDER) throw new Error('education: CUSTOMCOURSEBUILDER service binding not configured');
  const res = await env.CUSTOMCOURSEBUILDER.fetch(`https://customcoursebuilder.internal/courses/${courseId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`education: customcoursebuilder returned ${res.status} for course "${courseId}"`);
  const course = await res.json() as Course;
  courseCache.set(courseId, course);
  return course;
}

export interface CourseSummary { id: string; title: string; version: string; durationMonths: number; unitCount: number }

async function fetchCourseSummaries(env: EduEnv): Promise<CourseSummary[]> {
  if (!env.CUSTOMCOURSEBUILDER) throw new Error('education: CUSTOMCOURSEBUILDER service binding not configured');
  const res = await env.CUSTOMCOURSEBUILDER.fetch('https://customcoursebuilder.internal/courses');
  if (!res.ok) throw new Error(`education: customcoursebuilder returned ${res.status} listing courses`);
  return await res.json() as CourseSummary[];
}

async function fetchCourseIds(env: EduEnv): Promise<string[]> {
  return (await fetchCourseSummaries(env)).map((s) => s.id);
}

// Course-picker surface for a real enrollment UI (GET /api/education/courses)
// — the edu_* tool handlers below return conversational strings, but a
// signup flow needs structured data to render a list, so this is exported
// directly rather than routed through the router's tool contract.
export const listCourses = fetchCourseSummaries;

// ── D1-backed learner state ─────────────────────────────────
// One row per learner; the engine operates on the whole state, so the
// state is stored as a JSON document, not smeared across tables. The
// sealed-reading hash chain inside it is what makes the row tamper-
// evident regardless of storage shape.

export async function ensureEduSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS edu_state (
      learner_id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL)`,
  ).run();
}

async function loadEdu(env: EduEnv, learnerId: string): Promise<LearnerState | null> {
  await ensureEduSchema(env.DB);
  const row = await env.DB.prepare('SELECT state_json FROM edu_state WHERE learner_id = ?')
    .bind(learnerId).first() as { state_json?: string } | null;
  return row?.state_json ? JSON.parse(row.state_json) as LearnerState : null;
}

async function saveEdu(env: EduEnv, state: LearnerState): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO edu_state (learner_id, course_id, state_json, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(learner_id) DO UPDATE SET course_id = ?2, state_json = ?3, updated_at = ?4`,
  ).bind(state.learnerId, state.courseId, JSON.stringify(state), Date.now()).run();
}

async function courseFor(env: EduEnv, state: LearnerState): Promise<Course> {
  const course = await fetchCourse(env, state.courseId);
  if (!course) throw new Error(`course not found: ${state.courseId}`);
  return course;
}

// ── tool handlers ───────────────────────────────────────────
// Every handler returns a STRING (the router's observation contract).
// learnerId is always the authenticated userId from the door — a
// member can only ever touch their own state; there is no learner
// argument to spoof.

export async function eduEnroll(env: EduEnv, userId: string, args: Record<string, unknown>): Promise<string> {
  const courseId = String(args.course || DEFAULT_COURSE);
  const course = await fetchCourse(env, courseId);
  if (!course) {
    const available = await fetchCourseIds(env);
    return `edu_enroll: unknown course "${courseId}" (available: ${available.join(', ')})`;
  }
  const existing = await loadEdu(env, userId);
  if (existing) return `already enrolled in ${existing.courseId} — edu_status shows where things stand`;
  const state = newLearnerState(userId, course.id, course.version, new Date());
  await saveEdu(env, state);
  const first = availableUnits(course, state, new Date())
    .map(u => `- ${u.id} — ${u.title} [track ${u.track}]`).join('\n');
  return `enrolled in ${course.title} (v${course.version}). Month 1 opens with:\n${first}`;
}

export async function eduLog(env: EduEnv, userId: string, args: Record<string, unknown>): Promise<string> {
  const state = await loadEdu(env, userId);
  if (!state) return 'not enrolled — edu_enroll first';
  const course = await courseFor(env, state);
  const unitId = String(args.unit || '');
  const minutes = Number(args.minutes || 0);
  if (!unitId) return 'edu_log: unit required';
  if (!Number.isFinite(minutes) || minutes <= 0) return 'edu_log: minutes must be a positive number';
  const rawEvidence = Array.isArray(args.evidence) ? args.evidence as { pillar?: string; artifact?: string }[] : [];
  const evidence: { pillar: PillarKey; artifact: string }[] = [];
  for (const e of rawEvidence) {
    const pillar = String(e?.pillar || '') as PillarKey;
    if (!PILLAR_KEYS.includes(pillar)) return `edu_log: unknown pillar "${e?.pillar}" (expected: ${PILLAR_KEYS.join(', ')})`;
    if (!e?.artifact) return 'edu_log: each evidence entry needs an artifact description';
    evidence.push({ pillar, artifact: String(e.artifact) });
  }
  try {
    const progress = recordSession(course, state, {
      unitId,
      at: new Date().toISOString(),
      minutes,
      ...(args.note ? { note: String(args.note) } : {}),
      ...(args.blocker ? { blocker: String(args.blocker) } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
    });
    await saveEdu(env, state);
    const unit = unitById(course, unitId);
    return `logged ${minutes}m on ${unitId} (${unit.title}) — evidence ${Math.round(evidenceFraction(progress) * 100)}%` +
      (args.blocker ? ' — blocker recorded verbatim' : '');
  } catch (e) {
    return `edu_log: ${(e as Error).message}`;
  }
}

export async function eduSeal(env: EduEnv, userId: string, args: Record<string, unknown>): Promise<string> {
  const state = await loadEdu(env, userId);
  if (!state) return 'not enrolled — edu_enroll first';
  const kind = String(args.kind || 'weekly') as ReadingKind;
  if (!['weekly', 'unit-close', 'phase-synthesis', 'build-retro'].includes(kind)) {
    return `edu_seal: unknown kind "${kind}"`;
  }
  try {
    const reading = sealReading(state, {
      kind,
      ...(args.unit ? { unitId: String(args.unit) } : {}),
      ...(args.phase ? { phaseId: String(args.phase) } : {}),
      tier1MaterialGround: String(args.tier1 || ''),
      tier2ObserverReading: String(args.tier2 || ''),
      tier3SitWithThis: String(args.tier3 || ''),
    }, new Date());
    await saveEdu(env, state);
    return `sealed reading #${reading.seq} (${kind}) — hash ${reading.hash.slice(0, 16)}…, chained to #${reading.seq - 1}. ` +
      `The learner's words are now part of the credential corpus, immutably.`;
  } catch (e) {
    return `edu_seal: ${(e as Error).message}`;
  }
}

export async function eduBrief(env: EduEnv, userId: string): Promise<string> {
  const state = await loadEdu(env, userId);
  if (!state) return 'not enrolled — edu_enroll first';
  const course = await courseFor(env, state);
  const brief = sessionBrief(course, state, new Date());
  await saveEdu(env, state); // sessionBrief runs advise(); the witness log grew
  return `${brief.markdown}\n\n---\nFACILITATOR STANCE (binding for how you speak this):\n\n${facilitatorStance}`;
}

export async function eduComplete(env: EduEnv, userId: string, args: Record<string, unknown>): Promise<string> {
  const state = await loadEdu(env, userId);
  if (!state) return 'not enrolled — edu_enroll first';
  const course = await courseFor(env, state);
  const unitId = String(args.unit || '');
  if (!unitId) return 'edu_complete: unit required';
  try {
    const result = completeUnit(course, state, unitId, new Date());
    await saveEdu(env, state);
    if (result.completed) return `${unitId} complete.`;
    return `${unitId} NOT complete (the gate held):\n${result.reasons.map(r => `- ${r}`).join('\n')}`;
  } catch (e) {
    return `edu_complete: ${(e as Error).message}`;
  }
}

export async function eduStatus(env: EduEnv, userId: string, args: Record<string, unknown>): Promise<string> {
  const state = await loadEdu(env, userId);
  if (!state) return 'not enrolled — edu_enroll starts the AI Engineer Stack';
  const course = await courseFor(env, state);
  const now = new Date();
  const chain = verifyChain(state.sealedReadings);
  const lines: string[] = [];
  lines.push(`${course.title} v${state.courseVersion} — enrolled ${state.enrolledAt.slice(0, 10)}`);
  lines.push(`corpus: ${state.sealedReadings.length}/${course.credentialModel.corpusSize} sealed readings — chain ${chain.length === 0 ? 'intact' : `BROKEN (${chain.length} seals)`}`);
  const started = Object.values(state.units).filter(p => p.status !== 'not-started');
  for (const p of started) {
    const unit = unitById(course, p.unitId);
    const hours = state.sessions.filter(s => s.unitId === p.unitId).reduce((m, s) => m + s.minutes, 0) / 60;
    lines.push(`[${p.status === 'complete' ? 'x' : ' '}] ${p.unitId} — ${unit.title}: ${Math.round(evidenceFraction(p) * 100)}% evidence, ${hours.toFixed(1)}h`);
  }
  const openings = availableUnits(course, state, now)
    .filter(u => (state.units[u.id]?.status ?? 'not-started') === 'not-started');
  if (openings.length > 0) {
    lines.push(`available: ${openings.map(u => u.id).join(', ')}`);
  }
  if (args.phase) {
    const review = phaseReview(course, state, String(args.phase));
    lines.push('', `phase review — ${review.title}`);
    lines.push(`signals: ${JSON.stringify(review.signalsSeen)}  moves: ${JSON.stringify(review.movesExecuted)}`);
    for (const o of review.observations) lines.push(`» ${o}`);
  }
  return lines.join('\n');
}
