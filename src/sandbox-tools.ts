// ============================================================
// ELLE — real code execution · src/sandbox-tools.ts  (DORMANT)
//
// This was wired to the Cloudflare Sandbox SDK (isolated container, Durable-
// Object-backed) so run_code/run_shell could actually EXECUTE and return real
// stdout/stderr/exit code. It is currently DORMANT and imports no SDK, because:
//
//   - Cloudflare Containers require a Docker image build at deploy time and a
//     Containers-enabled account. The Dockerfile.sandbox that shipped with the
//     SDK is a turbo/pnpm monorepo template (@repo/sandbox-container) that this
//     repo is not, so `wrangler deploy` failed on the image build on EVERY
//     push — blocking all deploys, not just this feature.
//
// With no SANDBOX binding in wrangler.toml, env.SANDBOX is undefined and the
// router's run_code/run_shell tools short-circuit to "SANDBOX binding not
// configured" (see router.ts) before these functions are ever reached. These
// stubs keep the tool surface + types stable so re-enabling is a small,
// contained change and nothing else in the worker has to move.
//
// Elle's real code execution meanwhile is the FORGE: she writes to an elle/*
// branch and CI runs the typecheck + tests. That path deploys and works today.
//
// TO RE-ENABLE: build a valid container image, re-add the [[containers]] +
// [[durable_objects.bindings]] + [[migrations]] blocks in wrangler.toml,
// restore the "@cloudflare/sandbox" dependency in package.json, and swap these
// stubs back to the SDK implementation (git history has it).
// ============================================================

// Kept generic so this module needs no external package. When the SANDBOX
// binding exists again, tighten this to DurableObjectNamespace<Sandbox>.
export interface SandboxEnv {
  SANDBOX: unknown;
}

const DISABLED =
  'run_code/run_shell: the container sandbox is not deployed on this worker. ' +
  'Use the forge (repo_read → forge_open → forge_write → forge_check) to write ' +
  'code and let CI execute it.';

export async function runCode(
  _code: string, _language: string | undefined, _env: SandboxEnv,
): Promise<string> {
  return DISABLED;
}

export async function runShell(_command: string, _env: SandboxEnv): Promise<string> {
  return DISABLED;
}
