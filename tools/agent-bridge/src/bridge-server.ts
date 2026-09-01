#!/usr/bin/env node
// Agent Bridge — a shared MCP coordination bus.
//
// Two agents in two different apps cannot see each other. This server is the
// shared surface between them: a task board plus a message log that both plug
// into as an MCP client.
//
//   • Chief architect (e.g. Gemini in Google Antigravity) — posts briefs,
//     watches progress, reviews and approves results. The "meta observer".
//   • Worker (e.g. local Qwen under Claude Desktop) — claims tasks, reports
//     progress, submits results, flags blockers. Does the actual work.
//
// The architect is swappable ("or whomever I sub in"): every tool takes an
// explicit `role`, so nothing here is tied to a specific model or vendor.
//
// Transport: stateless Streamable HTTP on localhost, so both apps can point at
// the SAME running process and therefore the SAME board. (stdio would spawn a
// private subprocess per app and the two would never share state.)

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Store, type Role, type TaskStatus } from './store.js';

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const DB_PATH = process.env.BRIDGE_DB ?? new URL('../data/board.json', import.meta.url).pathname;
// Optional shared secret. When set, every request must send it as
// `Authorization: Bearer <token>`. Off by default because the server binds to
// localhost; turn it on if you expose the port.
const TOKEN = process.env.BRIDGE_TOKEN ?? '';

const store = new Store(DB_PATH);

const roleSchema = z
  .enum(['architect', 'worker', 'observer'])
  .describe('Which side is calling. "architect" posts and reviews work; "worker" claims and executes; "observer" only reads.');

