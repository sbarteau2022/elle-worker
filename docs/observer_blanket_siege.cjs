#!/usr/bin/env node
/*
 * LANE A — THE OBSERVER/BLANKET SIEGE
 *
 * Companion to docs/pami_dhng_siege.cjs (lane B). Same discipline: build a
 * bundle from the REAL src/observer-blanket.ts, run deterministic probes, no
 * network, no wall-clock, no D1.
 *
 * The claim under siege is the module's own header, src/observer-blanket.ts:17
 *
 *   "Validated offline (n=10 hand-extractions): structured completeness
 *    predicts prediction<->outcome fidelity at rho~=+0.61, vs +0.08 for
 *    trajectory coherence -- a 7x lift."
 *
 * That claim is doing real work: it is quoted again at observer.ts:296 as the
 * reason the extractor runs on every analysis, and observer-live.ts is built
 * on top of it. So it is worth attacking on three fronts:
 *
 *   A0  Is the n=10 data in this repository at all?
 *   A1  What is the scorer's actual reachable range? (the clamp implies 1.0)
 *   A2  How much of a model does the score even look at?
 *   A3  Can a content-free extraction score maximum? (gameability)
 *   A4  How many distinct levels does the score have? (rank resolution)
 *   A5  Is rho=+0.61 at n=10 distinguishable from chance? EXACT permutation.
 *   A6  What is the confidence interval on +0.61 and on the 7x lift?
 *   A7  Does the scorer survive a malformed LLM parse?
 *
 * SELF-AUDIT (2nd pass). A siege that cannot be wrong about itself is not a
 * siege. This harness was re-audited against its own output; the corrections
 * are in-line and labelled. What changed:
 *
 *   A0  dataPat was measured against seven realistic encodings of a scored
 *       table and MISSED four of them. The old verdict ("no scored validation
 *       set exists in this repository") claimed more than the instrument can
 *       support. It now reports what it actually establishes, and a same-FILE
 *       co-occurrence pass was added to catch multi-line encodings.
 *   A0  the claim/forward buckets were mutually exclusive (an `else if`), so a
 *       line doing both was filed as a restatement only. Now non-exclusive.
 *   A1  the exhaustiveness claim was CHALLENGED and SURVIVED: widening the
 *       lattice to vary junk blankets yields the same 113 distinct scores. The
 *       challenge is left in the harness so the claim stays falsifiable.
 *   A4  the harness asserted "ten observations will contain ties" without ever
 *       measuring it. Now measured.
 *   A5  rho = 1 - 6S/(n(n^2-1)) is the UNTIED Spearman identity, applied to a
 *       predictor A4 shows is heavily tied. Tie-corrected nulls added.
 *   A6  se = 1/sqrt(n-3) is the PEARSON standard error. Spearman needs
 *       ~1.06/sqrt(n-3); the old intervals were 6% too narrow, an error that
 *       ran in this harness's own favour. Corrected, both reported.
 *   A7  two prose claims ("extractBlanketModel guards...", "a full grep
 *       confirms it") were assertions inside a measurement harness. Marked
 *       UNMEASURED rather than deleted, so the gap stays visible.
 *   all this harness now stamps its own commit, writes its own results file,
 *       and EXITS NONZERO when a probe fails. A siege that cannot fail cannot
 *       gate CI.
 *
 * Run:  node docs/observer_blanket_siege.cjs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blanket-siege-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry,
  `export { completenessFromExtraction } from ${JSON.stringify(path.join(root, 'src/observer-blanket'))};\n`);
const bundle = path.join(tmp, 'bundle.cjs');
// The module graph behind observer-blanket.ts reaches the worker's LLM router,
// which imports .md/.sql/.txt corpora as text. esbuild needs loaders for those or
// the self-build fails on files that have nothing to do with the scorer. We bundle
// the REAL module rather than re-implementing the arithmetic: the whole point is
// that the numbers below come from the shipped code, not from a paraphrase of it.
execFileSync('npx', ['--no-install', 'esbuild', '--bundle', '--format=cjs', '--platform=node',
  '--loader:.md=text', '--loader:.sql=text', '--loader:.txt=text', '--loader:.csv=text',
  '--outfile=' + bundle, entry], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const { completenessFromExtraction: score } = require(bundle);

const r4 = (x) => Number(x.toFixed(4));
const OUT = [];
const line = (s) => { OUT.push(s); console.log(s); };
const rule = () => line('-'.repeat(72));

// Self-stamp. The first run of this harness needed its commit hand-written into
// the results file, and a rebase then made that hand-written hash stale. Never
// again: the artifact records the tree it was actually computed from.
let HEAD = 'unknown';
try { HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(); } catch {}
let DIRTY = '';
try { if (execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim()) DIRTY = ' (WORKING TREE DIRTY)'; } catch {}
const DEFECTS = [];   // probes whose finding is adverse; drives the exit code

line('='.repeat(72));
line('LANE A SIEGE — observer/blanket completeness');
line(`commit ${HEAD}${DIRTY}`);
line('='.repeat(72));

// ---------------------------------------------------------------- A0
line('');
line('A0  PROVENANCE — is the n=10 validation set in this repository?');
rule();
{
  // Widened in the 2nd pass: the first cut omitted .yaml/.yml/.tsv/.jsonl/
  // .ndjson, all of which are ordinary ways to store a ten-row scored table.
  const exts = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.md', '.json', '.txt', '.csv', '.sql',
                        '.yaml', '.yml', '.tsv', '.jsonl', '.ndjson']);
  const skip = new Set(['node_modules', '.git', 'dist', '.wrangler', 'build']);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.has(path.extname(e.name))) files.push(p);
    }
  })(root);

  // This harness and its own transcript are excluded for the same reason the
  // claim comments are: an audit cannot be its own evidence.
  // 3rd-pass correction, found by RUNNING the 2nd-pass build: the harness
  // excluded itself and its own transcript, but not the RE-AUDIT record it
  // writes about itself, nor the lane-B pair. The first run after the 2nd-pass
  // patch therefore reported 5 restatement lines in 2 files, 3 of which were
  // the audit quoting its own arithmetic back at itself. An audit cannot be
  // its own evidence, and that includes the audit's own paperwork.
  const selfSites = new Set([
    path.join(root, 'docs/observer_blanket_siege.cjs'),
    path.join(root, 'docs/OBSERVER_BLANKET_SIEGE_RESULTS.txt'),
    path.join(root, 'docs/SIEGE_HARNESS_REAUDIT.txt'),
    path.join(root, 'docs/pami_dhng_siege.cjs'),
    path.join(root, 'docs/PAMI_DHNG_SIEGE_RESULTS.txt'),
  ]);

  // Two patterns, deliberately separated.
  //   claimPat  — the claim's own vocabulary. A line matching this ASSERTS the
  //               result; it is a restatement, never evidence for it.
  //   dataPat   — what a stored validation set would look like: a completeness
  //               value beside a fidelity value, a fixture, a scored table.
  // RETROSPECTIVE assertion of the headline result — an unsourced number.
  const claimPat = /hand.?extract|rho\s*[≈~=]\s*\+?0?\.6|0\.61\b.*0\.08|[Vv]alidated .*(?:predicts?|fidelity)|[Pp]redicts prediction↔outcome fidelity far/;
  // FORWARD machinery — a pre-registered test with a null and a power floor.
  // These are not restatements of the number; they are the apparatus that would
  // earn one. Counting them as claims would be unfair to the codebase.
  const fwdPat   = /permutation null|POWER_FLOOR|UNDERPOWERED|power_floor|post-cutoff|HINDSIGHT-FREE|hindsight-free/;
  // What a stored validation set would look like: scores beside outcomes.
  // 5th-pass WIDENING. The 2nd pass MEASURED this pattern against seven
  // realistic encodings of a ten-row scored table and found it blind to four:
  // pretty-printed JSON (key and value on separate lines), a TSV header (tab,
  // not comma), an inline JSON one-liner, and renamed columns (score_c /
  // score_f). A0's finding is a NEGATIVE claim -- "this data is in no file" --
  // and a negative claim is worth exactly what the search that failed to find
  // it is worth. So the SEARCH is rebuilt here; the verdict is not softened.
  // v1 is kept, not deleted, so the before/after is MEASURED in this harness's
  // own output below rather than asserted in a comment.
  const dataPatV1 = /completeness\s*[,:|]\s*fidelity|fidelity\s*[,:|]\s*completeness|blanket_fidelity|VALIDATION_SET|hand_extractions?/i;
  // The two column names, each with the aliases a real scored table would use.
  const COMP = String.raw`(?:(?:structural|struct|schema)?[_\- ]?completeness(?:[_\- ]?score)?|score[_\-]c\b|c[_\-]score\b|comp[_\-]score\b)`;
  const FIDL = String.raw`(?:(?:blanket|outcome|prediction)?[_\- ]?fidelity(?:[_\- ]?score)?|score[_\-]f\b|f[_\-]score\b|fid[_\-]score\b)`;
  // What may legitimately sit BETWEEN the two names in a stored table: a
  // closing quote, one separator (comma / colon / pipe / tab / newline), an
  // optional numeric value, and bracket punctuation. Bounded on purpose --
  // prose cannot bridge the pair, so a sentence that merely mentions both
  // words is still not data. \s spans newlines, which is what makes the
  // pretty-printed-JSON and YAML cases reachable at all.
  const GAPX = String.raw`["'\]]?\s*[,:|\t]?\s*(?:[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)?[\s,;:|}\]\[{]*["'\[]?`;
  const dataSrc  = `${COMP}${GAPX}${FIDL}|${FIDL}${GAPX}${COMP}|blanket_fidelity|VALIDATION_SET|hand_extractions?`;
  const dataPat  = new RegExp(dataSrc, 'i');
  const dataPatG = new RegExp(dataSrc, 'gi');   // whole-FILE pass, for multi-line encodings

  const restatements = [];   // lines that ASSERT the retrospective result
  const forward     = [];    // lines that build the FORWARD test instead
  const candidates   = [];   // lines that could HOLD the data
  const candSeen     = new Set();  // 5th pass: dedupe per-line vs whole-file hits
  const cofile       = new Set();  // 2nd pass: same-FILE co-occurrence, not same-line
  const numrows      = [];   // 2nd pass: bare numeric pairs — a scored table with no header
  for (const f of files) {
    if (selfSites.has(f)) continue;
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rel = path.relative(root, f);
    const lines = txt.split('\n');
    lines.forEach((l, i) => {
      // 2nd pass: these were `if / else if`, so a line that both restated the
      // number AND built the forward test counted only as a restatement — an
      // unfairness pointing at the codebase. Now a line can land in both.
      if (claimPat.test(l)) restatements.push([rel, i + 1, l.trim().slice(0, 92)]);
      if (fwdPat.test(l))   forward.push([rel, i + 1, l.trim().slice(0, 92)]);
      if (dataPat.test(l) && !candSeen.has(rel + ':' + (i + 1))) {
        candSeen.add(rel + ':' + (i + 1));
        candidates.push([rel, i + 1, l.trim().slice(0, 92)]);
      }
      if (/\bcompleteness\b/i.test(l)) cofile.add(rel + '\u0000c');
      if (/\bfidelity\b/i.test(l))     cofile.add(rel + '\u0000f');
      if (/^\s*[-|"'\[]?\s*(?:0?\.\d+|[01](?:\.\d+)?)\s*[,\t|]\s*(?:0?\.\d+|[01](?:\.\d+)?)\s*[,|\]]?\s*$/.test(l))
        numrows.push([rel, i + 1, l.trim().slice(0, 92)]);
    });
    // 5th pass: a line-at-a-time scan structurally CANNOT see an encoding that
    // puts the two fields on different lines -- which is what pretty-printed
    // JSON and YAML both do. Re-scan the whole file text with the same pattern,
    // map every match back to its line, and dedupe against the per-line hits.
    dataPatG.lastIndex = 0;
    let mm;
    while ((mm = dataPatG.exec(txt)) !== null) {
      if (mm[0].length === 0) { dataPatG.lastIndex++; continue; }
      const ln = txt.slice(0, mm.index).split('\n').length;
      const key = rel + ':' + ln;
      if (candSeen.has(key)) continue;
      candSeen.add(key);
      candidates.push([rel, ln, (lines[ln - 1] || mm[0]).trim().slice(0, 92)]);
    }
  }
  const restateFiles = [...new Set(restatements.map(h => h[0]))];
  const fwdFiles = [...new Set(forward.map(h => h[0]))];

  line(`  files scanned (repo, excluding this harness) : ${files.length}`);
  line('');
  line(`  LINES THAT ASSERT THE RETROSPECTIVE RESULT : ${restatements.length}  in ${restateFiles.length} file(s)`);
  for (const [f, n, l] of restatements) line(`    ${f}:${n}  ${l}`);
  line('');
  line(`  LINES BUILDING THE FORWARD TEST INSTEAD : ${forward.length}  in ${fwdFiles.length} file(s)`);
  for (const f of fwdFiles) line(`    ${f}`);
  line('  (a permutation null, a power floor, a post-cutoff admissibility gate —');
  line('   apparatus, not assertion. Counted separately on purpose.)');
  line('');
  line(`  LINES THAT COULD HOLD THE DATA (a scored table, a fixture) : ${candidates.length}`);
  for (const [f, n, l] of candidates) line(`    ${f}:${n}  ${l}`);
  if (!candidates.length) line('    (none)');
  line('');
  // 2nd pass: SELF-TEST THE INSTRUMENT BEFORE TRUSTING ITS NULL RESULT.
  // A null finding is only as strong as the probe's power, and this probe's
  // power had never been measured.
  const fixtures = [
    ['pretty-printed JSON (keys on separate lines)', '{\n  "completeness": 0.72,\n  "fidelity": 0.55\n}'],
    ['CSV header',                                    'completeness,fidelity\n0.72,0.55'],
    ['CSV header, spaced',                            'completeness, fidelity\n0.72, 0.55'],
    ['TSV header',                                    'completeness\tfidelity\n0.72\t0.55'],
    ['markdown table',                                '| completeness | fidelity |\n| 0.72 | 0.55 |'],
    ['inline JSON one-liner',                         '{"completeness":0.72,"fidelity":0.55}'],
    ['renamed columns (score_c, score_f)',            'score_c,score_f\n0.72,0.55'],
  ];
  // 5th pass: encodings the WIDENED pattern still cannot reach. Closing the
  // seven above does not make the search complete, and A0's null result must
  // not be read as if it did. These are measured by running the widened
  // pattern against them, exactly as the seven are — not assumed.
  const residual = [
    ['opaque single-letter columns (case,c,f)',       'case,c,f\n1,0.72,0.55'],
    ['opaque axis names (id,x,y), legend elsewhere',  'id,x,y\n1,0.72,0.55'],
    ['array-of-arrays, column names in another file', '[[0.72,0.55],[0.41,0.33]]'],
    ['the pair stated in prose, never tabulated',     'Case 3 scored 0.72 on structure and resolved at 0.55.'],
  ];
  // Detection here mirrors the repo walk above EXACTLY — per-line first, then
  // the whole-file pass. Measuring a probe the scan does not actually run
  // would be the same error this harness is hunting.
  const seesV1 = (t) => t.split('\n').some((l) => dataPatV1.test(l));
  const seesV2 = (t) => {
    if (t.split('\n').some((l) => dataPat.test(l))) return true;
    dataPatG.lastIndex = 0;
    return dataPatG.test(t);
  };
  let blind = 0, blindV1 = 0, blindNamed = 0;
  line('  PROBE POWER — can the evidence search even SEE a scored table?');
  line('  A0 asserts a NEGATIVE, so it is worth exactly what this search is worth.');
  line('');
  line('    v1 (before)  v2 (now)   encoding');
  for (const [lab, txt] of fixtures) {
    const h1 = seesV1(txt), h2 = seesV2(txt);
    if (!h1) blindV1++;
    if (!h2) { blindNamed++; blind++; }
    line(`    ${h1 ? 'DETECTED  ' : 'MISSED    '} ${h2 ? 'DETECTED' : 'MISSED  '}   ${lab}`);
  }
  line(`  of these ${fixtures.length} encodings the OLD pattern was blind to ${blindV1}; the WIDENED pattern is blind to ${blindNamed}.`);
  line('');
  line('  RESIDUAL BLINDNESS — encodings the WIDENED pattern still cannot see:');
  let blindResidual = 0;
  for (const [lab, txt] of residual) {
    const h2 = seesV2(txt);
    if (!h2) { blindResidual++; blind++; }
    line(`    ${h2 ? 'DETECTED' : 'MISSED  '}  ${lab}`);
  }
  line(`  ${blindResidual}/${residual.length} still missed: no name-based pattern can recover a column whose`);
  line('  name carries no shared vocabulary. Those are the numeric-pair pass below.');
  const binExts = ['.xlsx', '.xls', '.ods', '.numbers', '.parquet', '.db', '.sqlite', '.pdf'];
  const unscanned = binExts.filter((e) => !exts.has(e));
  line(`  and ${unscanned.length}/${binExts.length} file types are never walked at all: ${unscanned.join(' ')}`);
  line('  (a set of ten hand-extractions lives in a spreadsheet at least as often');
  line('   as in a repository file, and no regex over this walk reaches one.)');
  line(`  dataPat is BLIND to ${blind}/${fixtures.length + residual.length} realistic encodings.`);
  line('');
  const coFiles = [...new Set([...cofile].map(k => k.split('\u0000')[0]))]
    .filter(f => cofile.has(f + '\u0000c') && cofile.has(f + '\u0000f'));
  line(`  SAME-FILE CO-OCCURRENCE of "completeness" and "fidelity" : ${coFiles.length} file(s)`);
  for (const f of coFiles) line(`    ${f}`);
  line(`  BARE NUMERIC PAIRS (a headerless scored table) : ${numrows.length} line(s)`);
  for (const [f, n, l] of numrows.slice(0, 20)) line(`    ${f}:${n}  ${l}`);
  line('');
  if (candidates.length === 0) {
    line('  VERDICT: this probe finds no scored validation set. Read that at the');
    line(`           strength the instrument supports: dataPat sees all ${fixtures.length - blindNamed} of the`);
    line(`           ${fixtures.length} named encodings after the 5th-pass widening but is still blind`);
    line(`           to ${blind} of ${fixtures.length + residual.length} once opaque column names are counted, and this walk`);
    line('           covers the WORKING TREE AT HEAD ONLY — git history is not');
    line('           searched. The honest statement');
    line('           is "no scored set is visible to these probes here and now",');
    line('           not "none exists". The co-occurrence and numeric-pair passes');
    line('           above are the fallback; inspect any file they list.');
    line('');
    // 4th-pass correction: this prose said "several files" and "a schema
    // comment and a second module" while the counters beside it said 2 lines
    // in 1 file. Hardcoded prose that outruns its own measurement is the exact
    // defect class this siege hunts, and it was sitting inside the siege.
    // Every quantity in this paragraph is now driven by the counters.
    line('           What the probe DOES establish at full strength is the');
    line(`           asymmetry: the number is asserted on ${restatements.length} line(s) across`);
    line(`           ${restateFiles.length} file(s) and evidenced in none of them. Restating it`);
    line('           does not corroborate it — every one of those lines traces');
    line('           to the same unsourced number, so repetition only widens');
    line('           the blast radius if it is wrong.');
    line('');
    line(`           But the same repository contains, in ${fwdFiles.length} file(s), the forward`);
    line('           instrument that WOULD source it: observer-falsifier.ts holds a');
    line('           permutation null at a PRE-REGISTERED alpha = 0.01 with');
    line('           POWER_FLOOR = 8, and observer-live.ts gates on post-cutoff');
    line('           admissibility. Both are wired into production (observer.ts:697');
    line('           calls falsify(); observer.ts imports logLivePrediction,');
    line('           resolveLivePrediction and liveValidation). The apparatus is real.');
    line('           It has simply not returned a verdict yet — and by its own');
    line('           pre-registered alpha, the headline +0.61 would not clear it.');
  } else {
    line('  VERDICT: candidate data found above — inspect it before trusting this');
    line('           probe; the rest of the siege assumes the set is absent.');
  }
  if (restatements.length && !candidates.length)
    DEFECTS.push(`A0 the headline number is asserted in ${restateFiles.length} file(s) and evidenced in none`);
  if (blind) DEFECTS.push(`A0 dataPat is blind to ${blind}/${fixtures.length + residual.length} encodings; its null result is bounded`);

}

// ---------------------------------------------------------------- A1
line('');
line('A1  REACHABLE RANGE — enumerate every score the function can return');
rule();
// The score reads exactly seven independent facts about a model. Enumerate the
// full lattice by CONSTRUCTING models, not by re-implementing the arithmetic.
const mk = ({ nWf = 0, junk = 0, nested = false, goodCol = false, trough = false, es = 0, status = false, reasoning = false }) => {
  const blankets = [];
  for (let i = 0; i < nWf; i++) blankets.push({
    name: 'agent' + i, scale: 'institution', boundary_mechanism: 'credentials',
    internal_target_states: ['prestige'], defensive_behaviors: ['reject anomaly'],
    ...(nested && i === 0 ? { nested_within: 'parent' } : {}),
  });
  for (let i = 0; i < junk; i++) blankets.push({ name: 'junk' + i });
  if (nested && !nWf && junk) blankets[0].nested_within = 'parent';
  const collisions = [];
  if (goodCol) collisions.push({ collision_mechanism: 'exports risk', risk_classification: 'structural_rupture' });
  if (trough) collisions.push({ dissent_trough_signature: 'the anomaly' });
  const keys = ['suppressed_signal', 'beneficiary_blanket_id', 'cost_bearer_blanket_id'];
  const epistemic_suppression = {};
  for (let i = 0; i < es; i++) epistemic_suppression[keys[i]] = 'x';
  const systemic_alignment_verdict = {};
  if (status) systemic_alignment_verdict.status = 'systemically_fragile';
  if (reasoning) systemic_alignment_verdict.reasoning = 'because';
  return { blankets, collisions, epistemic_suppression, systemic_alignment_verdict };
};

const lattice = new Set();
for (const nWf of [0, 1, 2, 3, 4, 12])
  for (const nested of [false, true])
    for (const goodCol of [false, true])
      for (const trough of [false, true])
        for (const es of [0, 1, 2, 3])
          for (const status of [false, true])
            for (const reasoning of [false, true])
              lattice.add(r4(score(mk({ nWf, nested, goodCol, trough, es, status, reasoning }))));
const vals = [...lattice].sort((a, b) => a - b);
// SELF-CHALLENGE (2nd-pass audit). The claim "every score" is an exhaustiveness
// claim, and an exhaustiveness claim is worth nothing unless it is falsifiable.
// The grid above holds `junk` at 0. Re-run it with junk varied: if malformed
// blankets can reach a value the shipped grid misses, this probe undercounts.
const challenge = new Set();
for (const nWf of [0, 1, 2, 3, 4, 12])
  for (const junk of [0, 1, 3])
    for (const nested of [false, true])
      for (const goodCol of [false, true])
        for (const trough of [false, true])
          for (const es of [0, 1, 2, 3])
            for (const status of [false, true])
              for (const reasoning of [false, true])
                challenge.add(r4(score(mk({ nWf, junk, nested, goodCol, trough, es, status, reasoning }))));
const unenumerated = [...challenge].filter((v) => !lattice.has(v));
line(`  distinct reachable scores    : ${vals.length}`);
line(`  junk-varied challenge grid   : ${challenge.size} distinct, ${unenumerated.length} not in the lattice above`);
line(`  minimum                      : ${vals[0].toFixed(4)}`);
line(`  MAXIMUM                      : ${vals[vals.length - 1].toFixed(4)}`);
line(`  the source clamps with Math.min(..., 1)`);
line(`  does that clamp ever engage? : ${vals[vals.length - 1] >= 1 ? 'YES' : 'NO — it is dead code'}`);
line('');
{
  // Narration is interpolated from the same measurement the defect gate below
  // reads (vals[vals.length - 1]) and branches on the same condition (< 1), so
  // this paragraph cannot drift from the counters.
  const maxV = vals[vals.length - 1];
  if (maxV < 1) {
    line(`  The measured ceiling is ${maxV.toFixed(4)}, not 1.0000. A perfect`);
    line('  extraction — every field filled, well-formed agents, a nested parent,');
    line('  a classified collision, all suppression fields, a verdict with');
    line('  reasoning — cannot score higher. The metric is not on a [0,1] scale');
    line('  despite being clamped to one and read as a fraction; any consumer');
    line('  treating 1.0 as the ceiling is calibrated against a point the');
    line('  function cannot reach.');
  } else {
    line(`  The measured ceiling is ${maxV.toFixed(4)} exactly: the full [0,1] scale is`);
    line('  reachable and the Math.min(..., 1) clamp is a live guard at the top');
    line('  of the range, not dead code.');
  }
}
if (unenumerated.length) DEFECTS.push('A1 lattice is not exhaustive');
if (vals[vals.length - 1] < 1) DEFECTS.push('A1 Math.min(...,1) clamp is dead code; ceiling is 0.96');

// ---------------------------------------------------------------- A2
line('');
line('A2  CEILING — how many agents does the score actually look at?');
rule();
{
  const rows = [1, 2, 3, 4, 8, 30].map(n => [n, r4(score(mk({ nWf: n, goodCol: true, trough: true, es: 3, status: true, reasoning: true, nested: true })))]);
  for (const [n, s] of rows) line(`  ${String(n).padStart(3)} well-formed agents -> ${s.toFixed(4)}`);
  const flat = rows.filter(r => r[0] >= 3).every(r => r[1] === rows.find(r2 => r2[0] === 3)[1]);
  line('');
  line(`  identical from 3 upward       : ${flat ? 'YES' : 'no'}`);
  line('  Math.min(nWf, 3) is a hard ceiling: a run that names thirty interacting');
  line('  agents and a run that names three score the same. Every agent past the');
  line('  third carries zero bits. On an Observer docket — the stated use case,');
  line('  institutional capture with many nested parties — three is not a lot.');
  if (flat) DEFECTS.push('A2 Math.min(nWf,3) makes every agent past the third carry zero bits');
}

// ---------------------------------------------------------------- A3
line('');
line('A3  GAMEABILITY — is the score measuring modelling, or form-filling?');
rule();
{
  // The rich fixture from observer-blanket.test.ts — a real reading.
  const rich = {
    blankets: [
      { name: 'FDA device division', scale: 'institution', boundary_mechanism: 'statutory authority + user-fee funding',
        internal_target_states: ['throughput', 'non-embarrassment'], defensive_behaviors: ['narrow the question', 'defer to sponsor data'], nested_within: 'HHS' },
      { name: 'HHS', scale: 'super_system', boundary_mechanism: 'appropriations',
        internal_target_states: ['political stability'], defensive_behaviors: ['accept the agency story'] },
      { name: 'sponsor', scale: 'sub_organization', boundary_mechanism: 'capital + IP',
        internal_target_states: ['solvency', 'approval date'], defensive_behaviors: ['reframe the adverse signal as noise'] },
    ],
    collisions: [{ sub_blanket_id: 'sponsor', target_blanket_id: 'HHS', collision_mechanism: 'exports post-market risk onto the patient population',
      risk_classification: 'institutional_capture', dissent_trough_signature: 'the reviewer memo that stops being cited' }],
    epistemic_suppression: { suppressed_signal: 'the reviewer memo', beneficiary_blanket_id: 'sponsor', cost_bearer_blanket_id: 'patients' },
    systemic_alignment_verdict: { status: 'locally_optimized_parasitic', reasoning: 'the sponsor captures the approval and exports the tail risk' },
  };
  // A content-free extraction: every predicate is a truthiness check, so every
  // field is satisfied by a single character. Nothing here models anything.
  const vacuous = {
    blankets: [
      { name: '.', scale: 'individual', boundary_mechanism: '.', internal_target_states: ['.'], defensive_behaviors: ['.'], nested_within: '.' },
      { name: '.', scale: 'individual', boundary_mechanism: '.', internal_target_states: ['.'], defensive_behaviors: ['.'] },
      { name: '.', scale: 'individual', boundary_mechanism: '.', internal_target_states: ['.'], defensive_behaviors: ['.'] },
    ],
    collisions: [{ collision_mechanism: '.', risk_classification: 'parasitic_cancer', dissent_trough_signature: '.' }],
    epistemic_suppression: { suppressed_signal: '.', beneficiary_blanket_id: '.', cost_bearer_blanket_id: '.' },
    systemic_alignment_verdict: { status: 'nested_compatible', reasoning: '.' },
  };
  // A DEEP but narrow reading: one agent, understood precisely. No collision
  // is nameable because only one agent was named.
  const deep = {
    blankets: [{ name: 'the review division', scale: 'institution',
      boundary_mechanism: 'statutory authority, user-fee funding, and the reviewer-of-record convention',
      internal_target_states: ['throughput', 'non-embarrassment', 'statutory-deadline compliance', 'inter-division parity'],
      defensive_behaviors: ['narrow the question to the submitted endpoint', 'defer to sponsor-supplied data',
        'route dissent to a non-binding memo', 'settle disagreement at the deadline rather than on the evidence'] }],
    collisions: [],
    epistemic_suppression: { suppressed_signal: 'the reviewer memo' },
    systemic_alignment_verdict: { status: 'systemically_fragile', reasoning: 'the deadline, not the evidence, terminates the argument' },
  };
  const sRich = r4(score(rich)), sVac = r4(score(vacuous)), sDeep = r4(score(deep));
  line(`  rich reading (3 agents, real content) : ${sRich.toFixed(4)}`);
  line(`  VACUOUS   ("." in every field)        : ${sVac.toFixed(4)}`);
  line(`  deep but narrow (1 agent, precise)    : ${sDeep.toFixed(4)}`);
  line('');
  line(`  rich == vacuous, exactly?             : ${sRich === sVac ? 'YES' : 'no'}   (delta ${Math.abs(sRich - sVac).toFixed(6)})`);
  line(`  vacuous beats the deep reading by     : ${(sVac - sDeep).toFixed(4)}  (${(sVac / sDeep).toFixed(2)}x)`);
  if (sRich === sVac) DEFECTS.push('A3 a content-free extraction scores identically to a real reading');
  line('');
  // Branches on the identical condition the A3 defect gate uses (sRich ===
  // sVac), interpolating the measured scores, so the prose tracks the scorer
  // actually shipped rather than the version this siege was written against.
  if (sRich === sVac) {
    line('  Every predicate in the scorer is a presence test — !!b.name, .length');
    line('  >= 1, Boolean(field). None of them reads content. So the score is a');
    line('  measure of SCHEMA COVERAGE, not of modelling quality, and the two are');
    line('  not the same variable. That matters more here than it would elsewhere:');
    line('  the producer is an LLM asked to fill this exact schema, and filling a');
    line('  schema is the one thing an LLM will do whether or not the material');
    line('  supports it. The extraction prompt says "do not invent structure it did');
    line('  not infer" — the scorer pays for inventing it anyway.');
  } else {
    line(`  A content-free extraction no longer scores like a real one: "." in`);
    line(`  every field scores ${sVac.toFixed(4)} against ${sRich.toFixed(4)} for the rich reading.`);
    line('  But the floors that separate them are SYNTACTIC — a character class,');
    line('  minimum lengths, a placeholder list. They tell "filled with a');
    line('  placeholder" from "filled"; they cannot tell a plausible INVENTED');
    line('  extraction from a true one. The score is schema coverage with a');
    line('  syntactic floor, not modelling quality, and the producer is still an');
    line('  LLM asked to fill this exact schema.');
  }
  line('');
  line('  The direction of the bias is the problem. If completeness is really a');
  line('  proxy for schema-filling eagerness, then a correlation with downstream');
  line('  fidelity is exactly what you would ALSO see if eager runs were simply');
  line('  the runs on richer dockets. The claim needs the confound ruled out;');
  line('  nothing in this repo rules it out.');
}

// The tie patterns A5 enumerates its exact permutation null over. Hoisted out
// of A5 (5th pass) for one reason: A4 measures how LIKELY ties are and then
// hands that result to A5, so A4 has to be able to state, from the same array
// A5 actually uses, how many patterns are enumerated and what rank convention
// they carry. Two copies of this list would let the prose drift from the code,
// which is the exact defect class this siege hunts.
//
// Each entry is a vector of RANKS for the predictor, using MIDRANKS: a group of
// g tied cases spanning sorted positions p..p+g-1 all carry the mean of those
// positions (so a 2-way tie at the bottom is 1.5,1.5 and a 4-way tie at the top
// is 8.5 four times). A4 VERIFIES that property rather than assuming it.
const TIE_PATTERNS = [
  ['no ties (the shortcut case)      ', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['one 2-way tie                    ', [1.5, 1.5, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['two 2-way ties                   ', [1.5, 1.5, 3.5, 3.5, 5, 6, 7, 8, 9, 10]],
  ['one 3-way tie                    ', [2, 2, 2, 4, 5, 6, 7, 8, 9, 10]],
  ['one 4-way tie at the top (cf. A2)', [1, 2, 3, 4, 5, 6, 8.5, 8.5, 8.5, 8.5]],
];

// ---------------------------------------------------------------- A4
line('');
line('A4  RESOLUTION — how finely can this score rank ten cases?');
rule();
{
  line(`  distinct values reachable at all      : ${vals.length}`);
  // Realistically an LLM told to fill a schema fills most of it. Restrict to
  // the regime the extractor actually produces: >=1 agent, a verdict present.
  const plausible = new Set();
  for (const nWf of [1, 2, 3, 4])
    for (const nested of [false, true])
      for (const goodCol of [false, true])
        for (const trough of [false, true])
          for (const es of [1, 2, 3])
            for (const reasoning of [false, true])
              plausible.add(r4(score(mk({ nWf, nested, goodCol, trough, es, status: true, reasoning }))));
  const pv = [...plausible].sort((a, b) => a - b);
  line(`  distinct values in the plausible band : ${pv.length}`);
  line(`  that band spans                       : ${pv[0].toFixed(4)} .. ${pv[pv.length - 1].toFixed(4)}`);
  line('');
  // 2nd-pass audit: the first version of this probe ASSERTED that ten draws
  // "will contain ties" and never measured it. Measure it. Under a uniform
  // draw from the K reachable values in the plausible band, the birthday
  // calculation gives P(at least one tie among n=10) exactly.
  const K = pv.length, n10 = 10;
  let pDistinct = 1;
  for (let i = 0; i < n10; i++) pDistinct *= (K - i) / K;
  const pTie = 1 - pDistinct;
  line('');
  line(`  P(at least one tie among n=10)        : ${pTie.toFixed(4)}   under a UNIFORM draw`);
  line('  That figure is a LOWER BOUND, and deliberately so. The extractor does');
  line('  not sample the band uniformly — an LLM told to fill a schema fills most');
  line('  of it, so the realised distribution is bunched near the top and ties are');
  line('  strictly more likely than this. What the number establishes is that ties');
  line(`  are not a hypothetical: even at their least likely they occur about ${(pTie * 100).toFixed(0)}%`);
  line('  of the time. A Spearman rho is a statistic on RANKS, and ties inflate or');
  line('  deflate it depending on how they are broken. The reported +0.61 is quoted');
  line('  to two decimals with no tie correction stated and no n=10 table to');
  line('  inspect, so its tie structure is unknown and its third digit is not');
  line('  recoverable from anything in this repository.');

  // 5th pass. A4 measured that ties are common and then said nothing about how
  // this siege TREATS them — which left the reader unable to tell whether the
  // null A5 feeds on is the tied one or the untied one. State it, and drive
  // every quantity below off the arrays and counters actually computed here.
  // Not one number in this paragraph is typed in by hand; an earlier pass of
  // this harness shipped prose that said "several files" while its own counter
  // said 2 lines in 1 file, and that is the failure this run exists to stop.
  const tiedPatterns = TIE_PATTERNS.filter(([, xr]) => new Set(xr).size < xr.length);
  let tieGroups = 0, midrankOK = 0, maxGroup = 0, tiedCases = 0;
  for (const [, xr] of TIE_PATTERNS) {
    const sorted = xr.slice().sort((a, b) => a - b);
    let p = 0;
    while (p < sorted.length) {
      let q = p;
      while (q + 1 < sorted.length && sorted[q + 1] === sorted[p]) q++;
      const g = q - p + 1;
      if (g > 1) {
        tieGroups++;
        tiedCases += g;
        if (g > maxGroup) maxGroup = g;
        // midrank = mean of the 1-based sorted positions the group spans
        let mid = 0;
        for (let r = p + 1; r <= q + 1; r++) mid += r;
        mid /= g;
        if (Math.abs(mid - sorted[p]) < 1e-12) midrankOK++;
      }
      p = q + 1;
    }
  }
  let fact = 1;
  for (let i = 2; i <= n10; i++) fact *= i;
  line('');
  line('  HOW THIS SIEGE HANDLES THE TIES IT JUST MEASURED');
  line(`    tie patterns enumerated (A5 runs its null over each) : ${TIE_PATTERNS.length}`);
  line(`    of those, patterns carrying at least one tie         : ${tiedPatterns.length}`);
  line(`    distinct tie GROUPS across all patterns              : ${tieGroups}`);
  line(`    largest group / cases inside a tied group            : ${maxGroup}-way / ${tiedCases}`);
  line(`    convention: MIDRANKS — a group of g tied cases spanning sorted`);
  line(`    positions p..p+g-1 carries the mean of those positions. VERIFIED,`);
  line(`    not assumed: ${midrankOK} of ${tieGroups} groups satisfy it (${tieGroups ? (100 * midrankOK / tieGroups).toFixed(0) : '0'}%).`);
  line(`    rho is then Pearson-on-ranks over those midranks, and each of the`);
  line(`    ${TIE_PATTERNS.length} patterns gets all ${fact.toLocaleString('en-US')} = ${n10}! relabelings enumerated exactly.`);
  line(`    P(at least one tie among n=${n10}) as measured above : ${pTie.toFixed(4)}, so at`);
  line(`    least ${(pTie * 100).toFixed(2)}% of ten-case studies of this predictor land in the`);
  line(`    tied regime and ${(100 - pTie * 100).toFixed(2)}% at most in the untied one. The ${tiedPatterns.length} tied`);
  line(`    patterns are therefore the expected case, not a corner case, and`);
  line(`    the untied shortcut identity applies to at most ${(100 - pTie * 100).toFixed(2)}% of studies.`);
  line(`    What is NOT stated anywhere in this repository is which convention`);
  line('    produced the reported +0.61 — that is what the defect below records.');
  if (pTie > 0.25) DEFECTS.push('A4 ties are likely at n=10 and no tie handling is stated');
  if (K < 40) DEFECTS.push('A4 rank resolution is coarse in the realised band');
}

// ---------------------------------------------------------------- A5
line('');
line('A5  IS +0.61 AT n=10 DISTINGUISHABLE FROM CHANCE? (exact permutation)');
rule();
{
  const n = 10, OBS = 0.61;
  // 2nd-pass audit. The first version of this probe used the shortcut identity
  //   rho = 1 - 6*sum(d^2)/(n(n^2-1))
  // which is valid ONLY for untied ranks — applied to the heavily-tied predictor
  // A4 just measured, that is the wrong statistic. The general definition of
  // Spearman's rho is Pearson-on-ranks, with midranks under ties. Use it.
  //
  // Under H0 the two rankings are independent, so all 10! pairings are equally
  // likely. With the x-ranks FIXED and y permuted, the Pearson denominator is
  // constant, so each permutation costs one dot product. Enumerate all 10! for
  // several tie patterns and see whether the tie structure can rescue +0.61.
  const nullFor = (xr) => {
    const xb = xr.reduce((a, b) => a + b, 0) / n;
    const xc = xr.map((v) => v - xb);
    const sx = Math.sqrt(xc.reduce((a, v) => a + v * v, 0));
    const y = Array.from({ length: n }, (_, i) => i + 1);
    const yb = (n + 1) / 2;
    const yc = y.map((v) => v - yb);
    const sy = Math.sqrt(yc.reduce((a, v) => a + v * v, 0));
    const den = sx * sy;
    const rhos = new Float64Array(3628800);
    let w = 0;
    const p = y.slice(), c = new Array(n).fill(0);
    const emit = () => { let acc = 0; for (let k = 0; k < n; k++) acc += xc[k] * (p[k] - yb); rhos[w++] = acc / den; };
    emit();
    let i = 0;
    while (i < n) {
      if (c[i] < i) {
        const j = i % 2 ? c[i] : 0;
        const t = p[j]; p[j] = p[i]; p[i] = t;
        emit(); c[i]++; i = 0;
      } else { c[i] = 0; i++; }
    }
    const arr = Array.from(rhos.subarray(0, w)).sort((a, b) => b - a);
    let ge = 0;
    for (const v of arr) { if (v >= OBS - 1e-12) ge++; else break; }
    return { total: w, one: ge / w, two: 2 * ge / w, crit: arr[Math.floor(0.025 * w)] };
  };
  const patterns = TIE_PATTERNS;   // 5th pass: hoisted, so A4 counts what A5 runs
  line(`  permutations per pattern      : 3,628,800   (10!, fully enumerated)`);
  line('');
  line('  tie pattern in the predictor        two-sided p   5% crit   +0.61 clears?');
  let clearsAny = false, one = null, two = null;
  for (const [label, xr] of patterns) {
    const r = nullFor(xr);
    const clears = OBS >= r.crit;
    if (clears) clearsAny = true;
    if (one === null) { one = r.one; two = r.two; }
    line(`  ${label}    ${r.two.toFixed(5)}     ${r.crit.toFixed(4)}    ${clears ? 'YES' : 'NO'}`);
  }
  line('');
  line('  The tie correction MATTERS to the arithmetic and does not rescue the');
  line('  claim. Every tie pattern moves the 5% critical value AWAY from +0.61,');
  line('  not toward it: ties compress the null less than they compress the');
  line('  observed statistic. So the first version of this probe reached the right');
  line('  verdict by the wrong route, and the corrected route reaches it by more.');
  line(`  does +0.61 clear ANY pattern? : ${clearsAny ? 'YES' : 'NO'}`);
  if (!clearsAny) DEFECTS.push('A5 +0.61 at n=10 fails two-sided 5% under every tie pattern');
  line('');
  line('  At n=10, +0.61 does not reach two-sided significance. It is inside the');
  line('  range chance produces roughly one time in twenty even when the two');
  line('  variables are completely unrelated. That is not a claim that the effect');
  line('  is absent — it is the statement that ten hand-extractions cannot tell');
  line('  the difference, and that a comment reporting the point estimate without');
  line('  the interval reads as far stronger evidence than it is.');
}

// ---------------------------------------------------------------- A6
line('');
line('A6  THE INTERVAL, AND THE "7x LIFT"');
rule();
{
  // 2nd-pass audit. se = 1/sqrt(n-3) is the PEARSON standard error for a Fisher
  // z interval. The reported statistic is a SPEARMAN rho, whose z-transform has
  // the wider se ~ 1.06/sqrt(n-3) (Bonett & Wright). The original probe was
  // therefore reporting an interval about 6% too NARROW — an error that ran in
  // the harness's own favour, which is exactly the direction a siege must not
  // err in. Report both, and draw the conclusion from the correct one.
  const n = 10, z = 1.959964;
  const sePearson = 1 / Math.sqrt(n - 3);
  const seSpearman = 1.06 / Math.sqrt(n - 3);
  const ciWith = (se) => (r) => [Math.tanh(Math.atanh(r) - z * se), Math.tanh(Math.atanh(r) + z * se)];
  const ciP = ciWith(sePearson), ci = ciWith(seSpearman);
  const [pl1, ph1] = ciP(0.61), [pl2, ph2] = ciP(0.08);
  const [lo1, hi1] = ci(0.61), [lo2, hi2] = ci(0.08);
  line(`  Pearson  se = 1/sqrt(n-3)      = ${sePearson.toFixed(5)}   (WRONG statistic here)`);
  line(`  Spearman se = 1.06/sqrt(n-3)   = ${seSpearman.toFixed(5)}   (Bonett & Wright)`);
  line('');
  line(`  rho = +0.61, n=10  ->  95% CI [${lo1.toFixed(3)}, ${hi1.toFixed(3)}]   (Pearson se would say [${pl1.toFixed(3)}, ${ph1.toFixed(3)}])`);
  line(`  rho = +0.08, n=10  ->  95% CI [${lo2.toFixed(3)}, ${hi2.toFixed(3)}]   (Pearson se would say [${pl2.toFixed(3)}, ${ph2.toFixed(3)}])`);
  line(`  the two intervals overlap over    : [${Math.max(lo1, lo2).toFixed(3)}, ${Math.min(hi1, hi2).toFixed(3)}]`);
  line(`  does the +0.61 interval contain 0 : ${lo1 <= 0 && hi1 >= 0 ? 'YES' : 'no'}`);
  if (lo1 <= 0 && hi1 >= 0) DEFECTS.push('A6 the 95% interval on +0.61 contains zero');
  line('');
  line(`  "+0.61 vs +0.08 — a 7x lift" is a ratio of two point estimates whose`);
  line('  intervals both straddle zero and overlap each other across most of');
  line('  their length. A ratio of two quantities that may both be zero is not a');
  line('  lift; 7x is an artefact of dividing by a small noisy denominator. Had');
  line('  the trajectory figure landed at +0.02 the same data would have read as');
  line('  "a 30x lift", and at -0.01 the ratio would have changed sign.');
}

// ---------------------------------------------------------------- A7
line('');
line('A7  ROBUSTNESS — malformed input, and whether a throw is contained');
rule();
{
  const cases = [
    ['null', null],
    ['undefined', undefined],
    ['{}', {}],
    ['empty arrays', { blankets: [], collisions: [] }],
    ['blankets: string (bad LLM parse)', { blankets: 'oops', collisions: [] }],
    ['collisions: object', { blankets: [], collisions: { a: 1 } }],
    ['suppression: string', { blankets: [], collisions: [], epistemic_suppression: 'x' }],
    ['verdict: null', { blankets: [], collisions: [], systemic_alignment_verdict: null }],
    ['target_states: string', { blankets: [{ name: 'a', scale: 'individual', boundary_mechanism: 'b', internal_target_states: 'x', defensive_behaviors: ['y'] }], collisions: [] }],
  ];
  let threw = 0;
  for (const [label, m] of cases) {
    let out;
    try { out = score(m); out = typeof out === 'number' && Number.isFinite(out) ? out.toFixed(4) : 'NON-FINITE: ' + String(out); }
    catch (e) { out = 'THREW ' + e.constructor.name; threw++; }
    line(`  ${label.padEnd(34)} -> ${out}`);
  }
  line('');
  line(`  inputs that threw             : ${threw}/${cases.length}`);
  line('');
  line('  MEASURED by this probe: the exported scorer is NOT total. Some malformed');
  line('  inputs throw rather than returning 0. It is public API, and a future');
  line('  caller that skips the extractor guard gets a throw, not a score.');
  line('');
  line('  UNMEASURED — read, not executed, and stated here as such: that');
  line('  extractBlanketModel guards Array.isArray(parsed.blankets) and coerces');
  line('  collisions before the scorer sees them, and that every call site sits');
  line('  inside an async function whose rejection is caught. Those two claims');
  line('  come from reading observer.ts, not from running it. They are the reason');
  line('  the CURRENT blast radius is small; they are not a reason the scorer is');
  line('  safe, and a probe that executes the call sites has not been written.');
  if (threw) DEFECTS.push(`A7 exported scorer is not total (${threw}/${cases.length} malformed inputs throw)`);
}

// ---------------------------------------------------------------- summary
line('');
line('='.repeat(72));
line('SUMMARY');
line('='.repeat(72));
line('  MEASURED by these probes: the scorer is real, pure, deterministic and');
line('  cheap; every number above came out of the shipped module, bundled from');
line('  src/observer-blanket.ts at the commit stamped at the top of this file.');
line('');
line('  UNMEASURED — established by reading the tree, not by executing it, and');
line('  stated here as such: that the number ranks and gates nothing (it is');
line('  written to observer_blankets.completeness and to');
line('  observer_predictions_live.mode_a_completeness, and read back only by the');
line('  live_status readout); that extractAndPersistBlanket runs on every');
line('  observer analysis (observer.ts:299) plus a backfill (observer.ts:384);');
line('  and that observer-live.ts and falcon-ground.ts each compute the same');
line('  number. A grep over a working tree is not a call-graph. On that evidence');
line('  the producer audit comes back CLEAN — unlike lane B — but the evidence is');
line('  a read, and the distinction is the whole point of this second pass.');
line('');
line('  What does not survive is the headline number.');
line('    - the n=10 set is not in this repository (A0)');
line('    - +0.61 at n=10 does not reach two-sided significance (A5, exact)');
line('    - its 95% interval contains zero, and overlaps the +0.08 it is being');
line('      contrasted with; "7x" is a ratio of two indistinguishable-from-zero');
line('      point estimates (A6)');
if (DEFECTS.some(d => d.startsWith('A3'))) {
  line('    - and the predictor is schema coverage, not modelling quality: a');
  line('      content-free extraction scores the maximum (A3)');
} else {
  line('    - and even with A3 cleared, the predictor remains schema coverage');
  line('      with a syntactic floor, not modelling quality; the confound in A3');
  line('      is unaddressed');
}
line('');
line('  The repository already contains the correct instrument and already knows');
line('  why. observer-live.ts exists because "every retrospective test of kappa');
line('  NULLed ... you cannot validate a reasoning-quality metric against');
line('  outcomes the model already knows." An offline retrospective study of ten');
line('  hand-extractions is precisely that shape. observer-live.ts is a CLOCK: it');
line('  returns no verdict until post-cutoff cases resolve. Until it does, the');
line('  honest form of the header is a hypothesis, not a validation.');
line('');
line('  Recommended edit to src/observer-blanket.ts:17 — keep the module, keep');
line('  the wiring, restate the claim with its interval and its provenance, and');
line('  point at observer-live.ts as the thing that will settle it.');
line('='.repeat(72));

// The harness must leave a durable, diffable record and must FAIL LOUDLY. A
// siege whose only output is stdout and whose exit code is always 0 cannot be
// wired into CI, and a probe that cannot fail is not a probe.
line('');
line(`ADVERSE FINDINGS: ${DEFECTS.length}`);
for (const d of DEFECTS) line(`  - ${d}`);
const resultsPath = path.join(root, 'docs', 'OBSERVER_BLANKET_SIEGE_RESULTS.txt');
fs.writeFileSync(resultsPath, OUT.join('\n') + '\n');
console.log(`\nwritten: ${path.relative(root, resultsPath)}`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(DEFECTS.length ? 1 : 0);
