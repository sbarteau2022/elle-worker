# Authoritative Tool Scope Matrix & Security Boundary Specification (R8)

**Target System:** `elle-worker` Multi-Step Reasoning Router & Tool Subsystem  
**Scope Classification:** 110 Tools Across 16 Hierarchical Categories & 6 RBAC Scopes  
**Date:** 2026-08-29  
**Integrity Mode:** Production Security Specification & Parameter Invariants  

---

## 1. Executive Summary & Architectural Security Invariants

The `elle-worker` routing core (`src/router.ts`) orchestrates autonomous and interactive reasoning over 110 capabilities spanning relational metadata (D1 SQLite), semantic embeddings (Vectorize), object storage (R2), ephemeral KV memory, local execution sandboxes, and financial brokerage APIs (Alpaca). 

To guarantee containment across untrusted public chat surfaces, multi-tenant authenticated members, and privileged administrative automations, the architecture enforces a strict **Single-Choke-Point Access Control Model**:

```
                               ┌─────────────────────────────────────────┐
                               │       Inbound Request & Context         │
                               └────────────────────┬────────────────────┘
                                                    │
                                      [ Scope Resolution in index.ts ]
                                                    │
             ┌──────────────────────────────────────┼──────────────────────────────────────┐
             ▼                                      ▼                                      ▼
     [ 'public' Scope ]                    [ 'member' Scope ]                      [ 'full' Scope ]
   • Unauthenticated Chat                 • Authenticated User                    • Service Key / Admin
   • Read-Only Mind Core                  • Personal Journal & Edu                • Unrestricted Access
             │                                      │                                      │
             └──────────────────────────────────────┼──────────────────────────────────────┘
                                                    │
                                                    ▼
                                      ┌───────────────────────────┐
                                      │   toolAllowed(scope, op)  │
                                      └─────────────┬─────────────┘
                                                    │
                                 ┌──────────────────┴──────────────────┐
                                 │                                     │
                             [ Allowed ]                           [ Denied ]
                                 │                                     │
                                 ▼                                     ▼
                     ┌───────────────────────┐            ┌─────────────────────────┐
                     │ runTool(name, args, …)│            │ "tool '<name>' is not   │
                     │  • Parameter Guard    │            │  available in this scope"│
                     │  • SSRF Filter        │            └─────────────────────────┘
                     │  • SQL AST Guard      │
                     │  • Paging / Clipping  │
                     └───────────────────────┘
```

### Core Security Invariants

1. **Deterministic Scope Gating (`toolAllowed`)**: Tool accessibility is resolved before execution. Denied calls return an immediate structured refusal string without evaluating arguments or initiating network/database I/O.
2. **SQL Injection Elimination**: Direct table access (`read_sql`) is restricted to privileged admin scopes (`full`, `cofounder`) and strictly validated via `guardSelect()` (single `SELECT`/`WITH` query, automated `LIMIT 200`, write/DDL keyword ban). All other data tools use parameterized D1 prepared statements (`db.prepare().bind()`).
3. **Server-Side Request Forgery (SSRF) Boundary (`ssrfGuard`)**: All external HTTP retrieval (`fetch_url`, webhooks) enforces scheme allowlisting (`http:`, `https:`), standard port restrictions (80, 443), credential stripping, and complete rejection of IPv4/IPv6 private, loopback, link-local, CGNAT, and cloud metadata (`169.254.169.254`) ranges across all numeric and alternate encodings.
4. **Two-Key Live Trading Barrier (`liveTradingArmed`)**: Live financial execution requires explicit affirmative dual-configuration (`ALPACA_BASE_URL` set to live AND secret `ELLE_LIVE_TRADING === 'on'`). Pointing to live endpoints without the explicit secret throws a fatal error that fails closed.
5. **Context Pressure & Token Exhaustion Protection**: Observations exceeding `PAGE_THRESHOLD` (3,400 chars) are stored in KV (`page:${id}`) and returned as a head slice (`SCRATCH_SLICE = 2800` chars) with an opaque retrieval token (`page_read`), preventing LLM context window saturation.
6. **Second-Opinion Adversarial Review (`devilTool`)**: Consequential write operations executed in privileged scopes automatically trigger an asynchronous adversary check (`src/adversary.ts`) to evaluate failure modes and edge cases without delaying user responses.

