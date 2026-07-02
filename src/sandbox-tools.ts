// ============================================================
// ELLE — real code execution · src/sandbox-tools.ts
//
// Everything else Elle had for "coding" (code_engine, diagnose) was pure LLM
// text generation — she could write plausible code and plausible root-cause
// analysis with no way to check either was actually correct. This wires the
// Cloudflare Sandbox SDK (isolated container, Durable-Object-backed) so
// run_code actually EXECUTES and returns real stdout/stderr/exit code.
//
// DEPLOYMENT NOTE: this needs a [[containers]] block + Durable Object
// migration in wrangler.toml (added), Docker running locally for the first
// `wrangler dev`/`wrangler deploy` (which builds and pushes the container
// image), and Containers enabled on the Cloudflare account. None of that can
// be completed or verified from this environment — no Docker daemon, no
// wrangler auth. The code below typechecks against the real SDK types but
// is unverified at runtime until deployed.
// ============================================================

import { getSandbox } from '@cloudflare/sandbox';
import type { Sandbox } from '@cloudflare/sandbox';

export interface SandboxEnv {
  SANDBOX: DurableObjectNamespace<Sandbox>;
}

// One warm sandbox per isolate rather than one per call — a fresh container
// cold-start is multi-second, and router tool calls are typically several in
// a row within one question. Code execution is stateless/untrusted per call
// regardless (no secrets are ever passed into envVars below).
const SANDBOX_ID = 'elle-router-sandbox';

const SUPPORTED = new Set(['python', 'javascript', 'typescript']);

export async function runCode(
  code: string, language: string | undefined, env: SandboxEnv
): Promise<string> {
  if (!code || !code.trim()) return 'run_code: code required';
  const lang = SUPPORTED.has(String(language)) ? (language as 'python' | 'javascript' | 'typescript') : 'python';

  const sandbox = getSandbox(env.SANDBOX, SANDBOX_ID);
  const result = await sandbox.runCode(code, { language: lang, timeout: 20000 });

  const out: string[] = [];
  if (result.logs.stdout.length) out.push('stdout:\n' + result.logs.stdout.join(''));
  if (result.logs.stderr.length) out.push('stderr:\n' + result.logs.stderr.join(''));
  if (result.error) out.push(`ERROR: ${result.error.name}: ${result.error.message}\n${result.error.traceback.join('\n')}`);
  for (const r of result.results) {
    if (r.text) out.push(`result: ${r.text}`);
    else if (r.json !== undefined) out.push(`result (json): ${JSON.stringify(r.json)}`);
  }
  if (!out.length) return '(no output)';
  return out.join('\n\n');
}

// Raw shell command in the same sandbox — for when Elle needs to run a
// build/test command (npm test, tsc --noEmit) rather than eval a snippet.
export async function runShell(command: string, env: SandboxEnv): Promise<string> {
  if (!command || !command.trim()) return 'run_shell: command required';
  const sandbox = getSandbox(env.SANDBOX, SANDBOX_ID);
  const result = await sandbox.exec(command, { origin: 'user' });
  const parts = [`exit ${result.exitCode} (${result.success ? 'ok' : 'failed'}) in ${result.duration}ms`];
  if (result.stdout) parts.push('stdout:\n' + result.stdout);
  if (result.stderr) parts.push('stderr:\n' + result.stderr);
  return parts.join('\n\n');
}
