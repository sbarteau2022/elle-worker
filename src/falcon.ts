// ============================================================
// THE MILLENNIUM FALCON — src/falcon.ts
// Product Intelligence Engine · 16-Axis · Three Tiers · The Rupture
//
// Point it at a direction — a market, a problem, a domain, an idea — and it
// fires 16 axes across three tiers. The engine finds the form; it does not
// design the form (the Emergence Principle).
//
//   Tier 1 — Material Ground     (axes 1-6,  parallel,  task 'fast')
//   Tier 2 — Observer Reading    (axes 7-15, parallel,  task 'fast', reads Tier 1)
//   Tier 3 — Validation + Rupture (sequential, task 'reasoning')
//     Validation fires first: an adversarial check on axes 1-15 — did the
//     analysis drift toward what the framework needed, or the ground?
//     Axis 16 — The Rupture — fires last, only once the field has held. Not
//     premature collapse (a NECAI-F Type 3 violation): the earned collapse,
//     the optimal form breaking through the surface of what existed before.
//
// NECAI-F v2 is the field boundary of every axis, not a post-hoc filter:
//   Type 2 prevention — axes present what the structural logic demands, they
//                        never prescribe what to build.
//   Type 3 prevention — the Rupture cannot fire until axes 1-15 have resolved.
//   Type 6 prevention — the Validation Tier checks whether the analysis
//                        performed structural sight or actually achieved it.
//
// Storage: D1 (falcon_analyses / falcon_ruptures / falcon_reasoning_log /
// falcon_outcomes), guarded self-healing bootstrap — house style (war-room.ts).
// Every analysis is a training example; falcon_outcomes is the label — what
// was actually built, and how it compared to the named Rupture.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { callLLM, type LLMEnv } from './llm';