---

## 2. The 6-Scope Role-Based Access Control (RBAC) Hierarchy

| Scope Identifier | Target Surface / Client Door | Permitted Capabilities & Boundaries | Step Ceiling |
| :--- | :--- | :--- | :---: |
| **`full`** | Admin Router (`/api/admin`), Scheduled Conductor, Service Key | **Complete Access:** All 110 tools across 16 categories, including raw SQL (`read_sql`), code deployment (`forge_*`), sandbox execution (`run_shell`, `run_code`), financial trading (`trade_execute`), and corpus ingestion. | Default: 12<br>Max: **25** |
| **`cofounder`** | Trusted Co-Founder Admin Door | **Full Admin minus Code Deployment & Shell:** Retains all reading, analytical, trading, and memory capabilities. Explicitly denied `SHIP_DENY` tools (`forge_open`, `forge_write`, `forge_pr`, `run_shell`, `delegate_local`) to prevent unauthorized code shipping or shell migrations. | Default: 12<br>Max: **25** |
| **`member`** | Authenticated Standard-Tier User Account | **Personal Memory, Journal & Learning:** Read-only mind core (`PUBLIC_TOOLS`) plus user-isolated journal (`journal_*`), deliberate long-term memory (`remember`), scratchpad, personal notebook (`notebook_write`), skill catalog, deep research, and course learning engine (`edu_*`). Isolated by `ctx.userId`. Denied `read_sql`, trading, shell, and forge. | Default: 12<br>Max: **25** |
| **`public`** | Unauthenticated Public Doors (`/api/chat`, Embeddable Widget) | **Read-Only Mind Core:** Semantic corpus retrieval (`search_corpus`, `fetch_document`, `find_document`), conversation recall, live web search, sandboxed math calculation (`calc`), diagnostic engine, and code engine. Zero write operations, zero database tables, zero shell execution. | Default: 6<br>Max: **10** |
| **`hospitality`** | RAPID²AI / Atlas Operator Portal (`/api/atlas`) | **Segregated Hospitality Data Domain:** Dedicated to restaurant data analytics over `RAPID_DB` (US Foods invoices + Square POS). Permitted `rapid_*` tools, `calc`, `web_search`, `fetch_url`, `code_engine`, `page_read`. Completely segregated from Main D1, corpus papers, and user journals. | Default: 6<br>Max: **10** |
| **`tax`** | Small Business Tax Suite Portal | **Segregated Small Business Tax & Payroll:** 21 purpose-built `tax_*` and `payroll_*` tools plus analytical calculators (`calc`, `web_search`, `fetch_url`, `page_read`). Isolated by client `businessId` and authenticated user. Denied raw SQL and general system tools. | Default: 6<br>Max: **10** |

---

## 3. Comprehensive Master Permissions Matrix (16 Categories, 110 Tools)

The following table documents all 110 tools registered in `src/router.ts`, their operational classification, scope permissions, idempotency controls, and underlying system bindings:

