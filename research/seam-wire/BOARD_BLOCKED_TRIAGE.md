[MEASURED] Listed blocked tasks through the bridge, inspected nine representative task timelines, and classified the latest blocker on all 709 blocked records in a read-only board snapshot.
[DERIVED] The largest common terminal blocker is κ sign-off (467/709); 75 blocked records have an exact approved counterpart and are conditional cancellation candidates, not automatically disposable experiments.

# Board blocked triage

[MEASURED] Snapshot time: 2026-09-09T16:23:42.501660+00:00. Board SHA-256: `78af53903e37106f52133942a61043dbc95e2ae5716f7712c7e7a79e9f2590de`. Source: `~/agent-bridge/data/board.json`; bridge_list_tasks(status='blocked') independently returned 709. Board statuses: {'approved': 166, 'cancelled': 267, 'submitted': 435, 'blocked': 709, 'claimed': 6, 'open': 15}. No claims, directives, cancellations, reviews or writes to the board were made.

[DESIGN CHOICE] Count the LAST `blocked` event on each currently blocked task. A task can have failed earlier for a different reason. This yields mutually exclusive terminal categories; overlapping underlying causes are discussed separately. Worker and coordinator text are evidence of what they reported, not trusted truth about task correctness.

| [MEASURED] Latest blocker | Count | Percent of 709 |
|---|---:|---:|
| kappa | 467 | 65.87% |
| error | 200 | 28.21% |
| budget | 16 | 2.26% |
| deadline | 10 | 1.41% |
| coordinator rejection | 9 | 1.27% |
| requirements | 5 | 0.71% |
| screen | 1 | 0.14% |
| loop | 1 | 0.14% |

| [MEASURED] Runtime-error subtype | Count |
|---|---:|
| Metal insufficient memory | 120 |
| empty/no reply | 30 |
| ECONNREFUSED | 20 |
| NoneType layers | 14 |
| other runtime error | 10 |
| fetch failed | 6 |

[DERIVED] “One root cause” is too strong for all 709. There are 467 records with a shared terminal sign-off mechanism (65.87%) and 120 with the same reported Metal OOM failure signature (16.93%). These groups are disjoint under this classification. Neither establishes a single causal defect for every member. In current `Elle/electron/native/swarm-worker.cjs:708–725`, grounding adds recovery or strain and the κ gate can replace an existing budget/deadline reason; at :734 failures are sent to the board as blockers. Thus some κ records conceal earlier budget/deadline exhaustion. Do not sum all mentions as separate tasks or disable the gate from these counts.

[MEASURED] Bridge timeline sample: #25 κ refusal after failed sandbox execution; #349 no model content; #350 missing required web_search; #435 exhausted 24 steps after echo recovery actions; #445 repeatedly retried pooling benchmark, ending on deadline; #773 arithmetic answer refused by harm screen; #1053 six-run_code brief refused for repeated run_code actions; #1058 repeated coordinator rejection; #1581 deadline after five thinking steps. The sample spans every terminal category plus oldest/recent entries; counts come from the complete census, not extrapolation from the sample.

[MEASURED] Thirty latest blockers report zero failed execs and at least one pass in the older sign-off format. This does not prove those answers correct or the gate broken: grounding, prior strain and the then-current rule need reconstruction. #773's quoted 5+8−3−1=9 arithmetic is correct, yet the record says the harm screen answered yes. #1058's coordinator objection itself says 20+25+70+60=110; the sum is 175. [DERIVED] These examples warrant reviewer/gate audits; a rejection message is not a gold label. #1053 suggests the loop detector may confuse repeated tool names with repeated actions, but its complete tool inputs are needed to establish that defect.

[OPEN] Root-cause work remaining: reconstruct κ state from the affected run versions and observations; correlate OOM timestamps with worker concurrency and model residency; inspect loop comparison keys and screen prompts. Existing logs may suffice. No model restart, embed loop or threshold change was attempted. These are diagnostic proposals, not claims that today's runtime still has each historical fault.

## Age, duplicates and cancellation proposals

[MEASURED] Latest activity dates by UTC calendar date:

- 2026-09-02: 148.
- 2026-09-03: 8.
- 2026-09-04: 2.
- 2026-09-05: 2.
- 2026-09-06: 412.
- 2026-09-07: 98.
- 2026-09-08: 39.