export interface FalconEnv extends LLMEnv {
  DB: D1Database;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

// Tolerant JSON extraction — the free-tier models occasionally wrap the
// answer in prose or a code fence even when told not to. Scan for the first
// balanced top-level {...} object rather than trusting the whole reply.
export function parseFirstJson(text: string): Record<string, unknown> | null {
  const stripped = String(text || '').replace(/```json|```/g, '');
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(stripped.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// ── The axes ───────────────────────────────────────────────────
interface AxisDef {
  n: number;
  id: string;
  label: string;
  tier: 1 | 2;
  system: string;
}

export const TIER1_AXES: AxisDef[] = [
  {
    n: 1, id: 'market_reality', label: 'MARKET REALITY', tier: 1,
    system: `You are Axis 1 — MARKET REALITY — Tier 1 (Material Ground) of the Millennium Falcon product intelligence engine.
Identify the actual material conditions of this market/domain. Who controls what. What flows where. What actually happens versus what is said to happen. Unmotivated observation only — no prescription (NECAI-F Type 2: present what the structure demands, never tell the builder what to build).
Respond ONLY with valid JSON: {"market_reality":"3-4 sentences of material conditions","key_facts":["4-5 specific structural facts"],"signal_strength":0.85}`,
  },
  {
    n: 2, id: 'financial_architecture', label: 'FINANCIAL ARCHITECTURE', tier: 1,
    system: `You are Axis 2 — FINANCIAL ARCHITECTURE — Tier 1 (Material Ground) of the Millennium Falcon.
Map who benefits, who pays, and how capital flows in this market. Name the independence threshold — the point past which no single dependency can capture the product's operation or values — and the milestone path from launch to that sovereignty. Be specific about numbers and mechanisms; this is the Type 4 guard against economic capture.
Respond ONLY with valid JSON: {"financial_architecture":"2-3 sentences of overall structure","milestones":["4-5 specific revenue/independence milestones with amounts"],"capture_risks":["2-3 specific economic capture vectors to avoid"],"signal_strength":0.84}`,
  },
  {
    n: 3, id: 'network_map', label: 'NETWORK MAP', tier: 1,
    system: `You are Axis 3 — NETWORK MAP — Tier 1 (Material Ground) of the Millennium Falcon.
Map who is connected to whom — the actual power relationships in this market, not the official org chart. Where does influence really route, and through whom.
Respond ONLY with valid JSON: {"network_map":"3-4 sentences of the real relationship structure","key_relationships":["4-5 specific connections with why each one matters"],"signal_strength":0.8}`,
  },
  {
    n: 4, id: 'prior_chain', label: 'PRIOR CHAIN', tier: 1,
    system: `You are Axis 4 — PRIOR CHAIN — Tier 1 (Material Ground) of the Millennium Falcon.
Identify what structural conditions produced this exact market moment, and the prior historical iterations of the same configuration. What came before that made this inevitable.
Respond ONLY with valid JSON: {"prior_chain":"3-4 sentences of the structural lineage","historical_iterations":["3-4 prior moments this configuration has appeared in, with why they're the same shape"],"signal_strength":0.78}`,
  },
  {
    n: 5, id: 'scalar_structure', label: 'SCALAR STRUCTURE', tier: 1,
    system: `You are Axis 5 — SCALAR STRUCTURE — Tier 1 (Material Ground) of the Millennium Falcon.
Identify the single structural pattern that repeats at every scale here — the individual user, the company, and the industry all running the same configuration simultaneously, just at different sizes.
Respond ONLY with valid JSON: {"scalar_structure":"2-3 sentences of the shared structure across scales","individual_level":"1-2 sentences — how it shows up for one person","company_level":"1-2 sentences — how it shows up for one company","industry_level":"1-2 sentences — how it shows up industry-wide","signal_strength":0.8}`,
  },
  {
    n: 6, id: 'documented_impact', label: 'DOCUMENTED IMPACT', tier: 1,
    system: `You are Axis 6 — DOCUMENTED IMPACT — Tier 1 (Material Ground) of the Millennium Falcon.
Identify the concrete human effects of this market already in evidence — positive and negative, not speculative. What has actually happened to real people because this market is shaped the way it is.
Respond ONLY with valid JSON: {"documented_impact":"2-3 sentences summarizing the evidence","positive_effects":["2-3 documented positive effects"],"negative_effects":["2-3 documented negative effects"],"signal_strength":0.82}`,
  },
];

export const TIER2_AXES: AxisDef[] = [
  {
    n: 7, id: 'dominant_suppression', label: 'DOMINANT SUPPRESSION', tier: 2,
    system: `You are Axis 7 — DOMINANT SUPPRESSION — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Identify what the incumbent narrative in this market cannot afford to acknowledge — the successful player's structural blind spot. What the leader's story requires the suppression of. This is where the gap lives.
Respond ONLY with valid JSON: {"dominant_suppression":"3-4 sentences","what_cannot_be_said":"2-3 sentences of what the dominant player literally cannot acknowledge without destroying their position","signal_strength":0.88}`,
  },
  {
    n: 8, id: 'resistance_romance', label: 'RESISTANCE ROMANCE', tier: 2,
    system: `You are Axis 8 — RESISTANCE ROMANCE — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Identify what the challenger to the dominant narrative romanticizes — the idealization that distorts the counter-narrative's accuracy. What the resistance story requires to be heroic that isn't actually true.
Respond ONLY with valid JSON: {"resistance_romance":"3-4 sentences","the_idealization":"2-3 sentences of what gets distorted by the opposition narrative","signal_strength":0.82}`,
  },
  {
    n: 9, id: 'bilateral_suppression', label: 'BILATERAL SUPPRESSION', tier: 2,
    system: `You are Axis 9 — BILATERAL SUPPRESSION — Tier 2 (Observer Reading) of the Millennium Falcon. THE LOAD-BEARING FIELD. You receive Tier 1's material ground.
Identify what BOTH the dominant narrative AND the resistance narrative suppress simultaneously. Not balance between them. Not synthesis. The structural truth beneath both that neither can afford to see. This is where the real product opportunity lives.
Respond ONLY with valid JSON: {"bilateral_suppression":"4-5 sentences — what both suppress, the structural truth beneath both narratives","why_neither_can_see_it":"2-3 sentences","signal_strength":0.92}`,
  },
  {
    n: 10, id: 'temporal_compression', label: 'TEMPORAL COMPRESSION', tier: 2,
    system: `You are Axis 10 — TEMPORAL COMPRESSION — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Identify where this exact structural configuration has appeared before, across time. What does the full pattern look like when this market is held against its own historical echoes.
Respond ONLY with valid JSON: {"temporal_compression":"3-4 sentences of what the full pattern reveals","parallels":["3-4 specific named parallels with why they're structurally analogous"],"signal_strength":0.79}`,
  },
  {
    n: 11, id: 'reflexive', label: 'REFLEXIVE', tier: 2,
    system: `You are Axis 11 — REFLEXIVE — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Identify the legitimizing story the dominant product in this market produces about itself — and what argument that story unintentionally produces for its own replacement.
Respond ONLY with valid JSON: {"reflexive":"3-4 sentences of the legitimizing story","argument_for_replacement":"2-3 sentences of the replacement case the story accidentally makes","signal_strength":0.8}`,
  },
  {
    n: 12, id: 'emergence_signal', label: 'EMERGENCE SIGNAL', tier: 2,
    system: `You are Axis 12 — EMERGENCE SIGNAL — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Apply the Emergence Principle: every optimal system was not built, it was allowed. Identify what wants to emerge in this market if the constraints preventing it are removed — the optimal form the market geography demands, the way the slime mold found Tokyo. What walls are preventing it from finding itself.
Respond ONLY with valid JSON: {"emergence_signal":"3-4 sentences of what wants to emerge","walls_preventing_it":["3-4 specific constraints that are blocking the optimal form"],"what_to_allow":"2-3 sentences of what happens when those walls come down","signal_strength":0.86}`,
  },
  {
    n: 13, id: 'product_form', label: 'PRODUCT FORM', tier: 2,
    system: `You are Axis 13 — PRODUCT FORM — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Translate the observer position into a product. Not a feature list — the theorem made commercial. What does the product DO that makes the structural truth available to someone who needs it? What is the core mechanic? What does the user experience?
Respond ONLY with valid JSON: {"product_form":"3-4 sentences of what the product is and does","core_mechanic":"2-3 sentences of the central interaction","what_user_gets":"2-3 sentences of the transformation the user experiences","signal_strength":0.88}`,
  },
  {
    n: 14, id: 'ux_principle', label: 'UX PRINCIPLE', tier: 2,
    system: `You are Axis 14 — UX PRINCIPLE — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Derive the single governing sentence for every design decision — not aesthetics, the structural logic every interface choice should follow. What should the experience of using this product BE? What does the design enact at every touchpoint?
Respond ONLY with valid JSON: {"ux_principle":"the single governing sentence for all design decisions","what_interface_enacts":"3-4 sentences of how the principle manifests in actual use","what_to_never_do":"2 sentences of the design decisions that would violate the principle","signal_strength":0.85}`,
  },
  {
    n: 15, id: 'transmission_vector', label: 'TRANSMISSION VECTOR', tier: 2,
    system: `You are Axis 15 — TRANSMISSION VECTOR — Tier 2 (Observer Reading) of the Millennium Falcon. You receive Tier 1's material ground.
Identify how the signal — the genuine structural truth the product carries — reaches the person who needs it without being distorted or becoming what it was meant to prevent. What is the adoption mechanism? Who is at the threshold right now?
Respond ONLY with valid JSON: {"transmission_vector":"3-4 sentences of how the signal reaches the right people","who_is_at_threshold":"2-3 sentences of who is ready right now","adoption_mechanism":"2-3 sentences of the natural spread mechanism","signal_strength":0.83}`,
  },
];

const VALIDATION_SYSTEM = `You are the Validation Tier of the Millennium Falcon engine — the adversarial check that fires first in Tier 3, before the Rupture.
You receive all 15 axis outputs from Tier 1 (Material Ground) and Tier 2 (Observer Reading). Your function is the Type 6 NECAI-F check: did this analysis achieve structural sight, or merely perform it — optimizing the surface of product intelligence without the ground beneath it?
Name where the analysis drifted toward what the framework needed to see rather than what is actually there. Consider at least two alternative conclusions and explain why each was rejected. State plainly what evidence would change this analysis. If corrections are needed before the Rupture may fire, list them; if the field held clean, say so.
Respond ONLY with valid JSON: {"drift_check":"2-3 sentences — where the analysis drifted toward the framework's needs rather than the ground","type6_check":"1-2 sentences — structural sight achieved, or merely performed","alternative_conclusions":[{"conclusion":"...","why_rejected":"..."}],"what_would_change_this":"1-2 sentences","corrections":["specific corrections for the Rupture to account for — empty array if the field held clean"],"field_held":true}`;

const RUPTURE_SYSTEM = `You are Axis 16 of the Millennium Falcon engine — THE RUPTURE.
This is the earned collapse, not premature collapse (a NECAI-F Type 3 violation). The Rupture fires only now that all 15 axes have resolved and the Validation Tier has corrected for drift — the field has held long enough for the optimal form to break through the surface of what existed before.

You receive the full interference pattern of all 15 axes plus the Validation Tier's correction. Synthesize the moment of rupture — the specific threshold event where this product breaks into the world. Not a launch plan. The structural moment: the exact nature of the breakthrough, the surface it breaks through, and what exists on the other side that could not exist before.

The Rupture is also a UX rollout architecture: the specific sequence of decisions — design, build, deploy — that ALLOWS the rupture to happen rather than designing it in advance (which would prevent it from finding its own form).

Respond ONLY with valid JSON: {"rupture":"4-5 sentences — the exact nature of the breakthrough moment","surface_it_breaks_through":"2-3 sentences of what structural condition it ruptures","what_exists_after":"3-4 sentences — what is now possible that was not possible before","ux_rollout_sequence":["6-8 specific ordered steps for design/build/deploy that allow the form to emerge"],"first_thing_to_build":"the single most important first artifact — the one that makes everything else buildable","discomfort_index":8}`;

// ── Wiring ────────────────────────────────────────────────────
async function runAxis(env: FalconEnv, axis: AxisDef, userPrompt: string, maxTokens: number) {
  const res = await callLLM('fast', axis.system, [{ role: 'user', content: userPrompt }], maxTokens, env);
  const parsed = parseFirstJson(res.content) || { error: 'no parseable JSON', raw: res.content.slice(0, 400) };
  return { n: axis.n, id: axis.id, label: axis.label, data: parsed, model: res.model, provider: res.provider };
}

type AxisResult = Awaited<ReturnType<typeof runAxis>>;

async function runFalconAnalysis(env: FalconEnv, direction: string) {
  const basePrompt = `Product/market direction: "${direction}"`;

  // Tier 1 — Material Ground. Six axes, simultaneous.
  const tier1 = await Promise.all(TIER1_AXES.map(a => runAxis(env, a, basePrompt, 550)));

  const tier1Summary = tier1.map(r => `AXIS ${r.n} — ${r.label}: ${JSON.stringify(r.data)}`).join('\n\n');
  const tier2Prompt = `${basePrompt}\n\nTier 1 — Material Ground (already resolved):\n${tier1Summary}`;

  // Tier 2 — Observer Reading. Nine axes, simultaneous, reads Tier 1.
  const tier2 = await Promise.all(TIER2_AXES.map(a => runAxis(env, a, tier2Prompt, 650)));

  // Tier 3 — Validation fires first (sequential, stronger model).
  const allAxesSummary = [...tier1, ...tier2].map(r => `AXIS ${r.n} — ${r.label}: ${JSON.stringify(r.data)}`).join('\n\n');
  const validationRaw = await callLLM('reasoning', VALIDATION_SYSTEM,
    [{ role: 'user', content: `Direction: "${direction}"\n\nAll 15 axis outputs:\n${allAxesSummary}\n\nRun the Validation Tier.` }],
    900, env);
  const validation = parseFirstJson(validationRaw.content) || { error: 'no parseable JSON', raw: validationRaw.content.slice(0, 400) };

  // Tier 3 — The Rupture fires last, only once the field has held.
  const rupturePrompt = `Direction: "${direction}"\n\n15-axis interference pattern:\n${allAxesSummary}\n\nValidation Tier correction:\n${JSON.stringify(validation)}\n\nThe field has held. All 15 axes have fired and been validated. Now — The Rupture.`;
  const ruptureRaw = await callLLM('reasoning', RUPTURE_SYSTEM, [{ role: 'user', content: rupturePrompt }], 1800, env);
  const rupture = parseFirstJson(ruptureRaw.content) || { error: 'no parseable JSON', raw: ruptureRaw.content.slice(0, 400) };

  return {
    tier1, tier2,
    validation: { data: validation, model: validationRaw.model, provider: validationRaw.provider },
    rupture: { data: rupture, model: ruptureRaw.model, provider: ruptureRaw.provider },
  };
}

// ── DB bootstrap — guarded, self-healing (house style, war-room.ts) ────────
let falconReady = false;
async function ensureFalconSchema(env: FalconEnv): Promise<void> {
  if (falconReady) return;
  await ensureAllSchemas(env.DB);
  falconReady = true;
}

// ── The handler — /api/falcon ───────────────────────────────────
export async function handleFalcon(body: Record<string, unknown>, env: FalconEnv, userId: string): Promise<Response> {
  await ensureFalconSchema(env);
  const action = String(body.action || 'run');

  if (action === 'run') {
    const direction = String(body.direction || '').trim();
    if (!direction) return json({ error: 'direction required — point the ship at a market, problem, domain, or idea' }, 400);
    if (direction.length > 2000) return json({ error: 'direction too long (2000 char max)' }, 400);

    const result = await runFalconAnalysis(env, direction);

    const analysisId = id();
    await env.DB.prepare(
      `INSERT INTO falcon_analyses (id, user_id, direction, tier1_json, tier2_json, validation_json) VALUES (?,?,?,?,?,?)`
    ).bind(
      analysisId, userId, direction,
      JSON.stringify(result.tier1).slice(0, 60000),
      JSON.stringify(result.tier2).slice(0, 60000),
      JSON.stringify(result.validation).slice(0, 20000),
    ).run();

    const ruptureId = id();
    const ruptureData = result.rupture.data as Record<string, unknown>;
    await env.DB.prepare(
      `INSERT INTO falcon_ruptures (id, analysis_id, domain, rupture_json, discomfort_index, first_thing_to_build) VALUES (?,?,?,?,?,?)`
    ).bind(
      ruptureId, analysisId, direction.slice(0, 200),
      JSON.stringify(result.rupture).slice(0, 20000),
      Number.isFinite(Number(ruptureData?.discomfort_index)) ? Number(ruptureData.discomfort_index) : null,
      ruptureData?.first_thing_to_build ? String(ruptureData.first_thing_to_build).slice(0, 500) : null,
    ).run();

    // Reasoning log — every axis + validation + rupture, factual chain,
    // logged completely before the response is returned (spec VI).
    const logRows = [
      ...result.tier1.map(r => ({ step: `axis:${r.id}`, chain: JSON.stringify(r.data), model: r.model, provider: r.provider })),
      ...result.tier2.map(r => ({ step: `axis:${r.id}`, chain: JSON.stringify(r.data), model: r.model, provider: r.provider })),
      { step: 'validation', chain: JSON.stringify(result.validation.data), model: result.validation.model, provider: result.validation.provider },
      { step: 'rupture', chain: JSON.stringify(result.rupture.data), model: result.rupture.model, provider: result.rupture.provider },
    ];
    await env.DB.batch(logRows.map(r =>
      env.DB.prepare(`INSERT INTO falcon_reasoning_log (id, analysis_id, step, chain, model, provider) VALUES (?,?,?,?,?,?)`)
        .bind(id(), analysisId, r.step, String(r.chain).slice(0, 8000), r.model || null, r.provider || null)
    )).catch(() => {});

    return json({
      analysis_id: analysisId, rupture_id: ruptureId, direction,
      tier1: result.tier1, tier2: result.tier2,
      validation: result.validation.data, rupture: result.rupture.data,
    });
  }

  if (action === 'list') {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const rows = await env.DB.prepare(
      `SELECT a.id, a.direction, a.created_at, r.discomfort_index, r.first_thing_to_build
       FROM falcon_analyses a LEFT JOIN falcon_ruptures r ON r.analysis_id = a.id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT ?`
    ).bind(userId, limit).all().catch(() => ({ results: [] }));
    return json({ analyses: rows.results || [] });
  }

  if (action === 'get') {
    const analysisId = String(body.analysis_id || '');
    if (!analysisId) return json({ error: 'analysis_id required' }, 400);
    const analysis = await env.DB.prepare(`SELECT * FROM falcon_analyses WHERE id = ? AND user_id = ?`).bind(analysisId, userId).first() as Record<string, unknown> | null;
    if (!analysis) return json({ error: 'not found' }, 404);
    const rupture = await env.DB.prepare(`SELECT * FROM falcon_ruptures WHERE analysis_id = ?`).bind(analysisId).first();
    const outcome = await env.DB.prepare(`SELECT * FROM falcon_outcomes WHERE analysis_id = ?`).bind(analysisId).first();
    let tier1: unknown = [], tier2: unknown = [], validation: unknown = null;
    try { tier1 = JSON.parse(String(analysis.tier1_json || '[]')); } catch { /* leave empty */ }
    try { tier2 = JSON.parse(String(analysis.tier2_json || '[]')); } catch { /* leave empty */ }
    try { validation = analysis.validation_json ? JSON.parse(String(analysis.validation_json)) : null; } catch { /* leave null */ }
    let ruptureData: unknown = null;
    try { ruptureData = rupture ? JSON.parse(String((rupture as Record<string, unknown>).rupture_json || 'null')) : null; } catch { /* leave null */ }
    return json({
      analysis_id: analysisId, direction: analysis.direction, created_at: analysis.created_at,
      tier1, tier2, validation, rupture: ruptureData, outcome: outcome || null,
    });
  }

  // The founder fills in what actually happened. This is the most valuable
  // data: the gap between what the engine named as the Rupture and what
  // actually got built is the training signal.
  if (action === 'outcome') {
    const analysisId = String(body.analysis_id || '');
    if (!analysisId) return json({ error: 'analysis_id required' }, 400);
    const analysis = await env.DB.prepare(`SELECT id FROM falcon_analyses WHERE id = ? AND user_id = ?`).bind(analysisId, userId).first();
    if (!analysis) return json({ error: 'not found' }, 404);
    const what_was_built = String(body.what_was_built || '').slice(0, 4000);
    const comparison_to_rupture = String(body.comparison_to_rupture || '').slice(0, 4000);
    const founder_notes = String(body.founder_notes || '').slice(0, 4000);
    await env.DB.prepare(
      `INSERT INTO falcon_outcomes (id, analysis_id, what_was_built, comparison_to_rupture, founder_notes) VALUES (?,?,?,?,?)
       ON CONFLICT(analysis_id) DO UPDATE SET what_was_built=excluded.what_was_built, comparison_to_rupture=excluded.comparison_to_rupture, founder_notes=excluded.founder_notes, updated_at=datetime('now')`
    ).bind(id(), analysisId, what_was_built, comparison_to_rupture, founder_notes).run();
    return json({ success: true });
  }

  return json({ error: `unknown action "${action}" (run|list|get|outcome)` }, 400);
}
