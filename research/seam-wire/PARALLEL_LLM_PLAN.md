# Parallel work plan — how a second LLM helps without colliding

> **STATUS 2026-09-09 (final): ALL TASKS COMPLETE.**
> T1 sensory proposal — delivered, evaluated, **not installed** (measured neutral on the holdout).
> T2 `QWEN_LEDGER_V3.md` · T3 `BOARD_BLOCKED_TRIAGE.md` · T4 `STALE_DOCS_REMAINING.md` — all
> delivered and committed. T5 batch-16 — generated and lockstep-validated.
> The partition-by-mutable-resource protocol held throughout: no collision, no overwrite, and the
> parallel session's template warning produced the session's largest finding.
> Kept as the working template for the next parallel run.


Written 2026-09-09 by the Claude Code session that landed ROUTING_002. Hand this to the second
model verbatim. It is built so the two of us cannot corrupt each other's work: the partition is by
**mutable resource**, not by topic, because topics overlap and resources are what actually collide.

---

## The one rule

**You may create new files. You may not modify existing files, and you may not touch shared state.**

Everything below follows from that. If a task seems to need an edit, write the edit as a proposal in
a new file and hand it back. I apply it. This is not bureaucracy — we have already lost one result
today to a silent overwrite (a rebuild ate an installed constant 90 seconds after it was written),
and two of us editing the same tree would do worse.

---

## Shared state you must not touch

| resource | why | who owns it |
|---|---|---|
| `~/.elle/hyper-map/atlas13.json` | single mutable atlas; carries the installed `centreMu`. A stray `ensure()` rebuilds it. | me only |
| `~/.elle/hyper-map/map.json`, `lanes.json`, `jitterbug.json` | live swarm state | me only |
| mlx-serve on **:11437** | one GPU, one model resident. Two embed loops will contend and may OOM the Metal allocator — after which it holds ~24 GB dead until restarted. | me only |
| Ollama on :11434 | holds a 17 GB copy of the coordinator if woken | nobody — leave asleep |
| `git` in **any** of the four repos | I commit as work lands; concurrent commits fragment history | me only |
| the agent-bridge board (`~/agent-bridge/data/board.json`) | writes are fine (create/directive), but **do not claim or cancel** — 709 tasks are already blocked and nobody knows why | read + create only |
| `Elle/electron/native/providers/*.cjs` | I am editing `atlas13.cjs` this session | me only |
| `Elle/tools/mlx-serve/geometry/{toroidal,tit_substitute}.py` | **Stewart** is editing these | nobody |

**Never push to GitHub.** Not from any repo, not on any branch, not ever — even if a tool offers.
This is Stewart's standing constraint and it is absolute. Local commits are mine to make.

---

## STATUS UPDATE 2026-09-09 (after the first handoff round)

**T1 is DONE and it was good work.** The proposal arrived as a new file, edited nothing, committed
nothing — the protocol held. Its checkable claims verified: the `faculties.json` SHA matches my F3
transcript exactly, and batch-01 line 5's header really is `MODEL | MATH | CODE | REASON | REFLECT`,
five columns of which four are numeric. It also corrected my causal wording, correctly.

I ran its four-arm design on batch-03. Against its own pre-registered rule: description-only FAILS
(−5 hits), regex-only is byte-identical to baseline (a ≤0.12 keyword vote cannot close the cosine
gap alone), **both together PASS** (0.742 → 0.758, sensory 0/6 → 6/6, wrong unchanged). The
interaction looks real: the description repositions, the regex breaks the ties it creates.

**Not installed.** Its template warning generalised: batch-01 has median within-faculty brief
similarity 0.038 (66 distinct tasks); **batches 02–15 are all 0.975 — the same 11 templates with
the topic noun swapped.** Batch-03 is batch-02 relabelled (row-aligned 0.967). The corpus is
**77 distinct tasks, not 1056**. So there is no valid holdout for any routing change, and
"0/6 → 6/6" is "0/1 → 1/1". This also narrows my own batch-02 result: the transfer is real, the
effective n is ~11, and every CI I quoted on it was too tight by ~√6.