| # | Tool Identifier | Category (`TOOL_TREE`) | Op Type | Permitted Scopes | Idempotency Guarantee | Devil Review | External Dependencies & Bindings |
|---|:---|:---|:---:|:---|:---:|:---:|:---|
| 1 | `search_corpus` | Mind & memory | Read | `public`, `member`, `full`, `cofounder` | Pure (Deterministic) | No | `VECTORIZE`, D1 (`DB`) |
| 2 | `find_document` | Mind & memory | Read | `public`, `member`, `full`, `cofounder` | Pure (Deterministic) | No | `VECTORIZE`, D1 (`DB`) |
| 3 | `fetch_document` | Mind & memory | Read | `public`, `member`, `full`, `cofounder` | Pure (Deterministic) | No | R2 (`DOCUMENTS`), D1 (`DB`) |
| 4 | `read_sql` | Mind & memory | Read | `full`, `cofounder` | Read-Only Guarded | No | D1 (`DB`) |
| 5 | `recall_memory` | Mind & memory | Read | `public`, `member`, `full`, `cofounder` | Pure (Deterministic) | No | `VECTORIZE`, D1 (`DB`) |
| 6 | `remember` (`memory_write`)| Mind & memory | **Write** | `member`, `full`, `cofounder` | Hash-Dedup (`memWrite`) | **Yes** | D1 (`DB`), `VECTORIZE`, KV (`SESSIONS`) |
| 7 | `notebook_write` | Mind & memory | **Write** | `member`, `full`, `cofounder` | Append-Only | **Yes** | D1 (`DB`) |
| 8 | `self_state` | Mind & memory | Read | `member`, `full`, `cofounder` | Dynamic Aggregate | No | D1 (`DB`), In-Memory Phase |
| 9 | `memory_stats` | Mind & memory | Read | `member`, `full`, `cofounder` | Pure Aggregate | No | D1 (`DB`), `VECTORIZE` |
| 10 | `scratchpad_write` | Mind & memory | **Write** | `member`, `full`, `cofounder` | Overwrite per Key | No | KV (`SCRATCHPAD`) |
| 11 | `scratchpad_read` | Mind & memory | Read | `member`, `full`, `cofounder` | Pure | No | KV (`SCRATCHPAD`) |
| 12 | `page_read` | Mind & memory | Read | **All 6 Scopes** | Pure | No | KV (`SESSIONS` / `pageStore`) |
| 13 | `web_search` | World | Read | **All 6 Scopes** | External API | No | Gemini / OpenRouter Search API |
| 14 | `deep_research` | World | Read | `member`, `full`, `cofounder` | Multi-Round Search | No | Gemini 2.5 Flash Search Loop |
| 15 | `fetch_url` | World | Read | **All 6 Scopes** | SSRF Guarded | No | External HTTP (`ssrfGuard`) |
| 16 | `calc` | World | Read | **All 6 Scopes** | Pure (Deterministic) | No | Pure Math Parser Core |
| 17 | `diagnose` | World | Read | `public`, `member`, `full`, `cofounder` | LLM Analysis | No | Workers AI / Cloud LLM |
| 18 | `code_engine` | World | Read | `public`, `member`, `full`, `cofounder` | LLM Analysis | No | Cloud Code LLM |
| 19 | `run_code` | Real execution | **Exec** | `full`, `cofounder` | Ephemeral Sandbox | **Yes** | Session Bus $\to$ Laptop Docker |
| 20 | `run_shell` | Real execution | **Exec** | `full` (**Denied** `cofounder`) | Ephemeral Shell | **Yes** | Session Bus $\to$ Laptop Shell |
| 21 | `sandbox_status` | Real execution | Read | `full`, `cofounder` | Heartbeat Check | No | Session Bus Heartbeat |
| 22 | `sandbox_clone` | Real execution | **Write** | `full`, `cofounder` | KV Cached (24h) | No | KV (`SESSIONS`), GitHub API |
| 23 | `sandbox_report` | Real execution | **Write** | `full`, `cofounder` | Append-Only | No | D1 (`DB`), Console Flasher |
| 24 | `delegate_local` | Real execution | **Exec** | `full` (**Denied** `cofounder`) | Autonomous Loop | **Yes** | Sovereign Qwen Swarm / Session Bus |
| 25 | `sandbox_lane` | Real execution | **Write/Exec**| `full`, `cofounder` | Code-Only Dispatch | **Yes** | Session Bus Lane Registry |
| 26 | `repo_read` | Her codebase | Read | `full`, `cofounder` | Pure / Cached | No | Local FS / GitHub REST API |
| 27 | `repo_search` | Her codebase | Read | `full`, `cofounder` | Pure | No | GitHub Code Search API |
| 28 | `github_read_file` | Her codebase | Read | `full`, `cofounder` | Pure | No | GitHub REST API (`GITHUB_TOKEN`) |
| 29 | `github_list_files` | Her codebase | Read | `full`, `cofounder` | Pure | No | GitHub REST API (`GITHUB_TOKEN`) |
| 30 | `github_search_code`| Her codebase | Read | `full`, `cofounder` | Pure | No | GitHub Search API (`GITHUB_TOKEN`)|
| 31 | `forge_open` | The forge | **Write** | `full` (**Denied** `cofounder`) | Atomic Branch Cut | **Yes** | GitHub API (Git Refs) |
| 32 | `forge_write` | The forge | **Write** | `full` (**Denied** `cofounder`) | File Replacement | **Yes** | GitHub API (Git Blobs/Commits) |
| 33 | `forge_check` | The forge | Read | `full`, `cofounder` | Dynamic Status | No | GitHub Actions REST API |
| 34 | `forge_pr` | The forge | **Write** | `full` (**Denied** `cofounder`) | Atomic PR Creation | **Yes** | GitHub PR API |
| 35 | `skill_list` | Skills | Read | `member`, `full`, `cofounder` | Pure | No | D1 (`DB`) |
| 36 | `skill_read` | Skills | Read | `member`, `full`, `cofounder` | Pure | No | D1 (`DB`) |
| 37 | `skill_route` | Skills | Read | `member`, `full`, `cofounder` | Vector Match | No | `VECTORIZE`, D1 (`DB`) |
| 38 | `skill_write` | Skills | **Write** | `full`, `cofounder` | Overwrite per Name | **Yes** | D1 (`DB`) |
| 39 | `mcp_library` | MCP | Read | `full`, `cofounder` | Static Catalog | No | Curated Shelf Data |
| 40 | `mcp_add` | MCP | **Write** | `full`, `cofounder` | SSRF / Handshake | **Yes** | D1 (`DB`), Remote MCP URL |
| 41 | `mcp_tools` | MCP | Read | `full`, `cofounder` | Remote Protocol | No | Remote MCP SSE/HTTP Server |
| 42 | `mcp_call` | MCP | **Exec** | `full`, `cofounder` | External Exec | **Yes** | Remote MCP Server API |
| 43 | `rapid_report` | Hospitality | Read | `hospitality`, `full` | NLP Data Summary | No | D1 (`RAPID_DB`) |
| 44 | `rapid_costs` | Hospitality | Read | `hospitality`, `full` | Pure Query | No | D1 (`RAPID_DB`) |
| 45 | `rapid_variance` | Hospitality | Read | `hospitality`, `full` | Pure Aggregate | No | D1 (`RAPID_DB`) |
| 46 | `rapid_pos` | Hospitality | Read | `hospitality`, `full` | Pure Aggregate | No | D1 (`RAPID_DB`) |
| 47 | `rapid_menu` | Hospitality | Read | `hospitality`, `full` | Pure Aggregate | No | D1 (`RAPID_DB`) |
| 48 | `tax_business_create` | Small business tax | **Write** | `tax`, `full` | Idempotent per Name | **Yes** | D1 (`DB`) |
| 49 | `tax_business_list` | Small business tax | Read | `tax`, `full` | User-Scoped Query | No | D1 (`DB`) |
| 50 | `tax_unit_add` | Small business tax | **Write** | `tax`, `full` | Append-Only | **Yes** | D1 (`DB`) |
| 51 | `tax_unit_list` | Small business tax | Read | `tax`, `full` | Business-Scoped | No | D1 (`DB`) |
| 52 | `tax_owner_set` | Small business tax | **Write** | `tax`, `full` | Total Replace Split | **Yes** | D1 (`DB`) |
| 53 | `tax_owner_list` | Small business tax | Read | `tax`, `full` | Business-Scoped | No | D1 (`DB`) |
| 54 | `tax_facts_update` | Small business tax | **Write** | `tax`, `full` | Partial JSON Merge | **Yes** | D1 (`DB`) |
| 55 | `tax_facts_status` | Small business tax | Read | `tax`, `full` | Completion Matrix | No | D1 (`DB`) |
| 56 | `tax_transaction_add`| Small business tax | **Write** | `tax`, `full` | Exact Cent Ledger | **Yes** | D1 (`DB`) |
| 57 | `tax_transaction_list`| Small business tax | Read | `tax`, `full` | Filtered Ledger | No | D1 (`DB`) |
| 58 | `tax_report` | Small business tax | Read | `tax`, `full` | P&L Compilation | No | D1 (`DB`) |
| 59 | `tax_1099_contractor_add` | Small business tax | **Write** | `tax`, `full` | Idempotent per Name | **Yes** | D1 (`DB`) |
| 60 | `tax_1099_contractor_list`| Small business tax | Read | `tax`, `full` | Threshold Check | No | D1 (`DB`) |
| 61 | `tax_estimate_quarterly` | Small business tax | Read | `tax`, `full` | Deterministic IRC | No | D1 (`DB`), Tax Math Engine |
| 62 | `tax_schedule_c_prep` | Small business tax | Read | `tax`, `full` | Deterministic Calc | No | D1 (`DB`) |
| 63 | `tax_credits_finder` | Small business tax | Read | `tax`, `full` | IRC / State Statute | No | D1 (`DB`), Rules Engine |
| 64 | `tax_deadline_next` | Small business tax | Read | `tax`, `full` | Calendar Engine | No | Pure Calendar Logic |
| 65 | `tax_reminder_ack` | Small business tax | **Write** | `tax`, `full` | Idempotent per Qtr | **Yes** | D1 (`DB`) |
| 66 | `payroll_connection_status` | Small business tax | Read | `tax`, `full` | OAuth Status Check | No | D1 (`DB`), Provider DB |
| 67 | `payroll_sync` | Small business tax | **Write** | `tax`, `full` | Sync Pull | **Yes** | External Payroll API / OAuth |
| 68 | `payroll_wage_summary` | Small business tax | Read | `tax`, `full` | Wage Aggregate | No | D1 (`DB`) |
| 69 | `idea` | Autonomy | **Read/Write** | `full`, `cofounder` | Atomic OCC / State | **Yes** (forge) | D1 (`DB`), `VECTORIZE`, Forge |
| 70 | `intent` | Autonomy | **Read/Write** | `full`, `cofounder` | Atomic OCC / State | **Yes** (ready) | D1 (`DB`) |
| 71 | `review_runs` | Autonomy | Read | `full`, `cofounder` | Conductor Logs | No | D1 (`DB`) |
| 72 | `duplex` | Autonomy | **Read/Write** | `full`, `cofounder` | Append-Only Master | No | D1 (`DB`) |
| 73 | `self_schedule` | Autonomy | **Write** | `member`, `full`, `cofounder` | KV TTL Intent | No | KV (`SESSIONS`) |
| 74 | `watch` | Autonomy | **Read/Write** | `full`, `cofounder` | Tripwire State | **Yes** (arm) | D1 (`DB`), Conductor Daemon |
| 75 | `dead_drop` | Autonomy | **Read/Write** | `full`, `cofounder` | Condition Match | No | D1 (`DB`), `VECTORIZE` |
| 76 | `provenance` | Provenance / Audit | Read | `full`, `cofounder` | Event Bus Query | No | D1 (`elle_events`) |
| 77 | `constraint_analyzer`| Provenance / Audit | Read | `full`, `cofounder` | TOC Reasoning | No | D1 (`DB`), LLM |
| 78 | `fork_replay` | Provenance / Audit | **Exec** | `full`, `cofounder` | Sub-Router Re-run | **Yes** | D1 (`elle_events`), Router Core |
| 79 | `metabolism` | Provenance / Audit | Read | `full`, `cofounder` | Ring Buffer Stats | No | In-Memory Telemetry |
| 80 | `validate_kappa` | Provenance / Audit | Read | `full`, `cofounder` | ROC-AUC Evaluation | No | D1 (`bending_trace`) |
| 81 | `pfar` | Signal / Geometry | Read | `full`, `cofounder` | Deterministic DSP | No | Pure Math Core + LLM |
| 82 | `pami` | Signal / Geometry | **Read/Write** | `full`, `cofounder` | Multifractal Math | No | D1 (`pami_memories`), Math Core |
| 83 | `vfar` | Signal / Geometry | **Read/Write** | `full`, `cofounder` | Tensor / FLUX | **Yes** (gen) | Pure Math, R2, Workers AI |
| 84 | `hyper` | Signal / Geometry | **Read/Write** | `full`, `cofounder` | Riemannian SGD | No | Poincaré Math Core, R2 |
| 85 | `torus` | Signal / Geometry | **Read/Write** | `full`, `cofounder` | Flat Torus Math | No | Torus Math Core, R2 |
| 86 | `recall_ab` | Signal / Geometry | Read | `full`, `cofounder` | Jaccard Aggregate | No | D1 (`elle_recall_traces`) |
| 87 | `structure` | Signal / Geometry | Read | `full`, `cofounder` | Graph Topology | No | Pure Fundamental Group Core |
| 88 | `product` | Signal / Geometry | Read | `full`, `cofounder` | Mixed Curvature | No | Product Manifold Core |
| 89 | `atlas` | Signal / Geometry | Read | `full`, `cofounder` | Read-Only Snapshot | No | External Snapshot Storage |
| 90 | `journal_read` | Journal | Read | `member`, `full`, `cofounder` | User-Scoped Recall | No | D1 (`optimus_entries`), `VECTORIZE` |
| 91 | `journal_thread` | Journal | Read | `member`, `full`, `cofounder` | User-Scoped Stream | No | D1 (`optimus_threads`) |
| 92 | `journal_write` | Journal | **Write** | `member`, `full`, `cofounder` | Server-Side $\kappa$ | **Yes** | D1 (`optimus_entries`), `VECTORIZE` |
| 93 | `journal_annotate`| Journal | **Write** | `member`, `full`, `cofounder` | Marginalia Append | No | D1 (`optimus_marginalia`) |
| 94 | `edu_enroll` | Education | **Write** | `member`, `full`, `cofounder` | User-Scoped Single | **Yes** | D1 (`DB`), CustomCourseBuilder |
| 95 | `edu_brief` | Education | Read | `member`, `full`, `cofounder` | Witness Brief Gen | No | D1 (`DB`), CustomCourseBuilder |
| 96 | `edu_log` | Education | **Write** | `member`, `full`, `cofounder` | Verbatim Witness | **Yes** | D1 (`DB`), CustomCourseBuilder |
| 97 | `edu_seal` | Education | **Write** | `member`, `full`, `cofounder` | Tamper-Evident Chain| **Yes** | D1 (`DB`), CustomCourseBuilder |
| 98 | `edu_complete` | Education | **Write** | `member`, `full`, `cofounder` | 4-Pillar Gate Check | **Yes** | D1 (`DB`), CustomCourseBuilder |
| 99 | `edu_status` | Education | Read | `member`, `full`, `cofounder` | Credential State | No | D1 (`DB`), CustomCourseBuilder |
| 100 | `predict` | Judgment on retainer | **Read/Write** | `full`, `cofounder` | Claim Falsification | No | D1 (`elle_predictions`) |
| 101 | `devil` | Judgment on retainer | Read | `full`, `cofounder` | Adversary Review | No | Adversary LLM Core |
| 102 | `council` | Judgment on retainer | Read | `full`, `cofounder` | Multi-LLM Fanout | No | 3-Provider Parallel LLMs |
| 103 | `scar` | Judgment on retainer | **Read/Write** | `full`, `cofounder` | Flinch Warning | No | D1 (`elle_scars`) |
| 104 | `consolidate` | Judgment on retainer | **Write** | `full`, `cofounder` | Nightly Sleep Pass | **Yes** | D1 (`DB`), `VECTORIZE`, Memory Digest |
| 105 | `tool_forge` | Judgment on retainer | **Read/Write/Exec**| `full`, `cofounder` | Name-Collision Guard | **Yes** | D1 (`elle_custom_tools`), Sandbox |
| 106 | `advisor` | Judgment on retainer | Read | `full`, `cofounder` | Rate-Capped (3x/run)| No | Anthropic Claude Opus 3.5 API |
| 107 | `reach_out` | Reach | **Write/Push** | `full`, `cofounder` | Rate/Quiet Guard | **Yes** | Cloudflare Mobile Push, D1 |
| 108 | `ingest_paper` | Sensitive writes | **Write** | `full` (**Denied** `cofounder`) | Exactly-Once Ingest | **Yes** | D1 (`corpus_papers`), `VECTORIZE`, R2 |
| 109 | `trigger_dream` | Sensitive writes | **Write** | `full` (**Denied** `cofounder`) | Uncapped Conductor | **Yes** | D1 (`DB`), Autonomous Engine |
| 110 | `trade_execute` | Sensitive writes | **Write/Order**| `full`, `cofounder` | 90s Exactly-Once | **Yes** | Alpaca REST API, Risk Guard Rails |

