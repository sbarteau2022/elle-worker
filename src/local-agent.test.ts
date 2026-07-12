import { describe, it, expect } from 'vitest';
import { parseAction, runLoop, type LocalAgentDeps, type Msg } from './local-agent';

describe('parseAction', () => {
  it('parses a bare JSON action', () => {
    expect(parseAction('{"tool":"run_shell","command":"ls"}')).toEqual({ tool: 'run_shell', command: 'ls' });
  });
  it('pulls the action out of surrounding prose / fences', () => {
    const txt = 'Sure, let me look:\n```json\n{"tool":"run_code","code":"print(1)","language":"python"}\n```\n';
    expect(parseAction(txt)).toEqual({ tool: 'run_code', code: 'print(1)', language: 'python' });
  });
  it('is not fooled by braces inside strings', () => {
    expect(parseAction('{"tool":"run_shell","command":"echo \\"{}\\""}')).toEqual({ tool: 'run_shell', command: 'echo "{}"' });
  });
  it('returns null when there is no object with a tool field', () => {
    expect(parseAction('no json here')).toBeNull();
    expect(parseAction('{"notatool":1}')).toBeNull();
  });
});

// A scripted model: returns each queued response in turn.
function scriptedInfer(responses: string[]): LocalAgentDeps['infer'] {
  let i = 0;
  return async (_system: string, _messages: Msg[]) => {
    const content = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, content, model: 'test-local:3b' };
  };
}

describe('runLoop', () => {
  it('runs steps then stops on done, reporting success and step count', async () => {
    const shellCalls: string[] = [];
    const deps: LocalAgentDeps = {
      infer: scriptedInfer([
        '{"tool":"run_shell","command":"npm test"}',
        '{"tool":"done","summary":"tests pass"}',
      ]),
      runShell: async (c) => { shellCalls.push(c); return 'exit 0'; },
      runCode: async () => 'ok',
    };
    const res = await runLoop('get tests green', deps, 12);
    expect(res.ok).toBe(true);
    expect(res.stopped).toBe('done');
    expect(res.steps).toBe(2);
    expect(res.final).toBe('tests pass');
    expect(shellCalls).toEqual(['npm test']);
    expect(res.model).toBe('test-local:3b');
  });

  it('feeds observations back and routes run_code to the code dep', async () => {
    const codeSeen: Array<[string, string | undefined]> = [];
    const deps: LocalAgentDeps = {
      infer: scriptedInfer([
        '{"tool":"run_code","code":"print(2+2)","language":"python"}',
        '{"tool":"done","summary":"4"}',
      ]),
      runShell: async () => 'x',
      runCode: async (code, lang) => { codeSeen.push([code, lang]); return '4'; },
    };
    const res = await runLoop('compute', deps, 12);
    expect(res.ok).toBe(true);
    expect(codeSeen).toEqual([['print(2+2)', 'python']]);
  });

  it('stops at the step budget when the model never calls done', async () => {
    const deps: LocalAgentDeps = {
      infer: scriptedInfer(['{"tool":"run_shell","command":"true"}']), // forever
      runShell: async () => 'ok',
      runCode: async () => 'ok',
    };
    const res = await runLoop('loop', deps, 3);
    expect(res.ok).toBe(false);
    expect(res.stopped).toBe('budget');
    expect(res.steps).toBe(3);
  });

  it('nudges (does not crash) on a non-JSON turn, still counts the step', async () => {
    const deps: LocalAgentDeps = {
      infer: scriptedInfer([
        'I think I should run the tests.',            // no JSON → nudge
        '{"tool":"done","summary":"ok"}',
      ]),
      runShell: async () => 'ok',
      runCode: async () => 'ok',
    };
    const res = await runLoop('do', deps, 12);
    expect(res.ok).toBe(true);
    expect(res.steps).toBe(2);
  });

  it('surfaces a model error and stops', async () => {
    const deps: LocalAgentDeps = {
      infer: async () => ({ ok: false, error: 'sandbox path not open' }),
      runShell: async () => 'ok',
      runCode: async () => 'ok',
    };
    const res = await runLoop('do', deps, 12);
    expect(res.ok).toBe(false);
    expect(res.stopped).toBe('path_closed');
  });

  it('honors the deadline via an injected clock', async () => {
    let t = 0;
    const deps: LocalAgentDeps = {
      // jump the clock 20 minutes on the first infer so the deadline trips next check
      infer: async () => { t += 20 * 60_000; return { ok: true, content: '{"tool":"run_shell","command":"true"}' }; },
      runShell: async () => 'ok',
      runCode: async () => 'ok',
      now: () => t,
    };
    const res = await runLoop('do', deps, 12);
    expect(res.ok).toBe(false);
    expect(res.stopped).toBe('deadline');
  });
});
