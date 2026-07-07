// ============================================================
// ELLE — the connect-back code sandbox · src/sandbox-agent.ts
//
// "Reach": Elle's mind lives in the cloud, her hands are on your laptop. A
// Cloudflare Worker cannot spawn a process and cannot dial into a machine
// behind NAT — so the laptop dials UP instead. The local Electron agent opens
// a WebSocket to  wss://<worker>/api/sandbox-agent/connect?key=<secret>  and
// keeps it open; this Durable Object authenticates it and holds that socket.
//
// From then on run_code / run_shell / sandbox_clone (see connect-sandbox.ts)
// reach back DOWN that same socket: the worker POSTs a job to /dispatch, this
// DO forwards it over the WebSocket, the laptop executes it on the real OS and
// sends the result back, and the awaiting /dispatch resolves. Correlation is by
// job id; the in-flight /dispatch fetch keeps the DO awake so the in-memory
// pending map is valid for the life of a request, while the idle connection
// hibernates cheaply between runs (acceptWebSocket).
//
// The DO is addressed by a single fixed name ("primary") — one operator, one
// box. "Is the path open?" == "is a socket connected and beating recently."
// ============================================================

import type { Env } from './index';

// ── wire protocol ───────────────────────────────────────────
export interface ExecJob {
  id: string;
  mode: 'code' | 'shell';
  code?: string;
  language?: string;
  command?: string;
  cwd?: string;
  timeout_ms: number;
}
export interface CloneJob {
  id: string;
  kind: 'path' | 'git';
  target: string;
  timeout_ms: number;
}
// The sovereign inference lane: the worker's router loop dispatches a
// GENERATION down the same socket run_code rides — the laptop's local Ollama
// thinks it for free and sends the text back. This is what gives the small
// model the SAME mind (same loop, same tools) as the cloud: only the
// inference moves; every tool call still executes worker-side.
export interface LlmJob {
  id: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  max_tokens: number;
  timeout_ms: number;
}

// server → agent
type ServerMsg =
  | { t: 'welcome'; heartbeat_ms: number }
  | ({ t: 'exec' } & ExecJob)
  | ({ t: 'clone' } & CloneJob)
  | ({ t: 'llm' } & LlmJob);

// agent → server
type AgentMsg =
  | { t: 'hello'; agent?: string; host?: string; platform?: string; root?: string }
  | { t: 'pong' }
  | { t: 'result'; id: string; stdout: string; stderr: string; exit: number; duration_ms: number; truncated?: boolean }
  | { t: 'clone_result'; id: string; ok: boolean; files?: Array<{ path: string; bytes: number }>; bundle?: string; language?: string; error?: string }
  | { t: 'llm_result'; id: string; ok: boolean; content?: string; model?: string; error?: string; duration_ms?: number };

export interface ExecResult { ok: boolean; stdout: string; stderr: string; exit: number; duration_ms: number; truncated?: boolean; path_open?: boolean; }
export interface CloneResult { ok: boolean; files?: Array<{ path: string; bytes: number }>; bundle?: string; language?: string; error?: string; path_open?: boolean; }
export interface LlmResult { ok: boolean; content?: string; model?: string; error?: string; duration_ms?: number; path_open?: boolean; }
export interface AgentStatus {
  open: boolean;
  meta?: { agent?: string; host?: string; platform?: string; root?: string; lastSeen?: number; since?: number };
}

const HEARTBEAT_MS = 30_000;
const STALE_MS = 90_000; // no beat within this window ⇒ the path is considered closed

type Pending = { resolve: (v: ExecResult | CloneResult | LlmResult) => void; timer: ReturnType<typeof setTimeout> };

export class SandboxAgent implements DurableObject {
  private pending = new Map<string, Pending>();

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;

    // The laptop dials in here and upgrades to a long-lived WebSocket.
    if (p.endsWith('/connect')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a WebSocket upgrade', { status: 426 });
      }
      const key = url.searchParams.get('key') || request.headers.get('x-sandbox-key') || '';
      const expected = this.env.SANDBOX_AGENT_KEY || '';
      if (!expected || key !== expected) return new Response('unauthorized', { status: 401 });