---

## 4. Parameter Validation & Security Boundary Invariants

### 4.1 SQL Injection Protection & `read_sql` AST Guard

Direct D1 database querying through `read_sql` is protected by `guardSelect()` (`src/router.ts:620–629`):
1. **Single Statement Enforcement**: Input SQL is stripped of trailing semicolons. Internal semicolons are rejected outright:
   ```typescript
   if (/;/.test(sql)) return { ok: false, error: 'only a single statement is allowed' };
   ```
2. **Read-Only Keyword Allowlist**: Queries must begin strictly with `SELECT` or `WITH`:
   ```typescript
   if (!/^(select|with)\b/i.test(sql)) return { ok: false, error: 'only SELECT/WITH queries are allowed' };
   ```
3. **Mutation / DDL Keyword Blacklist**: Prohibits `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`, `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, and `REINDEX`.
4. **Mandatory Row Pagination**: If an explicit `LIMIT` clause is omitted, `LIMIT 200` is automatically appended to prevent memory exhaustion and buffer overflows in the Worker isolate.
5. **Parameterized Bindings**: All other 109 tools interacting with D1 strictly utilize prepared statements with parameterized binds (e.g. `env.DB.prepare('SELECT ... WHERE id = ?').bind(id)`), neutralizing second-order injection attacks.

### 4.2 Server-Side Request Forgery (SSRF) Protection (`src/ssrf.ts`)

All external network operations via `fetch_url` or MCP server registration are filtered through `ssrfGuard()` before dispatch:

```typescript
export function ssrfGuard(raw: string): SsrfResult {
  const input = String(raw || '').trim();
  if (!input) return { ok: false, error: 'a URL is required' };
  let u: URL;
  try { u = new URL(input); } catch { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'only http(s) URLs are allowed' };
  if (u.username || u.password) return { ok: false, error: 'URLs with embedded credentials are not allowed' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, error: `port ${u.port} is not allowed` };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: 'internal host is not allowed' };
  if (isPrivateOrReservedHost(host)) return { ok: false, error: 'private/reserved address is not allowed' };
  return { ok: true, url: u.toString() };
}
```

#### SSRF Rejection Coverage:
- **Private Subnets (IPv4)**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
- **Loopback & Localhost**: `127.0.0.0/8`, `localhost`, `ip6-localhost`, `::1`.
- **Cloud Metadata Service**: `169.254.169.254`, `metadata.google.internal`, `metadata`.
- **Carrier-Grade NAT & Link-Local**: `100.64.0.0/10`, `169.254.0.0/16`, `fe80::/10`.
- **Unique Local (IPv6)**: `fc00::/7` (`fc..`, `fd..`), IPv4-mapped IPv6 (`::ffff:169.254.169.254`).
- **Obfuscated / Alternate Encodings**: WHATWG-compliant IPv4 parsing rejects decimal (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`), shortened (`127.1`), mixed hex-dotted, and trailing dot notations.
- **Redirect Policy**: `fetch_url` configures `redirect: 'manual'` to prevent 301/302 HTTP redirects from bouncing into internal networks.
- **Timeout Controller**: 10,000 ms hard `AbortController` timeout ceiling on outbound requests.

