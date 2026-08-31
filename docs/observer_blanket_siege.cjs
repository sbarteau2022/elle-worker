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
const line = (s) => console.log(s);
const rule = () => line('-'.repeat(72));

line('='.repeat(72));
line('LANE A SIEGE — observer/blanket completeness');
line('='.repeat(72));

// ---------------------------------------------------------------- A0
line('');
line('A0  PROVENANCE — is the n=10 validation set in this repository?');
rule();
{
  const exts = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.md', '.json', '.txt', '.csv', '.sql']);
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
  const selfSites = new Set([
    path.join(root, 'docs/observer_blanket_siege.cjs'),
    path.join(root, 'docs/OBSERVER_BLANKET_SIEGE_RESULTS.txt'),
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
  const dataPat  = /completeness\s*[,:|]\s*fidelity|fidelity\s*[,:|]\s*completeness|blanket_fidelity|VALIDATION_SET|hand_extractions?/i;

  const restatements = [];   // lines that ASSERT the retrospective result
  const forward     = [];    // lines that build the FORWARD test instead
  const candidates   = [];   // lines that could HOLD the data
  for (const f of files) {
    if (selfSites.has(f)) continue;
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rel = path.relative(root, f);
    txt.split('\n').forEach((l, i) => {
      if (claimPat.test(l)) restatements.push([rel, i + 1, l.trim().slice(0, 92)]);
      else if (fwdPat.test(l)) forward.push([rel, i + 1, l.trim().slice(0, 92)]);
      if (dataPat.test(l))  candidates.push([rel, i + 1, l.trim().slice(0, 92)]);
    });
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
  if (candidates.length === 0) {
    line('  VERDICT: no scored validation set exists in this repository. The');
    line(`           retrospective result is asserted in ${restateFiles.length} file(s) and evidenced in`);
    line('           none. Restating it in a schema comment and a second module does');
    line('           not corroborate it — every copy traces to the same unsourced');
    line('           number, so repetition only widens the blast radius if it is wrong.');
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
line(`  distinct reachable scores    : ${vals.length}`);
line(`  minimum                      : ${vals[0].toFixed(4)}`);
line(`  MAXIMUM                      : ${vals[vals.length - 1].toFixed(4)}`);
line(`  the source clamps with Math.min(..., 1)`);
line(`  does that clamp ever engage? : ${vals[vals.length - 1] >= 1 ? 'YES' : 'NO — it is dead code'}`);
line('');
line('  The weight blocks sum to 0.96, not 1.00. A perfect extraction — every');
line('  field present, three well-formed agents, a nested parent, a classified');
line('  collision with a trough signature, all three suppression fields, and a');
line('  verdict with reasoning — scores 0.9600 and can never score higher. The');
line('  metric is not on a [0,1] scale despite being clamped to one and being');
line('  read as a fraction. Any downstream consumer that treats 1.0 as the');
line('  ceiling is calibrated against a point the function cannot reach.');

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
  line('');
  line('  Every predicate in the scorer is a presence test — !!b.name, .length');
  line('  >= 1, Boolean(field). None of them reads content. So the score is a');
  line('  measure of SCHEMA COVERAGE, not of modelling quality, and the two are');
  line('  not the same variable. That matters more here than it would elsewhere:');
  line('  the producer is an LLM asked to fill this exact schema, and filling a');
  line('  schema is the one thing an LLM will do whether or not the material');
  line('  supports it. The extraction prompt says "do not invent structure it did');
  line('  not infer" — the scorer pays for inventing it anyway.');
  line('');
  line('  The direction of the bias is the problem. If completeness is really a');
  line('  proxy for schema-filling eagerness, then a correlation with downstream');
  line('  fidelity is exactly what you would ALSO see if eager runs were simply');
  line('  the runs on richer dockets. The claim needs the confound ruled out;');
  line('  nothing in this repo rules it out.');
}

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
  line('  A Spearman rho is a statistic on RANKS. With a coarse, heavily-tied');
  line('  predictor, ten observations will contain ties, and ties inflate or');
  line('  deflate rho depending on how they are broken. The reported +0.61 is');
  line('  quoted to two decimals with no tie correction stated and no n=10');
  line('  table to inspect, so its tie structure is unknown.');
}

// ---------------------------------------------------------------- A5
line('');
line('A5  IS +0.61 AT n=10 DISTINGUISHABLE FROM CHANCE? (exact permutation)');
rule();
{
  const n = 10;
  // Under H0 the two rankings are independent, so every one of the 10! pairings
  // is equally likely. Enumerate all of them — exact, no simulation, no table.
  const S_of = (p) => { let s = 0; for (let i = 0; i < n; i++) { const d = i - p[i]; s += d * d; } return s; };
  const rho_of = (S) => 1 - (6 * S) / (n * (n * n - 1));
  const counts = new Map();
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  const bump = () => { const S = S_of(a); counts.set(S, (counts.get(S) || 0) + 1); };
  bump();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      const t = a[i]; a[i] = a[j]; a[j] = t;
      bump();
      c[i]++; i = 0;
    } else { c[i] = 0; i++; }
  }
  let total = 0; for (const v of counts.values()) total += v;
  const tail = (obs) => {
    let ge = 0;
    for (const [S, k] of counts) if (rho_of(S) >= obs - 1e-12) ge += k;
    return ge / total;
  };
  const OBS = 0.61;
  const one = tail(OBS);
  const two = 2 * one;
  // The exact two-sided 5% critical value.
  const sorted = [...counts.entries()].map(([S, k]) => [rho_of(S), k]).sort((x, y) => y[0] - x[0]);
  let acc = 0, crit = null;
  for (const [rho, k] of sorted) { acc += k; if (acc / total > 0.025) break; crit = rho; }
  line(`  permutations enumerated       : ${total.toLocaleString('en-US')}   (10! = 3,628,800)`);
  line(`  P(rho >= +0.61 | H0)          : ${one.toFixed(5)}   one-sided`);
  line(`  P(|rho| >= 0.61 | H0)         : ${two.toFixed(5)}   two-sided`);
  line(`  exact two-sided 5% critical   : rho = ${crit.toFixed(4)}`);
  line(`  does +0.61 clear it?          : ${OBS >= crit ? 'YES' : 'NO'}`);
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
  const n = 10, se = 1 / Math.sqrt(n - 3), z = 1.959964;
  const ci = (r) => [Math.tanh(Math.atanh(r) - z * se), Math.tanh(Math.atanh(r) + z * se)];
  const [lo1, hi1] = ci(0.61), [lo2, hi2] = ci(0.08);
  line(`  rho = +0.61, n=10  ->  95% CI [${lo1.toFixed(3)}, ${hi1.toFixed(3)}]`);
  line(`  rho = +0.08, n=10  ->  95% CI [${lo2.toFixed(3)}, ${hi2.toFixed(3)}]`);
  line(`  the two intervals overlap over    : [${Math.max(lo1, lo2).toFixed(3)}, ${Math.min(hi1, hi2).toFixed(3)}]`);
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
  line('  extractBlanketModel guards Array.isArray(parsed.blankets) and coerces');
  line('  collisions before the scorer sees them, so the LLM path is protected,');
  line('  and every call site is inside an async function whose rejection is');
  line('  caught. The exported scorer itself is NOT total, though: it is public');
  line('  API and a future caller that skips the guard gets a throw, not a 0.');
}

// ---------------------------------------------------------------- summary
line('');
line('='.repeat(72));
line('SUMMARY');
line('='.repeat(72));
line('  The scorer is real, pure, deterministic and cheap. Its header is honest');
line('  about behaviour: the number ranks and gates nothing, and a full grep');
line('  confirms it — it is written to observer_blankets.completeness and');
line('  observer_predictions_live.mode_a_completeness and read back only by the');
line('  live_status readout. Unlike lane B, the producer audit comes back CLEAN:');
line('  extractAndPersistBlanket really does run on every observer analysis');
line('  (observer.ts:299) plus a backfill (observer.ts:384), and observer-live.ts');
line('  and falcon-ground.ts each compute the same number.');
line('');
line('  What does not survive is the headline number.');
line('    - the n=10 set is not in this repository (A0)');
line('    - +0.61 at n=10 does not reach two-sided significance (A5, exact)');
line('    - its 95% interval contains zero, and overlaps the +0.08 it is being');
line('      contrasted with; "7x" is a ratio of two indistinguishable-from-zero');
line('      point estimates (A6)');
line('    - and the predictor is schema coverage, not modelling quality: a');
line('      content-free extraction scores the maximum (A3)');
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

fs.rmSync(tmp, { recursive: true, force: true });
