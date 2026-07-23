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
import { jsonLLM } from '../llm';
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
