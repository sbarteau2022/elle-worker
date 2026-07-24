// src/db/schema.ts
//
// Single source of truth for the Atlas & Elle worker's D1/SQLite schema.
//
// Historically every module carried its own ensure*/bootstrap* function, each
// with a duplicated `CREATE TABLE IF NOT EXISTS` block plus best-effort
// `ALTER TABLE ... ADD COLUMN` backfills wrapped in `.catch(() => {})` (so a
// "duplicate column" error on an already-migrated database is swallowed). That
// worked only because the CREATE-IF-NOT-EXISTS / swallowed-duplicate races
// happen to no-op — correct today, brittle long-term, and impossible to audit
// with the DDL smeared across ~30 files.
//
// `ensureAllSchemas(db)` is the one idempotent entry point that runs every
// CREATE TABLE / INDEX / TRIGGER and every same-table backfill. It is safe to
// call repeatedly and safe under the existing race. Each former per-module
// ensure*/bootstrap* function is now a thin shim delegating here, so every
// existing call site keeps working unchanged.
//
// The DDL below is a VERBATIM union of the per-module definitions. Nothing was
// renamed, retyped, dropped, or re-ordered within a table. Provenance for every
// statement is in SCHEMA-CONSOLIDATION.md.
//
// NOTE ON OUT-OF-BAND TABLES: `users`, `elle_trades`, and
// `elle_conversation_turns` are created out-of-band (no in-repo DDL). Their
// column backfills are therefore kept as separately-guarded helpers
// (backfillUsersColumns / backfillTradesExtColumns / backfillConvTurnKappa)
// invoked from their original call sites, NOT folded into ensureAllSchemas —
// folding an ALTER against a not-yet-created base table into a startup call
// would silently no-op-and-latch on a fresh database. See the report.

let allReady = false;

