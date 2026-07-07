// ============================================================
// THE LIVE WIRE — src/stream.ts
//
// SSE framing for the doors that stream. The admin router already streams
// (stream:true on /api/elle-router); the mobile door gives the same live wire
// to every authed member: run_start, each step the moment she commits to it,
// each observation as it lands, then one 'done' frame carrying the same
// payload the non-streaming endpoint returns — so a client can treat the
// stream as the JSON response arriving early, piece by piece.
//
// Factored here so the framing is testable as pure code: the frame format,
// the door lifecycle (frames → done → close, or error → close), and the
// done-payload parity with /api/elle-conversation's JSON shape.
// ============================================================

// The minimal slice of ExecutionContext the door needs — keeps tests honest
// (a fake { waitUntil } is a real implementation of this, not a cast).
export interface WaitsUntil { waitUntil(promise: Promise<unknown>): void }

export type SseSend = (event: string, data: unknown) => void;

// One wire frame. SSE spec: event line, data line (JSON — never contains a
// bare newline once stringified), blank line.
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// The member door's terminal frame — MUST stay key-for-key identical to the
// JSON body handleMindConversation returns, so a streaming client and a
// non-streaming client parse one shape. (content/response duplication is the
// endpoint's long-standing contract; both stay.)
export function memberDonePayload(
  out: { answer: string; steps?: unknown; kappa_dynamics?: unknown },
  sessionId: string,
): Record<string, unknown> {
  return {
    content:        out.answer,
    response:       out.answer,
    session_id:     sessionId,
    steps:          out.steps,
    kappa_dynamics: out.kappa_dynamics ?? null,
  };
}

// Open an SSE response and run the work behind it. The runner gets a send()
// that never throws (a dead client can't take the loop down); a throw from
// the runner becomes one 'error' frame; the stream always closes.
export function sseDoor(
  ctx: WaitsUntil,
  headers: Record<string, string>,
  run: (send: SseSend) => Promise<void>,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send: SseSend = (event, data) => { void writer.write(enc.encode(sseFrame(event, data))).catch(() => {}); };
  ctx.waitUntil((async () => {
    try {
      await run(send);
    } catch (e) {
      send('error', { error: (e as Error).message || 'stream failed' });
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })());
  return new Response(readable, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
