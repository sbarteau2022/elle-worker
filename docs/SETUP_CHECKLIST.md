# elle-worker — setup checklist

Two lists, two different places. Putting a value in the wrong one silently does
nothing (see `CLAUDE.md`, "Configuration: where values actually go").

- **Column A — `wrangler.toml` switches.** Config vars. Edit the committed file.
  A plain var set in the Cloudflare dashboard is **wiped by the next deploy**.
- **Column B — Cloudflare secrets.** Dashboard (Workers → elle-worker →
  Settings → Variables and Secrets → Add → type **Secret**), or
  `wrangler secret put NAME`. Never in this repo, never in `wrangler.toml`.

Only **two** things are GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` and
`ELLE_SERVICE_KEY`. Everything else below goes to Cloudflare.

---

## Column A — `wrangler.toml` switches

### Already set (7 active `[vars]`) — nothing to do

`ENVIRONMENT` · `VENUE_ID` · `GOOGLE_OAUTH_REDIRECT` · `ATLAS_APP_URL` ·
`INGEST_URL` · `OBSERVER_AUTODRAIN_USER` · `ELLE_CONVICTION_ENFORCE`

### Required to flip — a feature is BROKEN without these

| Var | Flip it to | Without it |
|---|---|---|
| `QUICKBOOKS_REDIRECT_URI` | `https://elle-worker.sbarteau2022.workers.dev/api/payroll/callback` | QuickBooks OAuth **cannot complete** — client id + secret alone are not enough |
| `GUSTO_REDIRECT_URI` | same callback URL | Gusto OAuth **cannot complete** |
| `LLM_OLLAMA_URL` | `https://<your-ollama-host>` | Ollama lane stays off — this var has **no default** |

### Optional overrides — default shown; unset is a working default