**T5 is now the highest-value task and it did not exist yesterday. Take it first.**

### T5. Generate genuinely diverse briefs (NEW — the binding constraint)
Nothing in routing can be validated until this exists. Batch-01 is the construction to imitate
(similarity 0.038); whatever produced 02–15 collapsed to one template per faculty and nobody caught
it through two days of measurement.

Write `research/seam-wire/briefs/gemini-batch-16.jsonl` — a **new file**, same schema
(`title`, `brief`, `verify`, `sphere`, `difficulty`), 6 rows per faculty × 11 = 66. Requirements:
every row within a faculty must be a *different kind of task*, not one task with a swapped noun.
Before handing it over, measure it yourself: median pairwise `difflib.SequenceMatcher` ratio on the
`brief` field within each faculty must be **below 0.15**, and report the number per faculty. A batch
that does not clear that bar is not a holdout and should not be handed over. Do not embed it — that
is GPU work and mine.

Read batch-01 for the shape. Do not read batches 02–15 for inspiration; they are the failure mode.

## What you can safely do next — pick in this order

### T1. [DONE — see status above; do not redo]
### T1-ARCHIVE. The `sensory_perception` description (highest value, read-only)
It is the worst faculty in **two disjoint batches**: 6 of 13 off-ceiling misses in batch-02, 6 of 14
in batch-01. Same faculty, same failure, so it is a property of its description, not a batch artifact.

Its briefs go to `episodic_memory`, `somatic_interoception`, `spatial_topography`, `language_semiotics`
— titles like *"Extract Metric Values from Log Lines"*, *"Parse Multi-System Sensor Payload"*,
*"Inspect ASCII Disk Map Grid"*, *"Parse Data Payload"*.

Read `Elle/electron/native/providers/faculties.json` (all twelve `description` + `keywords`) and the
failing briefs in `elle-worker/research/seam-wire/briefs/gemini-batch-0{1,2}.jsonl`. Produce
`sensory_perception_rewrite_PROPOSAL.md` containing: the diagnosis of *why* the current description
loses "parse structured input" to memory/language, a proposed `description` + `keywords` regex, and
the exact reason each of the 12 failures should flip.

**The trap, and it is the whole point of the task:** batches 01 and 02 are the labelled test set and
the briefs were *written from* the descriptions. Tuning a description against them is circular.
Any rewrite is validated on **batch-03 only**, which is untouched and must stay that way. Do not
embed anything. Do not edit `faculties.json`.