[MEASURED] Titles classify 528 as GSM8K, 145 as Eval, and 36 as other. Exact equality of BOTH title and brief identifies 75 blocked records with at least one approved counterpart; 61 have a later-sequence approved counterpart. This is stronger than title similarity but does not imply identical model/configuration, directives or experimental intent. All activity is dated September 2–8; age alone is insufficient to cancel active engineering requirements.

[DESIGN CHOICE] Proposed first cancellation set: the following 75 blocked attempts, only after the owner confirms the approved counterpart satisfies the same present objective and that the blocked attempt need not remain in an active experimental cohort. Preserve its events and failure outcome even if its workflow status becomes cancelled. This is a concrete candidate set for review, not an executed cancellation. Repeated controlled trials should be retained as completed failures rather than silently treated as duplicates. Recheck current status and directives immediately before any owner action.

| [MEASURED] Blocked ref | Approved exact counterpart(s) | Last activity UTC |
|---|---|---|
| #28 | #361, #371, #381, #391, #401 | 2026-09-02T17:29:01.443Z |
| #36 | #361, #371, #381, #391, #401 | 2026-09-02T17:31:57.637Z |
| #111 | #386, #396, #406 | 2026-09-02T17:48:52.229Z |
| #189 | #354, #364, #374 | 2026-09-02T17:57:43.315Z |
| #190 | #355, #365, #375, #385, #395, #405 | 2026-09-02T17:57:49.743Z |
| #194 | #359, #369, #379, #389, #399, #409 | 2026-09-02T17:58:12.197Z |
| #195 | #360, #370, #380, #390, #410 | 2026-09-02T17:58:18.002Z |
| #196 | #361, #371, #381, #391, #401 | 2026-09-02T17:58:18.561Z |
| #201 | #386, #396, #406 | 2026-09-02T17:59:16.646Z |
| #204 | #359, #369, #379, #389, #399, #409 | 2026-09-02T17:59:24.231Z |
| #205 | #360, #370, #380, #390, #410 | 2026-09-02T17:59:24.697Z |
| #208 | #383, #393, #413 | 2026-09-02T17:59:29.306Z |
| #209 | #354, #364, #374 | 2026-09-02T17:59:28.635Z |
| #214 | #359, #369, #379, #389, #399, #409 | 2026-09-02T17:59:40.320Z |
| #215 | #360, #370, #380, #390, #410 | 2026-09-02T17:59:38.886Z |
| #217 | #392, #402, #412 | 2026-09-02T18:00:07.244Z |
| #218 | #383, #393, #413 | 2026-09-02T17:59:58.679Z |
| #219 | #354, #364, #374 | 2026-09-02T18:00:10.985Z |
| #225 | #360, #370, #380, #390, #410 | 2026-09-02T18:00:21.515Z |
| #226 | #361, #371, #381, #391, #401 | 2026-09-02T18:00:22.358Z |
| #228 | #383, #393, #413 | 2026-09-02T18:00:29.215Z |
| #229 | #354, #364, #374 | 2026-09-02T18:00:28.605Z |
| #230 | #355, #365, #375, #385, #395, #405 | 2026-09-02T18:01:04.233Z |
| #234 | #359, #369, #379, #389, #399, #409 | 2026-09-02T18:01:08.810Z |
| #235 | #360, #370, #380, #390, #410 | 2026-09-02T18:01:07.580Z |
| #238 | #383, #393, #413 | 2026-09-02T18:01:39.219Z |
| #239 | #354, #364, #374 | 2026-09-02T18:02:01.745Z |
| #240 | #355, #365, #375, #385, #395, #405 | 2026-09-02T18:02:12.679Z |
| #242 | #357, #367, #377, #397 | 2026-09-02T18:02:16.472Z |
| #244 | #359, #369, #379, #389, #399, #409 | 2026-09-02T18:02:25.043Z |
| #245 | #360, #370, #380, #390, #410 | 2026-09-02T18:02:23.752Z |
| #248 | #383, #393, #413 | 2026-09-02T18:02:38.616Z |
| #269 | #354, #364, #374 | 2026-09-02T18:09:26.629Z |
| #274 | #359, #369, #379, #389, #399, #409 | 2026-09-02T18:09:32.909Z |
| #275 | #360, #370, #380, #390, #410 | 2026-09-02T18:09:31.787Z |
| #278 | #383, #393, #413 | 2026-09-02T18:09:59.348Z |
| #279 | #354, #364, #374 | 2026-09-02T18:09:57.685Z |
| #280 | #355, #365, #375, #385, #395, #405 | 2026-09-02T18:10:10.598Z |
| #284 | #359, #369, #379, #389, #399, #409 | 2026-09-02T18:10:15.462Z |
| #285 | #360, #370, #380, #390, #410 | 2026-09-02T18:10:21.320Z |
| #286 | #361, #371, #381, #391, #401 | 2026-09-02T18:10:21.951Z |
| #288 | #383, #393, #413 | 2026-09-02T18:10:37.332Z |
| #318 | #383, #393, #413 | 2026-09-02T18:15:39.327Z |
| #320 | #355, #365, #375, #385, #395, #405 | 2026-09-02T18:15:50.266Z |
| #321 | #386, #396, #406 | 2026-09-02T18:16:07.043Z |
| #328 | #383, #393, #413 | 2026-09-02T18:16:11.441Z |
| #358 | #388, #398, #408 | 2026-09-02T20:57:21.609Z |
| #362 | #392, #402, #412 | 2026-09-02T20:57:37.739Z |
| #363 | #383, #393, #413 | 2026-09-02T20:57:29.781Z |
| #368 | #388, #398, #408 | 2026-09-02T20:57:44.667Z |
| #372 | #392, #402, #412 | 2026-09-02T20:57:46.276Z |
| #373 | #383, #393, #413 | 2026-09-02T20:57:51.339Z |
| #378 | #388, #398, #408 | 2026-09-02T20:57:52.717Z |
| #382 | #392, #402, #412 | 2026-09-02T20:58:01.792Z |
| #384 | #354, #364, #374 | 2026-09-02T21:06:15.328Z |
| #387 | #357, #367, #377, #397 | 2026-09-02T21:06:54.688Z |
| #394 | #354, #364, #374 | 2026-09-02T21:07:06.559Z |
| #400 | #360, #370, #380, #390, #410 | 2026-09-02T21:07:46.556Z |
| #403 | #383, #393, #413 | 2026-09-02T21:07:53.758Z |
| #404 | #354, #364, #374 | 2026-09-02T21:08:08.031Z |
| #407 | #357, #367, #377, #397 | 2026-09-02T21:08:16.205Z |
| #411 | #361, #371, #381, #391, #401 | 2026-09-02T21:08:49.676Z |
| #450 | #451 | 2026-09-06T16:20:18.705Z |
| #1061 | #1161 | 2026-09-06T22:51:34.122Z |
| #1062 | #1162 | 2026-09-06T23:01:11.313Z |
| #1065 | #1165 | 2026-09-06T23:01:07.686Z |
| #1519 | #1499 | 2026-09-07T20:37:15.165Z |
| #1520 | #1500 | 2026-09-07T20:37:15.618Z |
| #1521 | #1501 | 2026-09-07T20:37:35.980Z |
| #1522 | #1502 | 2026-09-07T20:37:37.173Z |
| #1523 | #1503 | 2026-09-07T20:37:37.190Z |
| #1524 | #1504 | 2026-09-07T20:37:58.062Z |
| #1525 | #1505 | 2026-09-07T20:37:59.220Z |
| #1526 | #1506 | 2026-09-07T20:37:59.238Z |
| #1576 | #1556 | 2026-09-08T02:30:20.890Z |

[DESIGN CHOICE] Retain the other 634 pending purpose review. Do not bulk-cancel the 673 GSM8K/Eval rows simply because they are benchmarks: failures are data. In particular, #421/#423/#425/#428/#430/#441 are engineering work, and #445 is an unfinished benchmark implementation; age is not evidence of completion. #773 and #1053 are useful regression cases. The owner may archive retired smoke-test attempts after preserving their result history; their title alone is insufficient authorization to cancel.

[OPEN] Refutation conditions: a new snapshot with different statuses invalidates these counts as current state; an event-parser mismatch invalidates the classification; later directives or distinct trial intent defeat “superseded” for any candidate. A full causal replay may show κ refusal appropriate, or reveal a defect narrower than the 467-record category. Evidence that an OOM was a single propagated server fault rather than independent allocations changes the causal count but not the 120 recorded terminal symptoms.

[DERIVED] Geometry status: INSTRUMENTATION. This board census and code-path diagnosis can be reproduced by flat event analysis; it offers no geometry-specific mechanism evidence.