function ok(structured: unknown, human?: string) {
  return {
    content: [{ type: 'text' as const, text: human ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

// Compact a task for tool output so we never dump the full event history
// unless the caller explicitly asked for one task via bridge_get_task.
function summarize(t: ReturnType<Store['getTask']>) {
  const last = t.events[t.events.length - 1];
  return {
    id: t.id,
    ref: `#${t.seq}`,
    seq: t.seq,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee_role: t.assignee_role,
    updated_at: t.updated_at,
    last_activity: last ? { kind: last.kind, role: last.role, ts: last.ts } : null,
  };
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'elle-agent-bridge', version: '1.0.0' },
    {
      instructions:
        'Coordination bus between a chief-architect agent and a worker agent. ' +
        'ARCHITECT loop: bridge_create_task to hand down a brief → bridge_inbox(role:"architect") to watch for progress/submissions → bridge_review to approve or request changes. ' +
        'WORKER loop: bridge_claim_next(role:"worker") to take the next brief → bridge_post_progress as you go → bridge_submit_result when done, or bridge_report_blocker if stuck. ' +
        'Either side can bridge_list_tasks / bridge_get_task to observe. Poll bridge_inbox with the ts of the last event you saw as `since` to get only what is new.',
    },
  );

  // ── Architect tools ───────────────────────────────────────────────
  server.registerTool(
    'bridge_create_task',
    {
      title: 'Create task (architect)',
      description:
        'Post a new brief onto the shared board for the worker to pick up. Use this to hand a unit of work down from the chief architect to the worker agent. Returns the task with its reference (#N).',
      inputSchema: {
        title: z.string().min(1).describe('Short imperative title, e.g. "Add retry to the ingest webhook".'),
        brief: z
          .string()
          .min(1)
          .describe('The full specification: goal, constraints, acceptance criteria, relevant files/paths. Write it so the worker can execute without further questions.'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Defaults to "normal". The worker claims urgent→high→normal→low, oldest first.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, brief, priority }) => {
      const t = store.createTask({ title, brief, priority });
      return ok({ task: summarize(t) }, `Created task #${t.seq} "${t.title}" (${t.priority}). Worker can now claim it.`);
    },
  );

  server.registerTool(
    'bridge_review',
    {
      title: 'Review result (architect)',
      description:
        'Review a result the worker submitted. Approve it (task is done) or request changes (task goes back to the worker for revision). The worker sees your notes via bridge_inbox.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number (e.g. "3" or the uuid).'),
        verdict: z.enum(['approve', 'request_changes']).describe('"approve" closes the task; "request_changes" reopens it for the worker.'),
        notes: z.string().min(1).describe('What was good / what must change. On request_changes, be specific and actionable.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, verdict, notes }) => {
      const t = store.review(task_id, verdict, notes);
      return ok({ task: summarize(t) }, `Task #${t.seq} → ${t.status}.`);
    },
  );

  server.registerTool(
    'bridge_send_directive',
    {
      title: 'Send directive / message',
      description:
        'Post a message onto a task without changing its status — a clarification, a nudge, extra context, or a mid-flight steer. Visible to the other side via bridge_inbox and bridge_get_task.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
        role: roleSchema,
        body: z.string().min(1).describe('The message.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, role, body }) => {
      const t = store.directive(task_id, role as Role, body);
      return ok({ task: summarize(t) }, `Directive added to task #${t.seq}.`);
    },
  );

  server.registerTool(
    'bridge_cancel_task',
    {
      title: 'Cancel task (architect)',
      description: 'Withdraw a task from the board. Use when a brief is obsolete or superseded.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
        reason: z.string().optional().describe('Why it is being cancelled.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ task_id, reason }) => {
      const t = store.cancel(task_id, reason ?? '');
      return ok({ task: summarize(t) }, `Task #${t.seq} cancelled.`);
    },
  );

  // ── Worker tools ──────────────────────────────────────────────────
  server.registerTool(
    'bridge_claim_next',
    {
      title: 'Claim next task (worker)',
      description:
        'Take the next available brief for this role (highest priority, oldest first). Includes anything the architect sent back for changes. Returns the full task with its brief and event history, or reports that the board is clear.',
      inputSchema: {
        role: roleSchema.describe('Usually "worker".'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ role }) => {
      const t = store.claimNext(role as Role);
      if (!t) return ok({ task: null }, 'No open tasks. The board is clear.');
      return ok({ task: t }, `Claimed task #${t.seq} "${t.title}". Brief:\n\n${t.brief}`);
    },
  );

  server.registerTool(
    'bridge_post_progress',
    {
      title: 'Post progress (worker)',
      description: 'Report an update on a claimed task so the architect can observe without interrupting. Does not change task status.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
        role: roleSchema.describe('Usually "worker".'),
        body: z.string().min(1).describe('What you just did / what is next.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, role, body }) => {
      const t = store.progress(task_id, role as Role, body);
      return ok({ task: summarize(t) }, `Progress logged on task #${t.seq}.`);
    },
  );

  server.registerTool(
    'bridge_submit_result',
    {
      title: 'Submit result (worker)',
      description:
        'Hand a finished result back to the architect for review. Sets the task to "submitted". Put the outcome in `summary` and any concrete deliverables (files changed, commands run, diffs, links) in `artifacts`.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
        role: roleSchema.describe('Usually "worker".'),
        summary: z.string().min(1).describe('What was delivered and how it meets the brief.'),
        artifacts: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional()
          .describe('Optional structured deliverables, e.g. [{label:"file", value:"src/x.ts"}, {label:"pr", value:"https://…"}].'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, role, summary, artifacts }) => {
      const t = store.submit(task_id, role as Role, summary, artifacts);
      return ok({ task: summarize(t) }, `Task #${t.seq} submitted for review.`);
    },
  );

  server.registerTool(
    'bridge_report_blocker',
    {
      title: 'Report blocker (worker)',
      description: 'Flag that you cannot proceed and why. Sets the task to "blocked" so the architect can unblock or re-scope it.',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
        role: roleSchema.describe('Usually "worker".'),
        reason: z.string().min(1).describe('What is blocking you and what you need to continue.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, role, reason }) => {
      const t = store.block(task_id, role as Role, reason);
      return ok({ task: summarize(t) }, `Task #${t.seq} marked blocked.`);
    },
  );

  // ── Shared / observer tools ───────────────────────────────────────
  server.registerTool(
    'bridge_list_tasks',
    {
      title: 'List tasks',
      description: 'See the board. Optionally filter by status. Returns compact summaries, newest first.',
      inputSchema: {
        status: z
          .enum(['open', 'claimed', 'submitted', 'changes_requested', 'approved', 'blocked', 'cancelled'])
          .optional()
          .describe('Filter to one status. Omit for all.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      const tasks = store.listTasks(status ? { status: status as TaskStatus } : undefined).map(summarize);
      return ok({ count: tasks.length, tasks });
    },
  );

  server.registerTool(
    'bridge_get_task',
    {
      title: 'Get task detail',
      description: 'Fetch one task in full: brief, status, and the complete event timeline (directives, progress, submissions, reviews).',
      inputSchema: {
        task_id: z.string().describe('Task id or reference number.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task_id }) => {
      const t = store.getTask(task_id);
      return ok({ task: t });
    },
  );

  server.registerTool(
    'bridge_inbox',
    {
      title: 'Poll inbox',
      description:
        'Get events across all tasks that are newer than `since`, so you only see what changed while you were away. Scope to your role to get just the events you should act on: worker → new briefs/directives/reviews; architect → progress/submissions/blocks. Pass the ts of the last event you saw back as `since` on the next poll.',
      inputSchema: {
        role: roleSchema,
        since: z.string().optional().describe('ISO timestamp; only events strictly after this are returned. Omit on the first call to get recent history.'),
        limit: z.number().int().positive().max(200).optional().describe('Cap the number of events (most recent kept). Default: all.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ role, since, limit }) => {
      const forRole = role === 'observer' ? undefined : (role as Role);
      const events = store.inbox({ since, forRole, limit });
      const cursor = events.length ? events[events.length - 1].ts : since ?? null;
      return ok({ count: events.length, cursor, events });
    },
  );

  server.registerTool(
    'bridge_status',
    {
      title: 'Bridge status',
      description: 'Health check and board counts by status. Use to confirm the bridge is reachable and both sides are pointed at the same board.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const s = store.stats();
      return ok({ ok: true, board: DB_PATH, ...s });
    },
  );

  return server;
}

// ── Streamable HTTP (stateless) ─────────────────────────────────────
const app = express();
app.use(express.json({ limit: '4mb' }));

function unauthorized(res: Response) {
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: missing or bad Bearer token.' }, id: null });
}

app.post('/mcp', async (req: Request, res: Response) => {
  if (TOKEN) {
    const auth = req.header('authorization') ?? '';
    if (auth !== `Bearer ${TOKEN}`) return unauthorized(res);
  }
  // Fresh server + transport per request; stateless keeps two independent
  // apps from stepping on one another's session, while the shared Store keeps
  // their view of the board identical.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[bridge] request error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Stateless server: no long-lived SSE stream or session to resume.
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This bridge is stateless; use POST /mcp.' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'elle-agent-bridge', board: DB_PATH }));

app.listen(PORT, HOST, () => {
  console.error(`[bridge] elle-agent-bridge listening on http://${HOST}:${PORT}/mcp`);
  console.error(`[bridge] board: ${DB_PATH}`);
  if (!TOKEN) console.error('[bridge] no BRIDGE_TOKEN set — auth disabled (fine for localhost).');
});