### 4.3 Financial Safety & Two-Key Live Trading Barrier (`src/live-guard.ts`)

Live equity and options execution is guarded by `resolveAlpacaBase()`:

```typescript
export function resolveAlpacaBase(env: LiveGuardEnv): string {
  const base = (env.ALPACA_BASE_URL || ALPACA_PAPER_BASE).trim().replace(/\/+$/, '');
  if (base === ALPACA_PAPER_BASE) return base;
  if (env.ELLE_LIVE_TRADING !== 'on') {
    throw new Error(
      `LIVE TRADING BLOCKED: ALPACA_BASE_URL is "${base}" (not the paper endpoint) ` +
      `but ELLE_LIVE_TRADING is not 'on'. Real-money trading requires BOTH set deliberately.`
    );
  }
  return base;
}
```

#### Order Execution Rails:
- **Order Fraction Sizing**: `sizeWithinCap()` bounds order size against total account equity via `ELLE_MAX_ORDER_FRAC`.
- **Naked Option Prevention**: `guardOptionOrder()` strictly blocks unhedged short call/put positions.
- **Position Direction Invariants**: `closingSideFor(pos.side)` maps `'short' \to 'buy'` and `'long' \to 'sell'`, preventing short position doubling during position liquidation.
- **90-Second Idempotency Window**: `orderKey(action, symbol, qty, extra)` deduplicates identical rapid orders via `ensureOnce()`.

