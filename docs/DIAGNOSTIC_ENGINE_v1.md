# Diagnostic Engine — v1 Spec

**Posture:** Build. **Surface:** the error-diagnosis panel in the Elle×Atlas dev cockpit, backed by `POST /api/diagnose` on elle-worker.

## Thesis
The error *string* usually does not contain the *cause* (proven this session: a login failure whose real cause was a typo in a Pages env var — `sbartteau` vs `sbarteau`). So the engine's job is not to explain the string. It is to **diagnose the system, using the string as a symptom** — classify it, gather the relevant state, reason over it with the procedures we've documented, and hand back a fix that is on-process and (eventually) executable.

## Layers (and what's real in v1)
1. **Capture** — v1: paste an error into the console. v2: auto-capture from the xterm `wrangler tail` stream and Pages build-log on deploy failure.
2. **Classify** — deterministic heuristics (`classifyError`) → one of `build | deploy | config | runtime | data | auth | unknown`, plus the signal tokens that matched. Shown in the UI so the engine's reasoning is legible. **Real in v1.**
3. **Context (the moat)** — per-class live state via connectors (MCP where it exists, custom adapter for the Pages-logs gap). **Stubbed in v1** — the prompt carries our platform model + known gotchas; live infra calls land in v2.
4. **Diagnose** — `callLLM('reasoning', …)` (Gemini thinking, OpenRouter fallback) over `{error + class + context + skills}`, returns structured JSON. **Real in v1.**
5. **Solution as action** — v1 returns `actions[]` as typed suggestions (`deploy | patch_env | run_sql | edit_file | rerun | none`). v2 makes them executable behind the approve-loop.
6. **Memory** — v2/v3: index every diagnosis into Vectorize so repeat failures recall their prior fix.

## Contract
`POST /api/diagnose` (public in v1, like `/api/chat`; **moves behind auth in v2** when it gains live-infra context)

Request:
```json
{ "error": "<string, required>", "source": "build|deploy|runtime|config|data|auto", "context": "<optional free text>", "skills": "<optional SKILL.md/workflow text the cockpit injects>" }
```

Response:
```json
{
  "classification": { "primary": "config", "signals": ["env", "VITE_", "401"] },
  "root_cause": "…",
  "solution": "…",
  "actions": [ { "label": "Fix env var and redeploy", "kind": "patch_env", "detail": "…" } ],
  "confidence": "high|medium|low",
  "thinking": "…", "model": "…", "provider": "…"
}
```

## Why it earns its keep
The classifier + platform-aware prompt already beats a generic stack-trace explainer because it reasons in terms of *our* stack — Workers/Pages/D1, env-var typos, stale-commit builds, missing bindings, the MM-DD-YYYY date quirk, CORS from pages.dev. v2's live-state correlation is what makes it un-cloneable.
