// Agent-bridge store: a durable, single-process task board shared by two
// agents playing distinct roles — a chief architect that posts briefs and
// reviews work, and a worker that claims tasks, executes, and reports back.
//
// Persistence is a single JSON file, rewritten atomically (temp file + rename)
// on every mutation. The bridge is one HTTP process, so there is no
// cross-process write race; the file is purely for durability across restarts.
// Volume is a handful of tasks and messages, so a JSON document beats pulling
// in a database dependency.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Role = 'architect' | 'worker' | 'observer';

// open        — posted by the architect, waiting for a worker to claim
// claimed      — a worker has taken it; work is expected
// submitted    — the worker has posted a result, awaiting architect review
// changes_requested — architect reviewed and wants revisions (back to the worker)
// approved     — architect accepted the result; work is done
// blocked      — the worker cannot proceed and has said why
// cancelled    — the architect withdrew the task
export type TaskStatus =
  | 'open'
  | 'claimed'
  | 'submitted'
  | 'changes_requested'
  | 'approved'
  | 'blocked'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type EventKind =
  | 'created'
  | 'directive'
  | 'claimed'
  | 'progress'
  | 'blocked'
  | 'submitted'
  | 'review'
  | 'note';

export interface TaskEvent {
  id: string;
  ts: string; // ISO
  role: Role;
  kind: EventKind;
  body: string;
  // review verdicts only
  verdict?: 'approve' | 'request_changes';
  // free-form structured payload (e.g. artifact list on a submit)
  data?: unknown;
}

export interface Task {
  id: string;
  seq: number; // monotonic, human-friendly ordering
  title: string;
  brief: string;
  status: TaskStatus;
  priority: Priority;
  assignee_role: Role;
  created_at: string;
  updated_at: string;
  events: TaskEvent[];
}

interface BoardData {
  version: 1;
  next_seq: number;
  tasks: Task[];
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export class Store {
  private path: string;
  private data: BoardData;

  constructor(path: string) {
    this.path = path;
    this.data = this.load();
  }

  private load(): BoardData {
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as BoardData;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.tasks)) return parsed;
      } catch {
        // fall through to a fresh board rather than crashing the bridge
      }
    }
    return { version: 1, next_seq: 1, tasks: [] };
  }

  private persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  private now(): string {
    return new Date().toISOString();
  }

  private event(role: Role, kind: EventKind, body: string, extra: Partial<TaskEvent> = {}): TaskEvent {
    return { id: randomUUID(), ts: this.now(), role, kind, body, ...extra };
  }

  private find(taskId: string): Task {
    const t = this.data.tasks.find((x) => x.id === taskId || String(x.seq) === taskId);
    if (!t) throw new Error(`No task with id "${taskId}". Use bridge_list_tasks to see open work.`);
    return t;
  }

  // ── architect ────────────────────────────────────────────────────
  createTask(input: {
    title: string;
    brief: string;
    priority?: Priority;
    assignee_role?: Role;
  }): Task {
    const ts = this.now();
    const task: Task = {
      id: randomUUID(),
      seq: this.data.next_seq++,
      title: input.title,
      brief: input.brief,
      status: 'open',
      priority: input.priority ?? 'normal',
      assignee_role: input.assignee_role ?? 'worker',
      created_at: ts,
      updated_at: ts,
      events: [this.event('architect', 'created', input.brief)],
    };
    this.data.tasks.push(task);
    this.persist();
    return task;
  }

  directive(taskId: string, role: Role, body: string): Task {
    const t = this.find(taskId);
    t.events.push(this.event(role, 'directive', body));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  review(taskId: string, verdict: 'approve' | 'request_changes', notes: string): Task {
    const t = this.find(taskId);
    t.status = verdict === 'approve' ? 'approved' : 'changes_requested';
    t.events.push(this.event('architect', 'review', notes, { verdict }));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  cancel(taskId: string, reason: string): Task {
    const t = this.find(taskId);
    t.status = 'cancelled';
    t.events.push(this.event('architect', 'note', reason || 'Task cancelled.'));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  // ── worker ───────────────────────────────────────────────────────
  // Claims the highest-priority, oldest task that is open or awaiting
  // revision for the given role. Returns null when the board is clear.
  claimNext(role: Role): Task | null {
    const claimable = this.data.tasks
      .filter((t) => t.assignee_role === role && (t.status === 'open' || t.status === 'changes_requested'))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.seq - b.seq);
    const t = claimable[0];
    if (!t) return null;
    t.status = 'claimed';
    t.events.push(this.event(role, 'claimed', `Claimed by ${role}.`));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  progress(taskId: string, role: Role, body: string): Task {
    const t = this.find(taskId);
    t.events.push(this.event(role, 'progress', body));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  submit(taskId: string, role: Role, summary: string, artifacts?: unknown): Task {
    const t = this.find(taskId);
    t.status = 'submitted';
    t.events.push(this.event(role, 'submitted', summary, { data: artifacts }));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  block(taskId: string, role: Role, reason: string): Task {
    const t = this.find(taskId);
    t.status = 'blocked';
    t.events.push(this.event(role, 'blocked', reason));
    t.updated_at = this.now();
    this.persist();
    return t;
  }

  // ── shared / observer ────────────────────────────────────────────
  getTask(taskId: string): Task {
    return this.find(taskId);
  }

  listTasks(filter?: { status?: TaskStatus; assignee_role?: Role }): Task[] {
    let out = [...this.data.tasks];
    if (filter?.status) out = out.filter((t) => t.status === filter.status);
    if (filter?.assignee_role) out = out.filter((t) => t.assignee_role === filter.assignee_role);
    return out.sort((a, b) => b.seq - a.seq);
  }

  // Every event newer than `since` (ISO ts, exclusive), flattened across
  // tasks and sorted oldest→newest, so a caller can poll for what happened
  // while it was away. Optionally scoped to events a role should act on.
  inbox(opts: { since?: string; forRole?: Role; limit?: number } = {}): Array<TaskEvent & { task_id: string; task_seq: number; task_title: string }> {
    const sinceMs = opts.since ? Date.parse(opts.since) : 0;
    const rows: Array<TaskEvent & { task_id: string; task_seq: number; task_title: string }> = [];
    for (const t of this.data.tasks) {
      for (const e of t.events) {
        if (Date.parse(e.ts) <= sinceMs) continue;
        if (opts.forRole && !relevantTo(opts.forRole, e)) continue;
        rows.push({ ...e, task_id: t.id, task_seq: t.seq, task_title: t.title });
      }
    }
    rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return typeof opts.limit === 'number' ? rows.slice(-opts.limit) : rows;
  }

  stats(): { total: number; by_status: Record<string, number> } {
    const by_status: Record<string, number> = {};
    for (const t of this.data.tasks) by_status[t.status] = (by_status[t.status] ?? 0) + 1;
    return { total: this.data.tasks.length, by_status };
  }
}

// Which side should pay attention to an event. The worker cares about new
// briefs, directives and review feedback; the architect cares about progress,
// submissions and blocks. Observers see everything (handled by the caller).
function relevantTo(role: Role, e: TaskEvent): boolean {
  if (role === 'worker') return e.kind === 'created' || e.kind === 'directive' || e.kind === 'review';
  if (role === 'architect') return e.kind === 'progress' || e.kind === 'submitted' || e.kind === 'blocked';
  return true;
}