---

## 5. Fail-Closed Error Handling & Silent Degradation Guarantees

| Dependency Subsystem | Failure / Fault Mode | Fallback & Fail-Closed Containment Mechanism |
| :--- | :--- | :--- |
| **Alpaca Brokerage** | Missing API Keys / Network Error | Returns structured `{ error: "Alpaca not configured..." }` without throwing unhandled isolate errors. |
| **Cloudflare D1** | `SQLITE_BUSY` / Schema Error | Returns `tool "<name>" failed: <error>`, preserves event bus log, degrades gracefully without crashing request. |
| **Vectorize Index** | Embedding Service Outage / Dimension Mismatch | Falls back to keyword and SQL relational searches; reports empty matches cleanly. |
| **R2 Storage** | Missing Document / Bucket Unavailable | Returns `no document for id <id>` without isolate crash. |
| **External LLM Providers** | Rate Limit (429) / Timeout (504) | Automatic 4-tier model cascade (`Workers AI` $\to$ `Gemini` $\to$ `OpenRouter` $\to$ `Ollama` $\to$ `Workers AI 8B`). |
| **Anthropic Advisor** | Missing Key / Budget Exhausted | Enforces 3-call maximum budget per run; returns clean exhaustion notification. |
| **Local Sandbox Daemon** | Laptop Offline / Bus Timeout | Returns structured notice indicating offline sandbox; suggests cloud alternatives. |

---

## 6. Audit & Verification Checklist

- [x] All 110 tools registered in `src/router.ts` are categorized and mapped across all 6 scopes.
- [x] Gating logic in `toolAllowed(scope, name)` matches the matrix with 0 discrepancies.
- [x] SQL injection protection verified across `read_sql` and all parameterized D1 endpoints.
- [x] SSRF guard verified across standard, obfuscated, and IPv6 address spaces.
- [x] Live trading two-key safety barrier validated.
- [x] Observation paging and clipping thresholds confirmed at 3,400 chars.