      const { 0: client, 1: server } = new WebSocketPair();
      this.state.acceptWebSocket(server); // hibernatable — cheap while idle
      await this.state.storage.put('since', Date.now());
      await this.state.storage.put('lastSeen', Date.now());
      try { server.send(JSON.stringify({ t: 'welcome', heartbeat_ms: HEARTBEAT_MS } satisfies ServerMsg)); } catch { /* client will retry */ }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (p.endsWith('/status')) {
      return this.jsonRes(await this.status());
    }

    if (p.endsWith('/dispatch')) {
      let job: { kind: 'exec' | 'clone' | 'llm'; payload: ExecJob | CloneJob | LlmJob };
      try { job = await request.json(); }
      catch { return this.jsonRes({ ok: false, error: 'bad dispatch body', path_open: false }); }
      return this.jsonRes(await this.dispatch(job));
    }

    return new Response('not found', { status: 404 });
  }

  private async status(): Promise<AgentStatus> {
    const sockets = this.state.getWebSockets();
    const lastSeen = (await this.state.storage.get<number>('lastSeen')) || 0;
    const since = (await this.state.storage.get<number>('since')) || 0;
    const meta = (await this.state.storage.get<Record<string, unknown>>('meta')) || {};
    const open = sockets.length > 0 && Date.now() - lastSeen < STALE_MS;
    return { open, meta: { ...meta, lastSeen, since } };
  }

  private async dispatch(
    job: { kind: 'exec' | 'clone' | 'llm'; payload: ExecJob | CloneJob | LlmJob },
  ): Promise<ExecResult | CloneResult | LlmResult> {
    const st = await this.status();
    const [ws] = this.state.getWebSockets();
    if (!st.open || !ws) {
      return { ok: false, stdout: '', stderr: 'sandbox path not open — laptop agent offline', exit: -1, duration_ms: 0, path_open: false };
    }
    const id = job.payload.id;
    const timeout = Math.min(Math.max(job.payload.timeout_ms || 60_000, 1_000), 600_000);
    const msg: ServerMsg =
      job.kind === 'exec'
        ? { t: 'exec', ...(job.payload as ExecJob) }
        : job.kind === 'clone'
          ? { t: 'clone', ...(job.payload as CloneJob) }
          : { t: 'llm', ...(job.payload as LlmJob) };

    return await new Promise<ExecResult | CloneResult | LlmResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, stdout: '', stderr: `sandbox timeout after ${timeout}ms`, exit: -1, duration_ms: timeout, path_open: true });
      }, timeout);
      this.pending.set(id, { resolve, timer });
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, stdout: '', stderr: `send failed: ${e instanceof Error ? e.message : String(e)}`, exit: -1, duration_ms: 0, path_open: false });
      }
    });
  }

  // ── WebSocket Hibernation handlers ─────────────────────────
  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let m: AgentMsg;
    try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return; }
    await this.state.storage.put('lastSeen', Date.now());

    if (m.t === 'hello') {
      await this.state.storage.put('meta', { agent: m.agent, host: m.host, platform: m.platform, root: m.root });
      return;
    }
    if (m.t === 'pong') return;

    if (m.t === 'result' || m.t === 'clone_result' || m.t === 'llm_result') {
      const pnd = this.pending.get(m.id);
      if (!pnd) return; // late / duplicate / already timed out
      clearTimeout(pnd.timer);
      this.pending.delete(m.id);
      if (m.t === 'result') {
        pnd.resolve({ ok: m.exit === 0, stdout: m.stdout, stderr: m.stderr, exit: m.exit, duration_ms: m.duration_ms, truncated: m.truncated, path_open: true });
      } else if (m.t === 'clone_result') {
        pnd.resolve({ ok: m.ok, files: m.files, bundle: m.bundle, language: m.language, error: m.error, path_open: true });
      } else {
        pnd.resolve({ ok: m.ok, content: m.content, model: m.model, error: m.error, duration_ms: m.duration_ms, path_open: true });
      }
    }
  }

  async webSocketClose(): Promise<void> { await this.onGone(); }
  async webSocketError(): Promise<void> { await this.onGone(); }

  private async onGone(): Promise<void> {
    await this.state.storage.put('lastSeen', 0);
    // Fail every in-flight job fast instead of waiting on its timeout.
    for (const [, pnd] of this.pending) {
      clearTimeout(pnd.timer);
      pnd.resolve({ ok: false, stdout: '', stderr: 'sandbox connection closed mid-run', exit: -1, duration_ms: 0, path_open: false });
    }
    this.pending.clear();
  }

  private jsonRes(v: unknown): Response {
    return new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  }
}
