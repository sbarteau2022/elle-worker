// ============================================================
// Portions adapted from togethercomputer/together-cookbook (MIT) —
// Conditional_Router.ipynb (routeStructured) and Parallel_Agent.ipynb
// (parallel-aggregate, logged below but not implemented — see its comment).
// Phase 2c of the port plan: "these three [Conditional_Router, Serial_Chain,
// Parallel_Agent] are thin and mostly duplicate what a nine-engine platform
// already has. Extract only: router-as-structured-output... implement only
// the router migration now."
//
// router.ts's own per-step "engine" hand-off ({"engine":"code"} etc., see
// runRouter()) was evaluated as the migration target and deliberately left
// alone: it isn't a standalone routing DECISION an LLM makes when asked —
// it's one optional field riding inside the single freeform JSON blob the
// model already emits every ReAct step (which also carries tool/args/
// thought/answer), validated with a plain Set.has() that silently no-ops on
// a bad value rather than failing the step. Migrating THAT to a
// schema-constrained call would mean redesigning the core per-step protocol
// across every free-tier provider Elle uses — out of scope for "implement
// only the router migration now." routeStructured below is that pattern,
// implemented and ready for the first NEW standalone N-way routing decision
// that needs it (Elle has none today prompt-parsed in that shape).
// ============================================================

import { z } from 'zod';
import { jsonLLM, runLLM } from '../llm';
import type { LLMEnv, LLMTask } from '../llm';

export interface RouteMap {
  [routeName: string]: string; // route name -> description, shown to the router LLM
}

export interface RouteDecision {
  selectedRoute: string;
}

// Router-as-structured-output: routes are a Dict[route_name, description];
// the router LLM must return one of the route names, constrained by an enum
// schema — not free text parsed with a hand-rolled extractor — so a
// misspelled/hallucinated route name is a validation error jsonLLM's
// one-retry repair loop can catch, instead of a silent misroute or a crash
// three calls downstream when the caller dispatches on an unrecognized name.
export async function routeStructured(
  env: LLMEnv,
  query: string,
  routes: RouteMap,
  opts: { task?: LLMTask; system?: string } = {}
): Promise<RouteDecision> {
  const routeNames = Object.keys(routes);
  if (routeNames.length < 2) throw new Error('routeStructured: routes needs at least two options to choose between');

  const [first, second, ...rest] = routeNames;
  const schema = z.object({ selected_route: z.enum([first, second, ...rest]) });

  const routesDescription = routeNames.map(name => `- ${name}: ${routes[name]}`).join('\n');
  // Prompt skeleton per the plan, ported near-verbatim.
  const prompt =
    `Given a user prompt/query: ${query}, select the best option out of the following routes:\n${routesDescription}\n\n` +
    `Answer only in JSON.`;

  const { data } = await jsonLLM(env, prompt, schema, {
    task: opts.task ?? 'fast',
    system: opts.system ?? 'You are a precise router. Return only the requested JSON — no prose.',
  });
  return { selectedRoute: data.selected_route };
}

// ── Evaluator loop (Looping_Agent_Workflow.ipynb, port plan §4.1) ──────────
// Generator produces, Evaluator returns structured {status, feedback}; FAIL
// feedback loops back into the Generator with the prior attempt attached,
// until PASS or the iteration cap. The cookbook leaves iterations open-ended;
// the plan says don't — capped at 3, hard.

const EVALUATOR_MAX_ITERATIONS = 3;

const EvalVerdictSchema = z.object({
  status: z.enum(['PASS', 'FAIL']),
  feedback: z.string(),
});

export interface EvaluatorLoopResult {
  output: string;
  passed: boolean;
  iterations: number;
  feedback: string[]; // one entry per FAIL round, in order
}

export async function generateWithEvaluator(
  env: LLMEnv,
  task: string,
  criteria: string,
  opts: { generatorTask?: LLMTask; evaluatorTask?: LLMTask; generatorSystem?: string; prefer?: 'local' } = {}
): Promise<EvaluatorLoopResult> {
  const feedback: string[] = [];
  let output = '';
  for (let i = 0; i < EVALUATOR_MAX_ITERATIONS; i++) {
    const genPrompt = feedback.length
      ? `${task}\n\nYOUR PREVIOUS ATTEMPT:\n${output}\n\nEVALUATOR FEEDBACK (fix these, keep what worked):\n${feedback[feedback.length - 1]}`
      : task;
    output = await runLLM(env, genPrompt, {
      task: opts.generatorTask ?? 'reasoning',
      system: opts.generatorSystem,
      prefer: opts.prefer,
    });
    const { data: verdict } = await jsonLLM(
      env,
      `ACCEPTANCE CRITERIA:\n${criteria}\n\nTHE WORK TO EVALUATE:\n${output.slice(0, 8000)}\n\nDoes the work meet every criterion? Reply {"status":"PASS"|"FAIL","feedback":"specific, actionable — what to fix and how"}.`,
      EvalVerdictSchema,
      { task: opts.evaluatorTask ?? 'reasoning', system: 'You are a strict evaluator. PASS only when every criterion is genuinely met — a generous PASS defeats the loop.', prefer: opts.prefer },
    );
    if (verdict.status === 'PASS') return { output, passed: true, iterations: i + 1, feedback };
    feedback.push(verdict.feedback);
  }
  // Cap reached: return the last attempt honestly marked unpassed — the
  // caller decides whether an unpassed draft is still worth using.
  return { output, passed: false, iterations: EVALUATOR_MAX_ITERATIONS, feedback };
}

// ── Logged, not implemented (plan's explicit scope for this pass) ──────────
//
// Parallel aggregate pattern (Parallel_Agent.ipynb): N models answer the
// same prompt independently; an aggregator LLM synthesizes the set into one
// answer. Candidate Elle uses per the plan (§6): κ-adjacent second opinions,
// grant-draft critique. Shape for whoever picks this up next:
//
//   parallelAggregate(env, prompt, opts: { tasks: LLMTask[]; aggregatorTask?: LLMTask }):
//     Promise<{ answers: string[]; aggregated: string }>
//
// — run `prompt` once per task in `opts.tasks` (via callLLM, Promise.all),
// then feed all N answers into one more call asking the aggregator model to
// synthesize them. Left as a documented primitive rather than implemented:
// the plan is explicit ("implement only the router migration now") and
// there's no concrete Elle call site for it yet.