| Var | Default | Changes |
|---|---|---|
| `LLM_MODEL_PRIMARY` | `meta-llama/llama-3.3-70b-instruct:free` | Primary lane model |
| `LLM_MODEL_FAST` | `meta-llama/llama-3.3-70b-instruct:free` | Fast lane model |
| `LLM_MODEL_CODE` | `qwen/qwen3-coder:free` | Code lane model |
| `LLM_MODEL_REASONING` | `gemini-2.5-flash` | Reasoning lane model |
| `LLM_MODEL_ADVISOR` | `claude-opus-5` | Advisor lane model |
| `LLM_MODEL_GROQ` | `llama-3.3-70b-versatile` | Groq fallback model |
| `LLM_MODEL_GITHUB` | `gpt-4o-mini` | GitHub Models fallback model |
| `LLM_MODEL_OLLAMA` | `llama3.3:70b` | Ollama model |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL |
| `LLM_GITHUB_MODELS_URL` | `https://models.inference.ai.azure.com/chat/completions` | GitHub Models endpoint |
| `ELLE_MAX_ORDER_FRAC` | `0.10` | Max fraction of equity per order |
| `ELLE_MAX_SYMBOL_FRAC` | `0.15` | Max fraction of equity per symbol |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | **Paper by default.** Live endpoint is refused unless `ELLE_LIVE_TRADING` = `on` |
| `SANDBOX_LLM_TIMEOUT_MS` | `180000` | Sandbox per-call LLM timeout (clamped 1k–600k) |
| `ELLE_LANE_PROTOCOL` | unset (v1) | Set `v2` for the live-routing cutover |
| `JOURNAL_INCLUDE_PRIOR_PROSE` | unset (true) | Set `false` to condition on threads alone |
| `FLOCK_IMAGE_PROVIDER` | `workers-ai` | `workers-ai` \| `sovereign` \| `auto` |
| `FLOCK_IMAGE_URL` | — | Sovereign image endpoint |
| `FLOCK_IMAGE_MODEL` | — | txt2img model id |
| `FLOCK_IMAGE_MODEL_EDIT` | — | img2img model id |
| `FLOCK_VIDEO_PROVIDER` | — | Video provider |
| `FLOCK_VIDEO_URL` | — | Text-to-video endpoint |
| `FLOCK_VIDEO_MODEL` | — | Video model id |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` | `sandbox` \| `production` |
| `GUSTO_ENVIRONMENT` | `demo` | `demo` \| `production` |

---

## Column B — Cloudflare secrets

### Required — the Worker is degraded or closed without these

| Secret | Purpose |
|---|---|
| `JWT_SECRET` | Signs/verifies user JWTs — login and every authed read, including enrollment |
| `ELLE_SERVICE_KEY` | Full-scope service bearer. **Also** a GitHub Actions secret — Cloudflare's copy verifies inbound calls, GitHub's authenticates CI calling in |
| `LLM_OPENROUTER_KEY` | Primary LLM lane |
| `LLM_GEMINI_KEY` | Gemini + Google Search grounding |

At least one LLM key is needed for real reasoning; with neither, it falls back
to the always-on Workers AI pool at reduced capability.

### Optional — each feature stays cleanly disabled ("not configured") until set

| Secret | Unlocks |
|---|---|
| `INGEST_API_TOKEN` | CRM intake → `rapid2ai-ingestion`. **Must match** the value on all 3 RAPID workers |
| `GOOGLE_CLIENT_ID` | Google sign-in allowlist |
| `GOOGLE_CLIENT_SECRET` | Atlas Google **business** OAuth — the only thing gating Atlas sign-in |
| `SANDBOX_AGENT_KEY` | Connect-back laptop sandbox. Must equal Elle web's `ELLE_SANDBOX_KEY`. Unset ⇒ sandbox doors 503 |
| `RESEND_API_KEY` | Contact-form email (form still logs without it) |
| `GITHUB_TOKEN` | GitHub corpus ops |
| `ALPACA_API_KEY` | Alpaca trading |
| `ALPACA_SECRET_KEY` | Alpaca trading |
| `ELLE_LIVE_TRADING` | Second key for real money — must be exactly `on` |
| `LLM_GROK_KEY` | xAI **Grok** fallback lane |
| `LLM_GROQ_KEY` | **Groq** fallback lane — different company from Grok, not a duplicate |
| `LLM_GITHUB_MODELS_KEY` | GitHub Models fallback lane |
| `LLM_OLLAMA_KEY` | Auth for a self-hosted Ollama, if it needs one |
| `ANTHROPIC_API_KEY` | Legacy/advisor Anthropic lane |
| `LLM_API_KEY` | Legacy generic OpenAI-compatible key (pairs with `LLM_BASE_URL`) |
| `FLOCK_IMAGE_KEY` | Bearer for a sovereign image endpoint |
| `FLOCK_VIDEO_KEY` | Bearer for a sovereign video endpoint |
| `PAYROLL_TOKEN_ENC_KEY` | **Gates ALL payroll.** AES-256, `openssl rand -base64 32` |
| `QUICKBOOKS_CLIENT_ID` | QuickBooks payroll OAuth |
| `QUICKBOOKS_CLIENT_SECRET` | QuickBooks payroll OAuth |
| `GUSTO_CLIENT_ID` | Gusto payroll OAuth |
| `GUSTO_CLIENT_SECRET` | Gusto payroll OAuth |
| `ADP_CLIENT_ID` | ADP payroll OAuth |
| `ADP_CLIENT_SECRET` | ADP payroll OAuth |

### Not a secret — cannot be typed into the dashboard

`ADP_MTLS_CERT` is an mTLS **certificate binding**, uploaded separately:

```bash
wrangler mtls-certificate upload --cert adp-cert.pem --key adp-key.pem
```

then add the returned id to `wrangler.toml` as `[[mtls_certificates]]`. Until
that exists, ADP connect/sync report "not configured" — the fail-closed default.

---

## Name traps

These have bitten this project. Exact strings only — a near-miss sets a value
nothing reads.

| Not this | This |
|---|---|
| `INGEST_API_KEY` | `INGEST_API_TOKEN` |
| `QUICKBOOK_CLIENT_ID` | `QUICKBOOKS_CLIENT_ID` (plural) |
| `QUICKBOOK_SECRET_ID` | `QUICKBOOKS_CLIENT_SECRET` |
| `GUSTO_SECRET_ID` | `GUSTO_CLIENT_SECRET` |
| `ADP_MLTS_CERT` | `ADP_MTLS_CERT` |
| `OLLAMA_BASE_MODEL` | `LLM_MODEL_OLLAMA` |

Belong to **other repos**, not elle-worker:

- `ATLAS_SERVICE_KEY` → Dynanic-Hyperbolic-Neural-Graph publisher scripts
- `VOYAGE_API_KEY` → Harmonizer (Vercel)
- `INGEST_TOKEN` → CustomCourseBuilder's own `POST /ingest` gate. Unrelated to
  `INGEST_API_TOKEN` despite the name

---

## Never set a placeholder

A Cloudflare secret cannot exist without a value — there is no "declared but
unset" state. Do not fill them with `CHANGEME` to reserve the name.

Every integration here is fail-closed on **truthiness**
(`if (!env.INGEST_API_TOKEN) return null`). A placeholder is truthy, so it
flips a cleanly-disabled feature into an enabled-and-failing one: auth attempts
against a garbage token, 401s, payroll decrypting with a fake key. Leaving a
secret unset is the correct, working state.
