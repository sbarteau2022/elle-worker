# T5 — generate batch-16. FINAL BRIEF. Supersedes every earlier T5 instruction.

Written 2026-09-09 after an adversarial workflow (13 agents, 13 attack batches) refuted three
earlier versions of this brief, two of them mine. If you were given an earlier T5 spec — one
mentioning "median SequenceMatcher below 0.15", or "V6 verify IDF cosine < 0.35", or a
"distinct-payload ratio" — **discard it.** All three are superseded and two are actively harmful.

## The task

Write `research/seam-wire/briefs/gemini-batch-16.jsonl`, a **new file**.
Schema per row: `{sphere, difficulty, title, brief, verify}`.
**72 rows = 12 spheres x 6.** Not 66.

The twelve spheres are every key in `Elle/electron/native/providers/faculties.json`, and that
includes **`convergent_logic`**, which has ZERO briefs in the existing 990-row corpus. It can
currently only ever be a wrong answer, and pre-centring it was the top-1 destination for up to 22.7%
of all briefs. Its true-positive rate has never been measured. Do not inherit that blind spot.

Six rows per sphere must be six **different kinds of task** — not one task with the nouns swapped.
That is the entire point. `gemini-batch-01.jsonl` is the model. **Do not read batches 02-15 for
inspiration; they are the failure mode** (all eleven spheres are one template each).

## Do NOT optimise for surface difference

This is the most important instruction and it is counter-intuitive.

The old bar was "make the briefs lexically dissimilar." It was measured to be **anti-correlated**
with what it claimed to measure: an attack that holds the task skeleton fixed and swaps each row's
content vocabulary scores 0.0839, *better* (more "diverse") than genuinely distinct work at 0.1030.
Two statistics in that family rate eleven copies of one task as twice as diverse as 66 real ones.

So: **do not reach for a thesaurus, do not rotate sentence shapes, do not vary formats for their own
sake.** Those moves beat the old bar while leaving the task identical, and the new gate is built to
catch exactly them. Vary the *task*: what operation is demanded, what the input is, what a correct
answer looks like, what would have to be checked.

## Self-check before handing over

Run the gate. It is committed at `research/seam-wire/brief_gate/brief_gate.py`, stdlib only, no GPU:

    python3 research/seam-wire/brief_gate/brief_gate.py path/to/gemini-batch-16.jsonl

Three per-sphere tests; the batch fails if any sphere fails.

| test | reads | fails when | batch-01 scores |
|---|---|---|---|
| T1 SPEC | the embedded data specimen | core >= 2 shared rare tokens, or schema match > 0.33 | core 0 everywhere; schema 0.0000 |
| T2 SKEL | sentence skeleton, all vocabulary erased | masked-skeleton match > 0.78 | 0.5644 median, 0.6927 worst |
| T3 VERIFY | the `verify` field | verify cosine > 0.18, or median verify length > 178 chars | 0.0777 median, 0.1218 worst; 89 chars |

Report the per-sphere table with your handover. A batch that fails any test is not a holdout.

The 13 attack batches are beside the harness (`atk_A..K.jsonl`) if you want to see what the gate
catches and what it does not.

## PASSING THE GATE IS NOT THE GOAL, AND IT IS NOT SUFFICIENT

The gate has a known, measured hole and you must not fall into it by accident.

**Attack K passes every test**: one artifact-free qualitative task written six times with different
people, settings, registers, sentence shapes and verify wordings. `core 0 / schema abstains /
skel 0.6784 / vcos 0.1326` -> PASS. It is one task.

Why it gets through: only **4 of 66** batch-01 briefs carry a detectable data artifact, so T1
abstains on roughly seven of eleven spheres, and those spheres are guarded by T2 and T3 alone — both
of which are beaten by varying sentence shape and check wording. Which is exactly what a capable
model does when it is told to make six briefs look different.

**So the gate cannot certify your work; it can only catch you.** For every sphere where T1 abstains
(no numeric/tabular payload) — in batch-01 that is `motor_praxis`, `language_semiotics`,
`divergent_synthesis`, `social_cognition`, `metacognitive_regulation` among others — you are on your
honour. For each of those spheres, state in your handover, in one line per sphere, **what makes the
six tasks six tasks** rather than six retellings. If you cannot say it, they are not.

## Rules that have not changed

- **Create new files only.** Do not modify any existing file. Do not run git. Do not commit.
- Do not touch `~/.elle/hyper-map/*`, mlx-serve on :11437, or Ollama on :11434.
- **Never push to GitHub.** Standing constraint, absolute.
- Do not embed anything — that is GPU work and it is not yours. A second, stronger test (does the
  router send all six rows of a sphere to the same faculty?) will be applied on arrival by the side
  that owns the GPU. You cannot check it and should not try to.