export async function ensureAllSchemas(db: D1Database): Promise<void> {
  if (allReady) return;

  // ── CREATE TABLE (idempotent). Batched: one transaction, fail-loud like the
  //    originals. Order is free — none of these carry FOREIGN KEY constraints. ──
  const creates: string[] = [
    // journal.ts
    `CREATE TABLE IF NOT EXISTS optimus_threads (
      id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT, title TEXT,
      anchor_topic TEXT, created_at INTEGER, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS optimus_entries (
      id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT,
      off_record INTEGER DEFAULT 0, kappa REAL, kappa_ts INTEGER,
      reserve REAL, velocity REAL, accel REAL, jerk REAL, anchor_distance REAL,
      vectorize_id TEXT, threads_json TEXT, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS optimus_marginalia (
      id TEXT PRIMARY KEY, entry_id TEXT, anchor_para INTEGER, note TEXT,
      off_record INTEGER DEFAULT 0, created_at INTEGER)`,
    // ideas.ts
    `CREATE TABLE IF NOT EXISTS elle_ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL, summary TEXT, details TEXT,
      status TEXT DEFAULT 'pondering',
      plan TEXT,
      clones TEXT DEFAULT '[]',
      refs TEXT DEFAULT '[]',
      spec_paper_id TEXT,
      intent_id TEXT,
      extend_count INTEGER DEFAULT 0,
      verdict TEXT,
      pfar TEXT,
      source TEXT DEFAULT 'elle',
      created_at INTEGER, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS elle_idea_log (
      id TEXT PRIMARY KEY, idea_id TEXT, stage TEXT, note TEXT, created_at INTEGER)`,
    // skills.ts
    `CREATE TABLE IF NOT EXISTS elle_skills (
    name TEXT PRIMARY KEY, description TEXT, body TEXT,
    source TEXT DEFAULT 'elle', uses INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER)`,
    // events.ts
    `CREATE TABLE IF NOT EXISTS elle_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_id TEXT,
    source TEXT,
    scope TEXT,
    step_index INTEGER,
    kind TEXT,
    tool TEXT,
    args TEXT,
    result_preview TEXT,
    duration_ms INTEGER,
    created_at INTEGER
  )`,
    // pami.ts
    `CREATE TABLE IF NOT EXISTS pami_memories (
    id TEXT PRIMARY KEY,
    index_json TEXT NOT NULL,
    content TEXT,
    created_at INTEGER
  )`,
    // war-room.ts
    `CREATE TABLE IF NOT EXISTS war_rounds (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mode TEXT NOT NULL,
    payload_json TEXT, key_json TEXT, response_json TEXT, score_json TEXT,
    created_at TEXT DEFAULT (datetime('now')), answered_at TEXT
  )`,
    // kappa-memory/schema.ts
    `CREATE TABLE IF NOT EXISTS bending_trace (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    perturbation  TEXT NOT NULL,
    response      TEXT NOT NULL,
    settling      TEXT NOT NULL,
    settled_open  INTEGER NOT NULL DEFAULT 0,
    r_estimate    REAL,
    kappa_traj    TEXT,
    reserve       REAL,
    velocity_peak REAL,
    kappa_provisional INTEGER NOT NULL DEFAULT 1,
    embedding_id  TEXT,
    source_mass   TEXT
  )`,
    // falcon.ts
    `CREATE TABLE IF NOT EXISTS falcon_analyses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, direction TEXT NOT NULL,
      tier1_json TEXT NOT NULL, tier2_json TEXT NOT NULL, validation_json TEXT,
      status TEXT DEFAULT 'complete', created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS falcon_ruptures (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, domain TEXT,
      rupture_json TEXT NOT NULL, discomfort_index INTEGER, first_thing_to_build TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS falcon_reasoning_log (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, step TEXT NOT NULL,
      chain TEXT NOT NULL, model TEXT, provider TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS falcon_outcomes (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE,
      what_was_built TEXT, comparison_to_rupture TEXT, founder_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`,
    // falcon.ts — the run queue. Enqueue is cheap (no LLM); a bounded drain
    // runs one queued direction per call and persists it, so the record on
    // file fills without a human clicking through the workbench.
    `CREATE TABLE IF NOT EXISTS falcon_queue (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, direction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', analysis_id TEXT, error TEXT, note TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`,
    // observer.ts — The Observer: Five-Axis structural analysis engine (the
    // historical/scientific sibling of the Falcon). status = complete | held.
    `CREATE TABLE IF NOT EXISTS observer_analyses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, anchor TEXT,
      dominant_json TEXT NOT NULL, counter_json TEXT NOT NULL, structural_json TEXT NOT NULL,
      dissent_json TEXT NOT NULL, prediction_json TEXT NOT NULL,
      status TEXT DEFAULT 'complete', created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS observer_reasoning_log (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, step TEXT NOT NULL,
      chain TEXT NOT NULL, model TEXT, provider TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS observer_outcomes (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE,
      what_happened TEXT, comparison_to_prediction TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS observer_queue (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, anchor TEXT,
      status TEXT NOT NULL DEFAULT 'queued', analysis_id TEXT, error TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`,
    // observer.ts (Rung 3) — the read-only trajectory instrument. Per-run κ
    // path over the five axes. provisional=1 always: nothing ranks or gates on
    // it (same discipline as the κ seam); it exists for the falsifier to score.
    `CREATE TABLE IF NOT EXISTS observer_trajectory (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL,
      kappa_traj_json TEXT NOT NULL, kappa_run REAL, field_held INTEGER,
      prediction_confidence TEXT, kappa_def TEXT, provisional INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // observer.ts — the REAL per-axis embeddings (production bge-large, via the
    // native Workers-AI binding). One row per analysis: the five axis vectors
    // that the coherence instrument (kappa_iso from path geometry) reads. Kept
    // in its own table so no ALTER is needed and a heavy vector blob never bloats
    // the trajectory row. Write is best-effort; an embedding failure never fails a run.
    `CREATE TABLE IF NOT EXISTS observer_embeddings (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE,
      model TEXT, dim INTEGER, embeddings_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // observer-blanket.ts — the nested-Markov-blanket model each run inferred
    // (the operator's NestedMarkovBlanketExtraction schema) + its prediction-time
    // COMPLETENESS score. Validated to predict prediction↔outcome fidelity far
    // better than trajectory coherence. Read-only; best-effort; gates nothing.
    `CREATE TABLE IF NOT EXISTS observer_blankets (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE,
      model_json TEXT NOT NULL, completeness REAL, n_blankets INTEGER, n_collisions INTEGER,
      alignment_status TEXT, created_at TEXT DEFAULT (datetime('now'))
    )`,
    // observer-live.ts — the ONLY uncontaminated validator of the completeness→
    // fidelity claim. Every retrospective test NULLed because the weights had
    // memorized the docket's endings; gated and ungated fidelity diverged by the
    // contamination gap. The escape is TIME: log a prediction on an OPEN case,
    // stamp the training cutoff, and let the world resolve it later. A row is
    // admissible only if t0 postdates the cutoff AND the outcome was undecided at
    // t0 (open + post-cutoff) — enforced at write time, so no memorized outcome
    // can enter. Mode A = the inferred topology (completeness sets the ceiling);
    // forecasts_json = the GATED forward sim (each forecast's driver must already
    // be a named agent — the gate that keeps recall out). Scored at resolution:
    // mode_a_completeness (ceiling) and gated_fidelity (did we hit it), separately.
    `CREATE TABLE IF NOT EXISTS observer_predictions_live (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE, case_title TEXT,
      t0 TEXT NOT NULL, model_id TEXT NOT NULL, training_cutoff TEXT NOT NULL, resolution_due TEXT NOT NULL,
      admissible INTEGER NOT NULL DEFAULT 0, admit_reason TEXT,
      topology_json TEXT NOT NULL, mode_a_completeness REAL, n_agents INTEGER,
      forecasts_json TEXT NOT NULL, n_forecasts INTEGER, n_refused INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      outcomes_json TEXT, gated_fidelity REAL, free_energy REAL, resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // lattice.ts — The Lattice: 32-axis security deduction engine
    `CREATE TABLE IF NOT EXISTS lattice_analyses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, incident TEXT NOT NULL,
      seed_json TEXT NOT NULL, flower_json TEXT NOT NULL, fruit_json TEXT NOT NULL, validation_json TEXT,
      status TEXT DEFAULT 'complete', created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS lattice_reckonings (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, incident_summary TEXT,
      reckoning_json TEXT NOT NULL, posture TEXT, action TEXT, breach_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS lattice_reasoning_log (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, step TEXT NOT NULL,
      chain TEXT NOT NULL, model TEXT, provider TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // router-idempotency.ts
    `CREATE TABLE IF NOT EXISTS elle_idempotency (
    key         TEXT PRIMARY KEY,
    tool        TEXT NOT NULL,
    result_json TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    // scars.ts
    `CREATE TABLE IF NOT EXISTS elle_scars (
    id TEXT PRIMARY KEY,
    tool TEXT,
    pattern TEXT NOT NULL,
    wound TEXT NOT NULL,
    hits INTEGER DEFAULT 0,
    source TEXT DEFAULT 'router',
    created_at INTEGER
  )`,
    // memory.ts
    `CREATE TABLE IF NOT EXISTS elle_recall_traces (
    id TEXT PRIMARY KEY,
    created_at INTEGER,
    session_id TEXT,
    query_preview TEXT,
    semantic_count INTEGER,
    base_top TEXT,
    boost_top TEXT,
    divergence REAL,
    set_divergence REAL,
    boost REAL
  )`,
    // forge-loop.ts / tool-forge.ts (same table; forge-loop is the superset)
    `CREATE TABLE IF NOT EXISTS elle_custom_tools (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    args_hint TEXT,
    language TEXT DEFAULT 'python',
    code TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    runs INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER
  )`,
    // conductor.ts
    `CREATE TABLE IF NOT EXISTS elle_intents (
      id TEXT PRIMARY KEY, title TEXT, goal TEXT,
      status TEXT DEFAULT 'proposed', priority INTEGER DEFAULT 5,
      source TEXT DEFAULT 'stewart', created_at INTEGER, updated_at INTEGER,
      last_run_at INTEGER, runs INTEGER DEFAULT 0, last_outcome TEXT)`,
    `CREATE TABLE IF NOT EXISTS elle_runs (
      id TEXT PRIMARY KEY, intent_id TEXT, kind TEXT,
      started_at INTEGER, finished_at INTEGER, steps INTEGER,
      outcome TEXT, trace_json TEXT)`,
    // mcp.ts
    `CREATE TABLE IF NOT EXISTS elle_mcp_servers (
    name TEXT PRIMARY KEY, url TEXT NOT NULL, auth_token TEXT,
    enabled INTEGER DEFAULT 1, added_at INTEGER)`,
    // router.ts
    `CREATE TABLE IF NOT EXISTS elle_notebook (
       id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
       title TEXT NOT NULL, body TEXT NOT NULL, mood TEXT,
       tags TEXT DEFAULT '[]', source TEXT DEFAULT 'router',
       created_at TEXT DEFAULT (datetime('now')))`,
    // madmind.ts
    `CREATE TABLE IF NOT EXISTS madmind_submissions (
      id TEXT PRIMARY KEY, author_id TEXT, author_email TEXT, byline TEXT,
      title TEXT, abstract TEXT, body TEXT, keywords TEXT,
      status TEXT DEFAULT 'submitted', created_at INTEGER)`,
    // duplex.ts
    `CREATE TABLE IF NOT EXISTS elle_duplex_ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    speaker TEXT NOT NULL CHECK (speaker IN ('sovereign','cloud')),
    kind TEXT NOT NULL DEFAULT 'say' CHECK (kind IN ('say','observe')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL)`,
    // constraint.ts
    `CREATE TABLE IF NOT EXISTS elle_constraint_log (
    id TEXT PRIMARY KEY, objective TEXT, bottleneck TEXT, confidence REAL,
    missing_information TEXT, suggested_next_action TEXT, created_at INTEGER)`,
    // consolidate.ts
    `CREATE TABLE IF NOT EXISTS elle_consolidation_log (
    id TEXT PRIMARY KEY, ran_at INTEGER,
    turns_read INTEGER, errors_read INTEGER,
    memories_written INTEGER, skills_written INTEGER, scars_written INTEGER,
    digest TEXT
  )`,
    // dead-drop.ts
    `CREATE TABLE IF NOT EXISTS elle_dead_drops (
    id TEXT PRIMARY KEY,
    trigger_text TEXT NOT NULL,
    message TEXT NOT NULL,
    embedding TEXT,
    status TEXT DEFAULT 'armed',
    fired_at INTEGER,
    created_at INTEGER
  )`,
    // watches.ts
    `CREATE TABLE IF NOT EXISTS elle_watches (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    check_tool TEXT NOT NULL,
    check_args TEXT NOT NULL,
    condition TEXT NOT NULL,
    action_goal TEXT NOT NULL,
    recurring INTEGER DEFAULT 0,
    status TEXT DEFAULT 'armed',
    last_checked INTEGER,
    fires INTEGER DEFAULT 0,
    created_at INTEGER
  )`,
    // profiles.ts
    `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    profile TEXT,
    updated_at INTEGER
  )`,
    // atlas-clients.ts — self-serve RAPID/Atlas hospitality accounts. One row
    // per client user; venue_id is the tenant key every rapid_* query scopes
    // by (rows in rapid2ai-db land under it). UNIQUE so two clients can never
    // share a venue by accident.
    `CREATE TABLE IF NOT EXISTS atlas_clients (
    user_id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL UNIQUE,
    company_name TEXT NOT NULL,
    venue_name TEXT,
    pos_provider TEXT,
    vendors TEXT,
    contact_phone TEXT,
    address TEXT,
    status TEXT DEFAULT 'onboarding',
    onboarding_intent_id TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`,
    // push.ts
    `CREATE TABLE IF NOT EXISTS push_devices (
      user_id TEXT NOT NULL,
      expo_token TEXT NOT NULL,
      platform TEXT,
      created_at INTEGER,
      PRIMARY KEY (user_id, expo_token)
    )`,
    `CREATE TABLE IF NOT EXISTS reach_outs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason_kind TEXT NOT NULL,
      reason_ref TEXT,
      body TEXT NOT NULL,
      sent_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY,
      reach_budget_per_week INTEGER DEFAULT 2,
      quiet_start INTEGER DEFAULT 22,
      quiet_end INTEGER DEFAULT 8,
      tz TEXT DEFAULT 'America/Chicago'
    )`,
    // connect-sandbox.ts
    `CREATE TABLE IF NOT EXISTS elle_sandbox_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT, session_id TEXT, source TEXT, user_id TEXT,
    kind TEXT,
    language TEXT, command TEXT, code_preview TEXT,
    target TEXT, clone_key TEXT,
    exit INTEGER, stdout_preview TEXT, stderr_preview TEXT,
    ok INTEGER, path_open INTEGER, duration_ms INTEGER, created_at INTEGER
  )`,
    `CREATE TABLE IF NOT EXISTS elle_sandbox_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT, session_id TEXT, user_id TEXT,
    title TEXT, body TEXT,
    seen INTEGER DEFAULT 0, created_at INTEGER
  )`,
    // local-agent.ts — the second brain's use report: one row per delegation
    // (goal handed down by the cloud brain → the local model's autonomous run).
    `CREATE TABLE IF NOT EXISTS elle_delegations (
    id TEXT PRIMARY KEY,
    run_id TEXT, session_id TEXT, user_id TEXT, source TEXT,
    goal TEXT, model TEXT,
    steps INTEGER, ok INTEGER,
    final TEXT, transcript TEXT,
    duration_ms INTEGER, created_at INTEGER
  )`,
    // oracle.ts
    `CREATE TABLE IF NOT EXISTS elle_predictions (
    id TEXT PRIMARY KEY,
    claim TEXT NOT NULL,
    confidence REAL NOT NULL,
    resolve_by INTEGER NOT NULL,
    status TEXT DEFAULT 'open',
    resolution_note TEXT,
    resolved_at INTEGER,
    source TEXT DEFAULT 'router',
    created_at INTEGER
  )`,
    // forge.ts
    `CREATE TABLE IF NOT EXISTS elle_code_tasks (
    id TEXT PRIMARY KEY, repo TEXT, branch TEXT, base_branch TEXT,
    title TEXT, goal TEXT, status TEXT DEFAULT 'open',
    pr_number INTEGER, commits INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER)`,
    // law.ts (bootstrapLawSchema) — created before war-room's ALTERs run
    `CREATE TABLE IF NOT EXISTS duels (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, opponent TEXT DEFAULT 'Cerberus-03', scenario TEXT NOT NULL, question_type TEXT DEFAULT 'Necessary Assumption', status TEXT DEFAULT 'active', result TEXT, score_composure REAL, score_recognition REAL, score_walkback REAL, score_framework REAL, synthesis TEXT, created_at TEXT DEFAULT (datetime('now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS duel_turns (id TEXT PRIMARY KEY, duel_id TEXT NOT NULL, n INTEGER NOT NULL, side TEXT NOT NULL, text TEXT NOT NULL, composure REAL DEFAULT 0.75, tactic_src TEXT, tactic_ref TEXT, tactic_name TEXT, tactic_fallacy TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS law_threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT DEFAULT '', status TEXT DEFAULT 'open', last_elle_note TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS doctrine_mastery (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, law_n TEXT NOT NULL, mastery REAL DEFAULT 0, deployment_count INTEGER DEFAULT 0, times_recognized INTEGER DEFAULT 0, UNIQUE(user_id,source,law_n))`,
    `CREATE TABLE IF NOT EXISTS tutor_questions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, question_type TEXT NOT NULL, axis TEXT NOT NULL, difficulty INTEGER DEFAULT 2, stimulus TEXT NOT NULL, question TEXT NOT NULL, choices_json TEXT NOT NULL, correct_key TEXT NOT NULL, explanation TEXT NOT NULL, scaffolding TEXT NOT NULL, selected_key TEXT, axis_delta INTEGER DEFAULT 0, answered_at TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS user_stats (user_id TEXT PRIMARY KEY, lsat_score INTEGER DEFAULT 155, streak_days INTEGER DEFAULT 0, total_sessions INTEGER DEFAULT 0, last_session TEXT, updated_at TEXT DEFAULT (datetime('now')))`,
    // libre.ts (bootstrapLibreSchema)
    `CREATE TABLE IF NOT EXISTS elle_sandbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL,
      genesis TEXT NOT NULL,
      content TEXT NOT NULL,
      surface_priority INTEGER DEFAULT 5,
      surfaced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      run_n INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS elle_libre_log (
      id TEXT PRIMARY KEY,
      run_at TEXT DEFAULT (datetime('now')),
      curiosity_seed TEXT,
      research_queries TEXT,
      artifact_id TEXT,
      notes TEXT
    )`,
    // graph.ts (CloudGraphStore.ensureSchema)
    `CREATE TABLE IF NOT EXISTS elle_memory_edges (
      id TEXT PRIMARY KEY,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      kind TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      run_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT,
      UNIQUE(src, dst, kind)
    )`,
    // metabolism.ts (recordLLMCall)
    `CREATE TABLE IF NOT EXISTS elle_llm_calls (
          id TEXT PRIMARY KEY, task TEXT, provider TEXT, model TEXT,
          ms INTEGER, ok INTEGER, created_at INTEGER,
          tokens_in INTEGER, tokens_out INTEGER
        )`,
    // trading.ts (fresh environments; production has these out-of-band)
    `CREATE TABLE IF NOT EXISTS elle_market_observations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    symbol TEXT, observation TEXT NOT NULL, what_is_suppressed TEXT,
    signal_type TEXT, confidence REAL, acted_on INTEGER DEFAULT 0,
    observed_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS elle_trading_journal (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    journal_date TEXT UNIQUE NOT NULL, starting_value REAL, ending_value REAL,
    daily_pnl REAL, daily_return_pct REAL, trades_today INTEGER DEFAULT 0,
    observations_today INTEGER DEFAULT 0, what_happened TEXT, what_she_learned TEXT,
    what_she_got_wrong TEXT, what_surprised_her TEXT, philosophical_insight TEXT,
    hypothesis_for_tomorrow TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    // security-network.ts — the adversarial security network's event ledger.
    // One row per classified signal (auth failures, SSRF blocks, cyber.ts
    // findings, malware hits); actor posture itself lives in KV (SESSIONS,
    // decaying score) so the hot path never waits on D1.
    `CREATE TABLE IF NOT EXISTS elle_security_events (
    id TEXT PRIMARY KEY, actor_key TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL,
    tactic_ids TEXT DEFAULT '', severity_weight INTEGER DEFAULT 1, posture TEXT DEFAULT 'normal',
    detail TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  ];
  await db.batch(creates.map((s) => db.prepare(s)));

  // ── Indexes, column backfills, and triggers. All best-effort/idempotent:
  //    CREATE INDEX/TRIGGER IF NOT EXISTS, and ALTER ... ADD COLUMN whose
  //    "duplicate column" on an already-migrated DB is expected and swallowed.
  //    Every ALTER here targets a table created in the batch above. ──
  const extras: string[] = [
    // ideas.ts
    `CREATE INDEX IF NOT EXISTS idx_ideas_status ON elle_ideas(status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_idea_log ON elle_idea_log(idea_id, created_at DESC)`,
    `ALTER TABLE elle_ideas ADD COLUMN forge_spec TEXT`,
    // skills.ts
    `ALTER TABLE elle_skills ADD COLUMN embedding TEXT`,
    // events.ts
    `CREATE INDEX IF NOT EXISTS idx_events_run ON elle_events(run_id, step_index)`,
    `CREATE INDEX IF NOT EXISTS idx_events_time ON elle_events(created_at DESC)`,
    // falcon.ts / observer.ts — drain picks the oldest queued row for a user
    `CREATE INDEX IF NOT EXISTS idx_falcon_queue ON falcon_queue(user_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_observer_queue ON observer_queue(user_id, status, created_at)`,
    // kappa-memory/schema.ts
    `CREATE INDEX IF NOT EXISTS idx_trace_thread  ON bending_trace(thread_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_trace_reserve ON bending_trace(reserve)`,
    `CREATE INDEX IF NOT EXISTS idx_trace_open    ON bending_trace(settled_open)`,
    // journal.ts
    `ALTER TABLE optimus_entries ADD COLUMN threads_json TEXT`,
    `ALTER TABLE optimus_entries ADD COLUMN jerk REAL`,
    // Which κ formula produced this row's kappa. NULL = legacy v1 (the formula
    // with the 0.5 fixed point) — series reads filter to tagged rows so finite
    // differences never straddle a definition change.
    `ALTER TABLE optimus_entries ADD COLUMN kappa_def TEXT`,
    // conductor.ts
    `CREATE INDEX IF NOT EXISTS elle_runs_started ON elle_runs (started_at DESC)`,
    `ALTER TABLE elle_intents ADD COLUMN draft TEXT`,
    // Stall breaker: consecutive forge ticks that changed nothing. Reset to 0
    // on any real state change; at FORGE_STALL_TICKS the task → 'stalled'.
    `ALTER TABLE elle_code_tasks ADD COLUMN noop_ticks INTEGER DEFAULT 0`,
    // forge-loop.ts (extends elle_custom_tools beyond tool-forge.ts's base)
    `ALTER TABLE elle_custom_tools ADD COLUMN goals TEXT`,
    `ALTER TABLE elle_custom_tools ADD COLUMN forge_status TEXT`,
    `ALTER TABLE elle_custom_tools ADD COLUMN review_notes TEXT`,
    `ALTER TABLE elle_custom_tools ADD COLUMN iterations INTEGER DEFAULT 0`,
    `ALTER TABLE elle_custom_tools ADD COLUMN pr_number INTEGER`,
    `ALTER TABLE elle_custom_tools ADD COLUMN pr_url TEXT`,
    `ALTER TABLE elle_custom_tools ADD COLUMN last_run_id TEXT`,
    // madmind.ts
    `CREATE INDEX IF NOT EXISTS madmind_sub_created ON madmind_submissions (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS madmind_sub_author ON madmind_submissions (author_id)`,
    // duplex.ts (append-only guard triggers)
    `CREATE TRIGGER IF NOT EXISTS duplex_no_update
    BEFORE UPDATE ON elle_duplex_ledger
    BEGIN SELECT RAISE(ABORT, 'the duplex master copy is append-only'); END`,
    `CREATE TRIGGER IF NOT EXISTS duplex_no_delete
    BEFORE DELETE ON elle_duplex_ledger
    BEGIN SELECT RAISE(ABORT, 'the duplex master copy is append-only'); END`,
    // profiles.ts
    `CREATE INDEX IF NOT EXISTS idx_profiles_email ON user_profiles(email)`,
    // push.ts
    `CREATE INDEX IF NOT EXISTS idx_reach_outs_user ON reach_outs (user_id, sent_at DESC)`,
    // connect-sandbox.ts
    `CREATE INDEX IF NOT EXISTS idx_sandbox_time ON elle_sandbox_runs(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sandbox_run ON elle_sandbox_runs(run_id)`,
    `ALTER TABLE elle_sandbox_runs ADD COLUMN title TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_sandbox_reports_time ON elle_sandbox_reports(created_at DESC)`,
    // local-agent.ts
    `CREATE INDEX IF NOT EXISTS idx_delegations_time ON elle_delegations(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_delegations_run ON elle_delegations(run_id)`,
    // oracle.ts
    `CREATE INDEX IF NOT EXISTS idx_predictions_due ON elle_predictions(status, resolve_by)`,
    // law.ts (κ telemetry backfill on duels)
    `ALTER TABLE duels ADD COLUMN kappa_json TEXT`,
    `ALTER TABLE duels ADD COLUMN tilt_turn INTEGER`,
    // war-room.ts (guarded column adds on the pre-existing duel tables)
    `ALTER TABLE duels ADD COLUMN rung INTEGER`,
    `ALTER TABLE duels ADD COLUMN autopsy_json TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic_id TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic_valence TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic2_id TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN called_tactic TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN called_valence TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN call_name_correct INTEGER`,
    `ALTER TABLE duel_turns ADD COLUMN call_valence_correct INTEGER`,
    // graph.ts
    `CREATE INDEX IF NOT EXISTS idx_edges_src ON elle_memory_edges(src, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_edges_dst ON elle_memory_edges(dst, kind)`,
    // metabolism.ts — token usage on pre-existing elle_llm_calls tables. NULL on
    // rows written before the columns existed (or by providers that report none).
    `ALTER TABLE elle_llm_calls ADD COLUMN tokens_in INTEGER`,
    `ALTER TABLE elle_llm_calls ADD COLUMN tokens_out INTEGER`,
    // security-network.ts
    `CREATE INDEX IF NOT EXISTS idx_security_events_time ON elle_security_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_security_events_actor ON elle_security_events(actor_key)`,
    // falcon.ts — the Material Ground. A run cannot fire without grounding, so
    // every persisted analysis carries the cited evidence it was built on:
    // material_ground_json (findings + sources + corpus look-back), grounded=1
    // (there is no ungrounded run on file), n_sources, and blanket_json (the
    // nested-Markov-blanket world-model Tier 2 read the human agents through).
    `ALTER TABLE falcon_analyses ADD COLUMN material_ground_json TEXT`,
    `ALTER TABLE falcon_analyses ADD COLUMN grounded INTEGER DEFAULT 0`,
    `ALTER TABLE falcon_analyses ADD COLUMN n_sources INTEGER`,
    `ALTER TABLE falcon_analyses ADD COLUMN blanket_json TEXT`,
  ];
  for (const sql of extras) await db.prepare(sql).run().catch(() => {});

  allReady = true;
}

// ── Out-of-band base tables ────────────────────────────────────────────────
// `users`, `elle_trades`, and `elle_conversation_turns` are created out-of-band
// (no in-repo DDL). These backfills stay separately guarded and are invoked
// from their ORIGINAL call sites (which run only once the base table exists),
// exactly preserving the pre-consolidation timing. They are deliberately NOT
// part of ensureAllSchemas.

let usersColsReady = false;
export async function backfillUsersColumns(db: D1Database): Promise<void> {
  if (usersColsReady) return;
  await db.prepare('ALTER TABLE users ADD COLUMN must_reset INTEGER DEFAULT 0').run().catch(() => {});
  await db.prepare('ALTER TABLE users ADD COLUMN updated_at TEXT').run().catch(() => {});
  usersColsReady = true;
}

let convKappaReady = false;
export async function backfillConvTurnKappa(db: D1Database): Promise<void> {
  if (convKappaReady) return;
  await db.prepare('ALTER TABLE elle_conversation_turns ADD COLUMN kappa REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE elle_conversation_turns ADD COLUMN kappa_def TEXT').run().catch(() => {});
  convKappaReady = true;
}

// `sessions` is also out-of-band. user_id attributes a session to its owner so
// cross-session recall can be scoped to the caller (see recallPastConversations
// in index.ts). Pre-existing sessions stay NULL until backfilled.
let sessionsUserReady = false;
export async function backfillSessionsUserColumn(db: D1Database): Promise<void> {
  if (sessionsUserReady) return;
  await db.prepare('ALTER TABLE sessions ADD COLUMN user_id TEXT').run().catch(() => {});
  sessionsUserReady = true;
}

let tradesExtReady = false;
export async function backfillTradesExtColumns(db: D1Database): Promise<void> {
  if (tradesExtReady) return;
  const columns: Array<[string, string]> = [
    ['asset_class', 'TEXT'],
    ['option_right', 'TEXT'],
    ['strike_price', 'REAL'],
    ['expiration_date', 'TEXT'],
    ['underlying_symbol', 'TEXT'],
    ['attribution', 'TEXT'],
    // Columns the INSERT/SELECT paths have always named but production never
    // had — the reason the ledger stayed empty while positions were real:
    ['quantity', 'REAL'],
    ['expected_timeframe', 'TEXT'],
    ['confidence', 'REAL'],
    ['status', 'TEXT'],
    ['closed_at', 'TEXT'],
    ['broker_order_id', 'TEXT'],
    ['source', 'TEXT'],
  ];
  for (const [name, type] of columns) {
    await db.prepare(`ALTER TABLE elle_trades ADD COLUMN ${name} ${type}`).run().catch(() => {});
  }
  tradesExtReady = true;
}

// `corpus_papers`/`corpus_chunks` are ALSO out-of-band (verified: no CREATE
// TABLE for either anywhere in this repo — see docs/RETRIEVAL_CONTRACT.md).
// The §2 contextual-RAG port (src/retrieval/*) EXTENDS the existing
// corpus_chunks table rather than introducing a parallel one — new columns
// only, same convention as the backfills above. Invoked from
// src/retrieval/contextualizer.ts and pipeline.ts, which only ever run after
// corpus_chunks is known to exist (chunks are inserted well before any
// contextualization pass reads them).
let corpusChunksContextReady = false;
export async function backfillCorpusChunksContext(db: D1Database): Promise<void> {
  if (corpusChunksContextReady) return;
  const columns: Array<[string, string]> = [
    // LLM-generated context ("what this chunk means in the whole document")
    // and the two derived texts § 2.1 defines — kept as separate columns
    // (not recomputed) so re-running the contextualizer is a cheap re-read.
    ['context_text', 'TEXT'],
    ['contextual_text', 'TEXT'], // context_text + ' ' + chunk_text — what gets embedded/FTS-indexed
    ['context_source', 'TEXT'],  // 'full' | 'windowed' (§2.2 — full doc vs. running-summary prompt)
    ['embedding_status', 'TEXT'], // 'pending' | 'contextualized' | 'embedded' | 'failed'
    ['contextualized_at', 'INTEGER'],
    // The re-embedded contextual_text vector lives under its OWN Vectorize
    // id (never overwrites the legacy `vectorize_id` column/vector — see
    // retrieval/dense.ts's embedAndUpsertContextual) so the OLD plain-chunk
    // search path keeps working unchanged through the §2.4 eval-gated
    // cutover. Only the pipeline that reads this column should ever query
    // the contextual_v1 variant.
    ['contextual_vectorize_id', 'TEXT'],
  ];
  for (const [name, type] of columns) {
    await db.prepare(`ALTER TABLE corpus_chunks ADD COLUMN ${name} ${type}`).run().catch(() => {});
  }

  // D1 FTS5 virtual table over contextual_text — the BM25 leg of hybrid
  // retrieval (Vectorize has no keyword search). External-content table
  // (content='corpus_chunks') so the indexed text isn't duplicated on disk;
  // synced by the three triggers below rather than rebuilt on every read.
  await db.prepare(
    `CREATE VIRTUAL TABLE IF NOT EXISTS corpus_chunks_fts USING fts5(contextual_text, content='corpus_chunks', content_rowid='rowid')`
  ).run().catch(() => {});
  await db.prepare(`
    CREATE TRIGGER IF NOT EXISTS corpus_chunks_fts_ai AFTER INSERT ON corpus_chunks BEGIN
      INSERT INTO corpus_chunks_fts(rowid, contextual_text) VALUES (new.rowid, new.contextual_text);
    END
  `).run().catch(() => {});
  await db.prepare(`
    CREATE TRIGGER IF NOT EXISTS corpus_chunks_fts_ad AFTER DELETE ON corpus_chunks BEGIN
      INSERT INTO corpus_chunks_fts(corpus_chunks_fts, rowid, contextual_text) VALUES('delete', old.rowid, old.contextual_text);
    END
  `).run().catch(() => {});
  await db.prepare(`
    CREATE TRIGGER IF NOT EXISTS corpus_chunks_fts_au AFTER UPDATE ON corpus_chunks BEGIN
      INSERT INTO corpus_chunks_fts(corpus_chunks_fts, rowid, contextual_text) VALUES('delete', old.rowid, old.contextual_text);
      INSERT INTO corpus_chunks_fts(rowid, contextual_text) VALUES (new.rowid, new.contextual_text);
    END
  `).run().catch(() => {});

  // Triggers only sync FUTURE writes. Rows that already existed when the FTS
  // table was created need one manual sync — safe to run every time this
  // function runs (guarded by corpusChunksContextReady, so once per isolate),
  // and a no-op once the FTS index is already current.
  await db.prepare(`INSERT INTO corpus_chunks_fts(corpus_chunks_fts) VALUES ('rebuild')`).run().catch(() => {});

  corpusChunksContextReady = true;
}
