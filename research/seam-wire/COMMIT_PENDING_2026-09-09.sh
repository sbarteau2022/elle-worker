#!/bin/bash
# Written 2026-09-09 by the Claude Code session that measured the convergent_logic sink.
# The findings below were written to disk but COULD NOT BE COMMITTED: git failed with
#   fatal: Unable to read current working directory: Operation not permitted
# getcwd() and directory enumeration under elle-worker were denied for that process
# (reading known file paths still worked, which is why the record itself saved).
# Run this once the app has filesystem access again. It is idempotent.
set -e
cd "$(dirname "$0")/../.."          # -> elle-worker root
git add -A research/seam-wire/
git commit -F - <<'MSG'
research: convergent_logic was never tested and was eating 22.7% of the board

Two findings from one read-only measurement (direct on atlas13.json, no ensure(),
cached .posted vectors).

1. faculties.json defines 12 faculties; all 15 brief batches cover 11. No brief in
   the corpus is ever labelled convergent_logic, so that faculty can only ever be a
   wrong answer. Every accuracy number in ROUTING_002 was measured on a board with a
   guaranteed-wrong twelfth exit.

2. Pre-centring that exit was a sink: top-3 for ~84% of all briefs in all three
   batches, top-1 for 12.1% / 22.7% / 22.7%. Mean-centring takes it to 0.0% top-1 on
   batches 02 and 03. Third independent confirmation of the cone diagnosis, and the
   cleanest one -- it needs no labels and no accuracy metric.

3. Consequence: batch-16 must be 12 spheres x 6 = 72 rows, not 66.

4. A better diversity test than the lexical bar: whether all six rows of a sphere
   route to the same faculty. Batch-01 (diverse) 4/11 lockstep, mean 1.91 distinct
   destinations, ragged histogram. Batches 02/03 (templated) 11/11 lockstep, mean
   1.00, a perfectly flat 6-per-faculty histogram -- a fingerprint of the template
   collapse found without reading a character of brief text. Not gameable because
   the generator has no router access by the terms of the parallel-work split, so it
   cannot observe the metric it would need to optimise.

   Pre-registered for batch-16 before it exists: <=5/12 spheres in lockstep AND mean
   distinct destinations >=1.7.

Scripts committed alongside so the numbers are reproducible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
git log -1 --format='%h %s'
git status --short