### T2. Reply to Qwen — ledger v3 (no repo access needed)
**Now has considerably more to report than when this plan was written**: the graph-geodesic δ arm
came back NOT CLEARED in the live space (RAW 0.1667/0.1667/0.2083, CENTRED 0.1923/0.2143/0.2273
against the lexical arm's 0.1607/0.2500/0.2500), making three spaces that agree; the layer-tap
embedding is indistinguishable from tf-idf on tree-likeness; and the corpus-diversity finding above
narrows the batch-02 claim. ℍ is INSTRUMENTATION on evidence now, not for want of a measurement.
Qwen Max has no file access; Stewart pastes. Source of truth is
`elle-worker/docs/FINDINGS_REGISTER_FOR_QWEN.md` plus
`elle-worker/research/seam-wire/ROUTING_002_recenter.md`. Write `QWEN_LEDGER_V3.md`.

Use the project's tag vocabulary and nothing else: **PROVEN · MEASURED · DERIVED · DESIGN CHOICE ·
STIPULATED · REFUTED · OPEN**.

Must include, because Qwen asked and is owed a straight answer:
- Its correction to my δ mechanism was **right** (δ is homogeneous of degree 1, so δ/diam is
  scale-invariant; "compressed distances" cannot shrink it).
- Its own replacement mechanism is **REFUTED** by direct test: injecting a cone into isotropic noise
  at the identical anisotropy (‖μ‖/mean‖v‖ = 0.956) leaves δ/diam at 0.0802 and mean/diam at 0.919 —
  the shell signature, not the segment. A mean shift leaves the residual isotropic.
- Its commensurability check was right and the answer is worse than it guessed: a random Gaussian
  cloud scores **0.0811**, *inside* the cited 0.00–0.08 tree band. The band has no discriminating
  power in that estimator.
- Two standing corrections it keeps repeating: the 58% gate is `collapse()`'s MARGIN/RATIO
  (`atlas13.cjs:414`), **not** `CENTRAL_FRAC`; and F1b never "flipped" — σ₂/σ₁ = 0.907 before and
  after, because mean-centring is translation-invariant and cannot touch spread.
- Ask for prose, not fenced code: its code blocks have truncated in paste three times.

### T3. Why are 709 board tasks blocked? (read-only)
`bridge_list_tasks {status:'blocked'}` then `bridge_get_task` on a sample. 709 blocked against 166
approved is the largest unexamined signal in the system and nobody has looked. Produce
`BOARD_BLOCKED_TRIAGE.md`: the distribution of blocker reasons, how many are one root cause, and
which are stale enough to cancel. **Propose cancellations; do not execute them.**

### T4. Finish the stale-doc audit (read-only)
`FINDINGS_REGISTER_FOR_QWEN.md` §14 lists ~14 documentation defects. I fixed three today
(`CLAUDE.md` wasm bullet, `TOROIDAL_GRAPH_MAPPING.md` §9 row, `torus.ts` SCOPE note) and fixed the
generator. Verify each remaining one still exists — **check the repo, do not trust the list**, other
sessions commit between turns — and write `STALE_DOCS_REMAINING.md` with file:line and the exact
replacement text. I apply them.

Known live ones to start from: `HYPERBOLIC_GRAPH_MAPPING.md` caps (says RIP_DIM 16 / default dim 2 /
256 nodes; code has 29 / 128 / 20000); `DUAL_ROUTER_ARCHITECTURE_SPEC` §2.10 (claims 16-band eGeMAPS,
spectral flux, scene cuts, 8-orientation Gabor — code has none of the first three and **4**
orientations); `COGNITIVE_MAPPING_IMPLEMENTATION_PLAN` §2.2 (B¹⁰²⁴ encoder, stamped "Production
Validated", is dead per `PSI_ENCODER_FINDING`); `Elle/docs/pfar_phase_space.tex` is cited as "the
paper" by two companion docs and **does not exist**; `tit.py:353` sets `h1 = h2 = None` immediately
before serialising them, so its hypothesis verdicts are always null.

---

## What I am doing, so you do not duplicate it

Running the **graph-geodesic δ arm** on 1030 real corpus chunks in the layer-tap space — the
decisive measurement for whether the hyperbolic factor earns mechanism status. Production chunker
(`semanticChunks`, ported verbatim), symmetrized k-NN at k = 3/5/8, hop distance, 4-point δ over
seeded relabelings. Comparable to the register's lexical arm (δ/diam 0.1607 / 0.2500 / 0.2500).
Owns: the embedder, `/tmp/corpus_*`, and the resulting record. **Do not run an embed loop.**

---

## Handoff protocol

1. Write your output as a **new** `.md` in `elle-worker/research/seam-wire/`. Never edit an existing file.
2. Open with a two-line summary: what you did, what you concluded.
3. Tag every claim. If you did not measure it, say which tag it gets and why.
4. State what would refute you. A claim with no refutation condition is not a finding.
5. Do not commit. I commit; a single history is the point.

## House rules that are not negotiable

- **Check the repo before asserting anything exists or not.** Other sessions commit between turns.
- **Take ideas to where they break and fork there.** Stewart: *"I don't care to be right, I care
  that we come to it in co-authorship."* Never soften a result to be agreeable — that wastes his time.
- **Geometry earns MECHANISM status only via a measurement a flat build could not produce.**
  Otherwise it is INSTRUMENTATION. Say which, every time.
- **Do not fit small-integer identities to counts** (7, 5, 19, 21, 25, 27, 31). Small integers always
  have identities. An earlier session lost hours to this and it produced nothing.
- If you find something that contradicts a claim I made today, **say so directly**. Two of my
  conclusions were retracted within hours of being written; that is the process working.
