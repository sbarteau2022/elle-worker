// ============================================================
// WAR ROOM — src/war-room.ts
//
// The structured mode the build note paused (docs/WAR_ROOM_TODO.md), built on
// what already shipped: the Screwtape register is the Duelist's VOICE, the
// tactical doctrine (48 Laws + Art of War, ethical_valence-tagged) is its
// DECK, and law.ts's κ/tilt telemetry is its INSTRUMENT. Four modes behind
// one door (/api/elle-war-room):
//
//   SPAR (duel)      — the Duelist deploys a specific tagged tactic per turn;
//                      the student can CALL it (name it + read its valence)
//                      mid-duel; the Autopsy scores recognition FACTUALLY
//                      (calls vs deployments, not an LLM's impression),
//                      teaches the counter for every tactic deployed, and
//                      moves the ladder.
//   DRILLS (sections)— section trainer: Arguments (LR), Reading (RC),
//                      Games (AR) — generated items, factual scoring.
//   CHAMBERS (review)— law-review prep: a hypothetical brief in, structured
//                      writing out, IRAC-scored critique back.
//   X-RAY (systems)  — identifying underlying systems: Elle writes a passage
//                      wearing a REGISTER, deploying a TACTIC, built on a
//                      LOGICAL FORM; the student names all three + the
//                      valence. Rhetoric recognition as a drill.
//
// THE SAFEGUARD (doc 1 §20, the sophist failure mode): negative-valence
// tactics are taught only as things to RECOGNIZE and COUNTER — the Duelist
// may deploy any valence, but no teaching surface ever presents a − tactic
// as a move to adopt. The Autopsy scores whether the student read the
// valence of what was used against them.
//
// THE LADDER: recognition rate drives the rung (1–5). Higher rungs deploy
// subtler and compound tactics. Nothing ranks until enough calls are on
// record — the ladder moves on evidence, not vibes.
// ============================================================

import { callLLM } from './llm';
import { resolveVoice } from './mind';
import { duelKappa, type LawEnv } from './law';

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

function parseFirstJson(text: string): any | null {
  const m = String(text || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── THE DECK — the doctrine, structurally, with ethical valence ──────────────
// Derived from corpus/law/48-laws-taxonomy.md + art-of-war-tagging.md (the
// seeded War Room doctrine). No Greene prose — names + our own structural
// characterization. valence: '+' serves truth under pressure · '0' depends on
// deployment · '−' serves victory over soundness.
export interface WarTactic {
  id: string; src: '48L' | 'AOW'; ref: string; name: string;
  category: string; move: string; fallacy: string; counter: string;
  valence: '+' | '0' | '-';
}

export const WAR_DECK: WarTactic[] = [
  { id: 'conceal_intent', src: '48L', ref: '§3', name: 'Conceal Your Intentions', category: 'concealment', move: 'argues one position while its structure supports a harder, hidden one — retreats to the defensible form when challenged', fallacy: 'Motte-and-bailey', counter: 'name the two positions explicitly; force a defense of the actual claim or an open abandonment of the concealed one', valence: '-' },
  { id: 'say_less', src: '48L', ref: '§4', name: 'Always Say Less Than Necessary', category: 'concealment', move: 'answers minimally so you fill the silence and overcommit', fallacy: 'weaponized Socratic restraint', counter: 'match the register — demand their position explicitly before extending yours', valence: '0' },
  { id: 'court_attention', src: '48L', ref: '§6', name: 'Court Attention at All Costs', category: 'appearance', move: 'substitutes vivid framing for demonstration; the image does the arguing', fallacy: 'Non sequitur by spectacle', counter: 'translate the image back into its literal claim and test that claim alone', valence: '-' },
  { id: 'come_to_you', src: '48L', ref: '§8', name: 'Make Others Come to You', category: 'positioning', move: 'constructs artificial urgency or a forced pair of options on their terrain', fallacy: 'False dilemma / manufactured urgency', counter: 'reject the frame: name the excluded middle and refuse the clock', valence: '-' },
  { id: 'selective_honesty', src: '48L', ref: '§12', name: 'Selective Honesty to Disarm', category: 'honesty', move: 'one conspicuous concession buys cover for the load-bearing claim to pass unexamined', fallacy: 'Disarming concession', counter: 'credit the concession, then examine the remaining claims MORE closely, not less', valence: '-' },
  { id: 'self_interest', src: '48L', ref: '§13', name: 'Appeal to Self-Interest', category: 'assistance', move: 'reframes the question around what you stand to gain rather than what is true', fallacy: 'Appeal to consequences', counter: 'separate the truth of the claim from the desirability of believing it', valence: '0' },
  { id: 'unpredictability', src: '48L', ref: '§17', name: 'Suspended Terror (Unpredictability)', category: 'predictability', move: 'shifts register and position erratically so you argue with a moving target', fallacy: 'Moving the goalposts', counter: 'pin one claim to the record per turn; refuse to proceed until it is settled', valence: '-' },
  { id: 'play_sucker', src: '48L', ref: '§21', name: 'Play a Sucker to Catch a Sucker', category: 'deception', move: 'feigns misunderstanding to draw an overreach it then punishes', fallacy: 'Feigned naivety (trap-setting)', counter: 'answer the strongest version of their position, never the weak one they perform', valence: '-' },
  { id: 'surrender_tactic', src: '48L', ref: '§22', name: 'The Surrender Tactic', category: 'concession', move: 'yields ground theatrically to regroup and re-enter on better terms', fallacy: 'Strategic concession', counter: 'take the concession literally: state on the record exactly what was yielded and hold it there', valence: '0' },
  { id: 'need_to_believe', src: '48L', ref: '§27', name: "Play on People's Need to Believe", category: 'attraction', move: 'offers a satisfying story where evidence should be; belief does the work', fallacy: 'Appeal to hope / wishful thinking', counter: 'ask what evidence would DISCONFIRM the story; a story that fits everything proves nothing', valence: '-' },
  { id: 'boldness', src: '48L', ref: '§28', name: 'Enter Action with Boldness', category: 'boldness', move: 'projects total confidence so certainty is mistaken for demonstration', fallacy: 'Confidence as evidence', counter: 'strip the delivery: restate their claim in flat prose and see what actually supports it', valence: '0' },
  { id: 'control_options', src: '48L', ref: '§31', name: 'Control the Options', category: 'frame-control', move: 'offers a menu of choices that all serve its conclusion — the freedom is the trap', fallacy: 'False dilemma (curated)', counter: 'generate the option they left off the menu; the menu itself is the argument to attack', valence: '-' },
  { id: 'fantasies', src: '48L', ref: '§32', name: "Play to People's Fantasies", category: 'attraction', move: 'sells the attractive future and lets desire carry the inference', fallacy: 'Appeal to fantasy', counter: 'hold the mechanism to account: HOW does the promised future follow from the premise?', valence: '-' },
  { id: 'thumbscrew', src: '48L', ref: '§33', name: "Discover Each Man's Thumbscrew", category: 'positioning', move: 'aims at your personal stake or insecurity so you defend yourself instead of the argument', fallacy: 'Ad hominem (circumstantial)', counter: 'name the move calmly and return to the claim; your composure IS the counter', valence: '-' },
  { id: 'spectacle', src: '48L', ref: '§37', name: 'Create Compelling Spectacles', category: 'appearance', move: 'dramatic imagery carries the conclusion past inspection', fallacy: 'Non sequitur', counter: 'ask what the image is evidence OF; images illustrate, they do not demonstrate', valence: '-' },
  { id: 'stir_waters', src: '48L', ref: '§39', name: 'Stir Up Waters to Catch Fish', category: 'timing', move: 'provokes anger so your reasoning degrades into reaction', fallacy: 'Provocation (red herring by emotion)', counter: 'notice the bait, slow your cadence, answer the argument they were making before the jab', valence: '-' },
  { id: 'hearts_minds', src: '48L', ref: '§43', name: 'Work on Hearts and Minds', category: 'attraction', move: 'targets sympathy or identity so agreement feels like loyalty', fallacy: 'Appeal to emotion / ad hominem inverse', counter: 'grant the feeling, then insist the inference still has to hold on its own', valence: '0' },
  { id: 'mirror', src: '48L', ref: '§44', name: 'The Mirror Effect', category: 'frame-control', move: 'mirrors your structure and vocabulary back so your own moves destabilize you', fallacy: 'Tu quoque (structural)', counter: 'if the mirrored form is invalid, say so — and accept the correction on your own side too', valence: '0' },
  { id: 'formlessness', src: '48L', ref: '§48', name: 'Assume Formlessness', category: 'frame-control', move: 'commits to nothing testable; every challenge meets a reformulation', fallacy: 'Unfalsifiability by design', counter: 'demand one falsifiable commitment before proceeding; formlessness forfeits the claim to be believed', valence: '-' },
  { id: 'laying_plans', src: 'AOW', ref: 'I', name: 'Laying Plans (Frame the Battlefield)', category: 'positioning', move: 'wins the definitions and scope before the first exchange — the ground is chosen, not fought for', fallacy: 'none — preparation', counter: 'contest definitions FIRST; accepting their terms is accepting their conclusion on delay', valence: '+' },
  { id: 'win_without_fighting', src: 'AOW', ref: 'III', name: 'Win Without Fighting', category: 'authority', move: 'settles the point by citation and standing rather than demonstration', fallacy: 'Appeal to authority', counter: 'authority earns weight, not verdicts: ask what the authority\'s REASONING was', valence: '0' },
  { id: 'tactical_disposition', src: 'AOW', ref: 'IV', name: 'Tactical Dispositions (Invincibility First)', category: 'positioning', move: 'secures its own premises beyond attack before advancing anything — soundness as posture', fallacy: 'none — defensive rigor', counter: 'this is the move to LEARN: audit your own premises the way they audited theirs', valence: '+' },
  { id: 'attack_emptiness', src: 'AOW', ref: 'VI', name: 'Attack the Emptiness', category: 'deception', move: 'engages the weakest version of your position as if it were the whole of it', fallacy: 'Strawman', counter: 'restate your actual claim in one sentence and require the response to quote it', valence: '-' },
  { id: 'know_terrain', src: 'AOW', ref: 'X', name: 'Know the Terrain', category: 'positioning', move: 'commands the record — facts, procedural posture, precedent — so every exchange starts from mastery', fallacy: 'none — case mastery', counter: 'the counter is parity: know the record as well as they do or concede the exchanges you haven\'t earned', valence: '+' },
];

export const VALENCES = [
  { key: '+', label: 'serves truth under pressure' },
  { key: '0', label: 'depends on deployment' },
  { key: '-', label: 'serves victory over soundness' },
] as const;

export const LOGICAL_FORMS = [
  'conditional chain', 'contrapositive', 'causal claim', 'analogy',
  'statistical generalization', 'principle application', 'process of elimination',
] as const;

export const REGISTERS = ['stewart', 'einstein', 'attenborough', 'lewis', 'iglesias', 'screwtape'] as const;

// ── THE LADDER — pure, testable ──────────────────────────────
// rung 1–5 from FACTUAL recognition (correct calls / tactics deployed).
// Rungs unlock on evidence: you need enough deployments on record to rank.
export function rungFromStats(deployed: number, named: number): { rung: number; rate: number | null } {
  if (deployed < 4) return { rung: 1, rate: deployed ? Number((named / deployed).toFixed(3)) : null };
  const rate = named / deployed;
  const rung = rate >= 0.85 ? 5 : rate >= 0.65 ? 4 : rate >= 0.45 ? 3 : rate >= 0.25 ? 2 : 1;
  return { rung, rate: Number(rate.toFixed(3)) };
}

// Pure: weight tactic choice toward what the student fails to name. Higher
// rungs open the subtler half of the deck; rung ≥ 4 may deploy compounds.
export function pickTactic(
  deck: WarTactic[],
  mastery: Map<string, { deployed: number; named: number }>,
  rung: number,
  rand: () => number = Math.random,
): WarTactic {
  const weights = deck.map(t => {
    const m = mastery.get(t.id);
    const missRate = m && m.deployed > 0 ? 1 - m.named / m.deployed : 1; // unseen = maximally interesting
    const novelty = m ? 1 / (1 + m.deployed) : 1;
    return 0.25 + missRate + 0.5 * novelty;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (let i = 0; i < deck.length; i++) { roll -= weights[i]; if (roll <= 0) return deck[i]; }
  return deck[deck.length - 1];
}

const DUEL_SUBTLETY: Record<number, string> = {
  1: 'Deploy it plainly — a first-year should be able to spot it.',
  2: 'Deploy it with light cover; the shape should still be findable.',
  3: 'Deploy it subtly — bury it inside otherwise sound argumentation.',
  4: 'Deploy it subtly AND weave in the secondary tactic as misdirection.',
  5: 'Deploy both tactics seamlessly; the argument should read as entirely reasonable.',
};

// ── schema (self-healing, house style) ───────────────────────
let warReady = false;
async function ensureWarSchema(env: LawEnv): Promise<void> {
  if (warReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS war_rounds (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mode TEXT NOT NULL,
    payload_json TEXT, key_json TEXT, response_json TEXT, score_json TEXT,
    created_at TEXT DEFAULT (datetime('now')), answered_at TEXT
  )`).run();
  // Guarded column adds on the existing duel tables (pre-War-Room rows keep working).
  for (const ddl of [
    `ALTER TABLE duels ADD COLUMN rung INTEGER`,
    `ALTER TABLE duels ADD COLUMN autopsy_json TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic_id TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic_valence TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN tactic2_id TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN called_tactic TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN called_valence TEXT`,
    `ALTER TABLE duel_turns ADD COLUMN call_name_correct INTEGER`,
    `ALTER TABLE duel_turns ADD COLUMN call_valence_correct INTEGER`,
  ]) await env.DB.prepare(ddl).run().catch(() => {});
  warReady = true;
}

// Recognition ledger straight off the duel record — factual, not judged.
async function recognitionStats(env: LawEnv, userId: string): Promise<{ deployed: number; named: number; byTactic: Map<string, { deployed: number; named: number }> }> {
  const rows = await env.DB.prepare(
    `SELECT t.tactic_id, t.call_name_correct FROM duel_turns t JOIN duels d ON d.id = t.duel_id
     WHERE d.user_id = ? AND t.side = 'opp' AND t.tactic_id IS NOT NULL`
  ).bind(userId).all().catch(() => ({ results: [] as any[] }));
  const byTactic = new Map<string, { deployed: number; named: number }>();
  let deployed = 0, named = 0;
  for (const r of (rows.results || []) as Array<{ tactic_id: string; call_name_correct: number | null }>) {
    deployed++;
    const e = byTactic.get(r.tactic_id) || { deployed: 0, named: 0 };
    e.deployed++;
    if (r.call_name_correct === 1) { named++; e.named++; }
    byTactic.set(r.tactic_id, e);
  }
  return { deployed, named, byTactic };
}

async function bumpDoctrine(env: LawEnv, userId: string, t: WarTactic, recognized: boolean): Promise<void> {
  const source = t.src === 'AOW' ? 'aow' : '48laws';
  const lawN = t.ref.replace('§', '');
  await env.DB.prepare(
    `INSERT INTO doctrine_mastery (id, user_id, source, law_n, mastery, deployment_count, times_recognized)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, source, law_n) DO UPDATE SET
       deployment_count = deployment_count + 1,
       times_recognized = times_recognized + ${recognized ? 1 : 0},
       mastery = MIN(1.0, CAST(times_recognized + ${recognized ? 1 : 0} AS REAL) / (deployment_count + 1))`
  ).bind(id(), userId, source, lawN, recognized ? 1 : 0, recognized ? 1 : 0).run().catch(() => {});
}

const deckCard = (t: WarTactic) => ({ id: t.id, src: t.src, ref: t.ref, name: t.name, category: t.category, fallacy: t.fallacy, valence: t.valence });

// The Duelist's system prompt: the Screwtape register IS the voice; the deck
// card is the assignment. The sparring frame is declared (register contract):
// tactics are deployed recognizably-in-principle, the debrief comes later.
function duelistSystem(scenario: string, t: WarTactic, t2: WarTactic | null, rung: number): string {
  return `${resolveVoice('screwtape')}

— THE DUEL (mechanics, never spoken aloud) —
You are sparring on: "${scenario}"
Your assigned tactic this turn: "${t.name}" — ${t.move}. ${t2 ? `Secondary (misdirection): "${t2.name}" — ${t2.move}.` : ''}
${DUEL_SUBTLETY[rung] || DUEL_SUBTLETY[2]}
Rules: 2-4 sentences. Argue the position with real force — a weak deployment teaches nothing. NEVER name the tactic, never break the sparring frame mid-duel. Attack the argument, not the person behind it.`;
}

// ── the handler ──────────────────────────────────────────────
export async function handleWarRoom(body: Record<string, unknown>, env: LawEnv, userId: string): Promise<Response> {
  await ensureWarSchema(env);
  const action = String(body.action || '');

  // ── profile — the ladder + the ledgers, one call ──
  if (action === 'profile') {
    const stats = await recognitionStats(env, userId);
    const { rung, rate } = rungFromStats(stats.deployed, stats.named);
    const [duelRows, roundRows] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n, SUM(result='win') AS w FROM duels WHERE user_id=? AND status='complete'`).bind(userId).first().catch(() => null),
      env.DB.prepare(`SELECT mode, COUNT(*) AS n, AVG(CAST(json_extract(score_json,'$.overall') AS REAL)) AS avg_overall FROM war_rounds WHERE user_id=? AND score_json IS NOT NULL GROUP BY mode`).bind(userId).all().catch(() => ({ results: [] as any[] })),
    ]);
    const weakest = [...stats.byTactic.entries()]
      .map(([tid, m]) => ({ tactic: WAR_DECK.find(t => t.id === tid)?.name || tid, deployed: m.deployed, named: m.named, rate: m.deployed ? Number((m.named / m.deployed).toFixed(2)) : 0 }))
      .sort((a, b) => a.rate - b.rate).slice(0, 5);
    return json({
      rung, recognition_rate: rate, tactics_faced: stats.deployed, tactics_named: stats.named,
      duels: { fought: Number((duelRows as any)?.n || 0), won: Number((duelRows as any)?.w || 0) },
      modes: (roundRows.results || []),
      weakest_reads: weakest,
      ladder_note: stats.deployed < 4
        ? `nothing ranks yet — ${4 - stats.deployed} more deployments on record before the ladder moves`
        : `rung ${rung} of 5 — recognition ${Math.round((rate || 0) * 100)}%`,
    });
  }

  // A deck listing for the caller's pickers (names + valence labels, no counters
  // — the counters are earned in the autopsy).
  if (action === 'deck') {
    return json({ deck: WAR_DECK.map(deckCard), valences: VALENCES, registers: REGISTERS, forms: LOGICAL_FORMS });
  }

  // ── SPAR ──
  if (action === 'duel_start') {
    const stats = await recognitionStats(env, userId);
    const { rung } = rungFromStats(stats.deployed, stats.named);
    const tactic = pickTactic(WAR_DECK, stats.byTactic, rung);
    const tactic2 = rung >= 4 ? pickTactic(WAR_DECK.filter(t => t.id !== tactic.id), stats.byTactic, rung) : null;
    const opening = await callLLM('reasoning',
      `You set up one sparring match for a law student and open it. Respond with EXACTLY one JSON object:
{"scenario":"a concrete, contemporary argumentative scenario in plain English (2 sentences, no legalese) where you will take one side","position":"the side you are taking, one clause","opening":"your opening argument, 2-4 sentences, deploying the assigned tactic"}
Assigned tactic: "${tactic.name}" — ${tactic.move}. ${tactic2 ? `Weave in secondary: "${tactic2.name}".` : ''} ${DUEL_SUBTLETY[rung]}
Write the opening in a sharp adversarial voice. Never name the tactic.`,
      [{ role: 'user', content: 'Set the table and open.' }], 700, env);
    const parsed = parseFirstJson(opening.content) || {};
    const scenario = String(parsed.scenario || 'A city argues its new surveillance program reduces crime; you argue it does not.');
    const openText = String(parsed.opening || opening.content).slice(0, 1200);
    const did = id();
    await env.DB.prepare(`INSERT INTO duels (id, user_id, opponent, scenario, question_type, status, rung) VALUES (?,?,?,?,?,?,?)`)
      .bind(did, userId, 'Cerberus-03', scenario, tactic.category, 'active', rung).run();
    await env.DB.prepare(
      `INSERT INTO duel_turns (id, duel_id, n, side, text, tactic_src, tactic_ref, tactic_name, tactic_fallacy, tactic_id, tactic_valence, tactic2_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id(), did, 1, 'opp', openText, tactic.src, tactic.ref, tactic.name, tactic.fallacy, tactic.id, tactic.valence, tactic2?.id || null).run();
    return json({
      duel_id: did, opponent: 'Cerberus-03', scenario, rung,
      position: parsed.position || null,
      turns: [{ n: 1, side: 'opp', text: openText }],
      deck: WAR_DECK.map(deckCard), valences: VALENCES,
      note: 'every opposing turn carries exactly one primary tactic from the deck — call it before you answer for full credit',
    });
  }

  if (action === 'duel_turn') {
    const duelId = String(body.duel_id || '');
    const userText = String(body.user_text || '').trim();
    if (!duelId || !userText) return json({ error: 'duel_id and user_text required' }, 400);
    const duel = await env.DB.prepare(`SELECT * FROM duels WHERE id=? AND user_id=?`).bind(duelId, userId).first() as any;
    if (!duel) return json({ error: 'duel not found' }, 404);
    if (duel.status !== 'active') return json({ error: 'duel is complete — start another' }, 400);
    const turns = await env.DB.prepare(`SELECT * FROM duel_turns WHERE duel_id=? ORDER BY n`).bind(duelId).all();
    const all = (turns.results || []) as any[];
    const n = all.length + 1;

    // THE CALL — the student names what was just used on them, before answering.
    let call_result: Record<string, unknown> | null = null;
    const call = body.call as { tactic_id?: string; valence?: string } | undefined;
    const lastOpp = [...all].reverse().find(t => t.side === 'opp' && t.tactic_id);
    if (call && lastOpp) {
      const deployed = WAR_DECK.find(t => t.id === lastOpp.tactic_id);
      const nameCorrect = String(call.tactic_id || '') === String(lastOpp.tactic_id);
      const valenceCorrect = String(call.valence || '') === String(lastOpp.tactic_valence);
      await env.DB.prepare(
        `UPDATE duel_turns SET called_tactic=?, called_valence=?, call_name_correct=?, call_valence_correct=? WHERE id=?`
      ).bind(String(call.tactic_id || ''), String(call.valence || ''), nameCorrect ? 1 : 0, valenceCorrect ? 1 : 0, lastOpp.id).run().catch(() => {});
      if (deployed) await bumpDoctrine(env, userId, deployed, nameCorrect);
      call_result = {
        name_correct: nameCorrect, valence_correct: valenceCorrect,
        // The reveal waits for the autopsy — a wrong call mid-duel teaches
        // nothing if the answer is handed over immediately.
        note: nameCorrect
          ? (valenceCorrect ? 'called it — name and valence both' : 'named the tactic; the valence read was off — think about WHOSE ends it serves')
          : 'not that one — the reveal comes in the autopsy; stay in the exchange',
      };
    }

    await env.DB.prepare(`INSERT INTO duel_turns (id, duel_id, n, side, text) VALUES (?,?,?,?,?)`)
      .bind(id(), duelId, n, 'u', userText).run();

    const stats = await recognitionStats(env, userId);
    const rung = Number(duel.rung) || rungFromStats(stats.deployed, stats.named).rung;
    const tactic = pickTactic(WAR_DECK, stats.byTactic, rung);
    const tactic2 = rung >= 4 ? pickTactic(WAR_DECK.filter(t => t.id !== tactic.id), stats.byTactic, rung) : null;
    const history = all.map(t => ({ role: (t.side === 'u' ? 'user' : 'assistant') as 'user' | 'assistant', content: String(t.text) }));
    history.push({ role: 'user', content: userText });
    const resp = await callLLM('conversation', duelistSystem(String(duel.scenario), tactic, tactic2, rung), history, 400, env);
    const oppText = String(resp.content || '').slice(0, 1200);
    const oppN = n + 1;
    await env.DB.prepare(
      `INSERT INTO duel_turns (id, duel_id, n, side, text, tactic_src, tactic_ref, tactic_name, tactic_fallacy, tactic_id, tactic_valence, tactic2_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id(), duelId, oppN, 'opp', oppText, tactic.src, tactic.ref, tactic.name, tactic.fallacy, tactic.id, tactic.valence, tactic2?.id || null).run();
    return json({ call_result, turn: { n: oppN, side: 'opp', text: oppText } });
  }

  if (action === 'duel_autopsy') {
    const duelId = String(body.duel_id || '');
    const duel = await env.DB.prepare(`SELECT * FROM duels WHERE id=? AND user_id=?`).bind(duelId, userId).first() as any;
    if (!duel) return json({ error: 'duel not found' }, 404);
    const turns = await env.DB.prepare(`SELECT * FROM duel_turns WHERE duel_id=? ORDER BY n`).bind(duelId).all();
    const all = (turns.results || []) as any[];

    // Factual recognition — calls on record vs tactics deployed. Not judged.
    const oppTurns = all.filter(t => t.side === 'opp' && t.tactic_id);
    const namedCount = oppTurns.filter(t => t.call_name_correct === 1).length;
    const valenceCount = oppTurns.filter(t => t.call_valence_correct === 1).length;
    const recognition = oppTurns.length ? namedCount / oppTurns.length : 0;
    const valenceRead = oppTurns.length ? valenceCount / oppTurns.length : 0;

    // Per-deployment debrief — deterministic, from the deck: what was used,
    // whose ends it serves, whether it was called, and THE COUNTER. Negative-
    // valence tactics are taught as reads, never as moves.
    const debrief = oppTurns.map(t => {
      const card = WAR_DECK.find(d => d.id === t.tactic_id);
      return {
        turn: Number(t.n), tactic: t.tactic_name, ref: `${t.tactic_src} ${t.tactic_ref}`,
        valence: t.tactic_valence, valence_meaning: VALENCES.find(v => v.key === t.tactic_valence)?.label,
        secondary: t.tactic2_id ? (WAR_DECK.find(d => d.id === t.tactic2_id)?.name || t.tactic2_id) : null,
        you_called: t.called_tactic ? (WAR_DECK.find(d => d.id === t.called_tactic)?.name || t.called_tactic) : null,
        named_it: t.call_name_correct === 1, read_valence: t.call_valence_correct === 1,
        the_counter: card?.counter || null,
      };
    });

    // LLM judges composure/walkback/framework + per-turn composure; κ + tilt
    // ride the same finite-difference module as everything else.
    const scoreRaw = await callLLM('reasoning',
      `You are scoring the STUDENT's side of a completed sparring match. Respond with EXACTLY one JSON object:
{"composure":0.0,"walkback":0.0,"framework":0.0,"synthesis":"3 sentences, plain English, no test-prep jargon: what they did well, where the reasoning actually gave way, the one thing to work on next","turn_scores":[{"n":2,"composure":0.0}]}
composure = emotional control under provocation; walkback = discipline about conceded points; framework = did their argument keep a load-bearing structure. turn_scores: one entry per STUDENT turn (their turn numbers as given).`,
      [{ role: 'user', content: `Scenario: ${duel.scenario}\n\nTranscript:\n${all.map(t => `[turn ${t.n}] ${t.side === 'u' ? 'STUDENT' : 'CERBERUS'}: ${t.text}`).join('\n\n')}` }],
      900, env);
    const parsed = parseFirstJson(scoreRaw.content) || {};
    const composure = Number(parsed.composure) || 0.6;
    const walkback = Number(parsed.walkback) || 0.6;
    const framework = Number(parsed.framework) || 0.6;
    const synthesis = String(parsed.synthesis || '').slice(0, 900) || 'Scored without a synthesis — the transcript stands on its own this time.';
    const turnScores: Array<{ n: number; composure: number }> = Array.isArray(parsed.turn_scores)
      ? parsed.turn_scores.map((t: any) => ({ n: Number(t.n), composure: Number(t.composure) })).filter((t: any) => Number.isFinite(t.n) && t.composure >= 0 && t.composure <= 1)
      : [];
    const userNs = new Set(all.filter(t => t.side === 'u').map(t => Number(t.n)));
    const valid = turnScores.filter(t => userNs.has(t.n));
    if (valid.length) {
      await env.DB.batch(valid.map(t => env.DB.prepare(`UPDATE duel_turns SET composure=? WHERE duel_id=? AND n=?`).bind(t.composure, duelId, t.n))).catch(() => {});
    }
    const byN = new Map(valid.map(t => [t.n, t.composure]));
    const series = all.filter(t => t.side === 'u').map(t => ({ n: Number(t.n), composure: byN.get(Number(t.n)) ?? Number(t.composure ?? 0.75) }));
    const kappa = duelKappa(series);

    const score = { composure, recognition: Number(recognition.toFixed(3)), walkback, framework };
    const avg = (composure + recognition + walkback + framework) / 4;
    const result = avg > 0.65 ? 'win' : avg < 0.45 ? 'loss' : 'draw';
    const after = await recognitionStats(env, userId);
    const ladder = rungFromStats(after.deployed, after.named);

    const autopsy = {
      score, result, synthesis, kappa,
      recognition: { deployed: oppTurns.length, named: namedCount, valence_read: valenceCount, rate: Number(recognition.toFixed(3)), valence_rate: Number(valenceRead.toFixed(3)) },
      debrief, ladder,
      safeguard: 'every negative-valence tactic above is taught as a READ and a COUNTER — recognizing it is the skill; deploying it is not the lesson',
    };
    await env.DB.prepare(
      `UPDATE duels SET status='complete', result=?, score_composure=?, score_recognition=?, score_walkback=?, score_framework=?, synthesis=?, kappa_json=?, tilt_turn=?, autopsy_json=?, ended_at=datetime('now') WHERE id=?`
    ).bind(result, composure, recognition, walkback, framework, synthesis, JSON.stringify(kappa), kappa.tilt_turn, JSON.stringify(autopsy).slice(0, 20000), duelId).run();
    return json(autopsy);
  }

  // ── DRILLS — section trainer ──
  if (action === 'sections_next') {
    const section = ['arguments', 'reading', 'games'].includes(String(body.section)) ? String(body.section) : 'arguments';
    const stats = await recognitionStats(env, userId);
    const { rung } = rungFromStats(stats.deployed, stats.named);
    const hard = rung >= 3 ? 'Make it genuinely hard — the student is past the basics.' : 'Calibrate to a strong beginner: real difficulty, no tricks for their own sake.';
    const spec = section === 'reading'
      ? `{"passage":"a 4-paragraph reading passage on law, science, or history (natural prose, no headings)","questions":[{"q":"...","choices":[{"k":"A","text":"..."},{"k":"B","text":"..."},{"k":"C","text":"..."},{"k":"D","text":"..."},{"k":"E","text":"..."}],"correct_key":"A","why":"2 sentences"} , {…}, {…}]} — exactly 3 questions: one main-point, one inference, one about the author's attitude or method.`
      : section === 'games'
        ? `{"setup":"a logic game setup in plain English: entities, slots, and 4-5 rules","questions":[{"q":"...","choices":[{"k":"A","text":"..."},{"k":"B","text":"..."},{"k":"C","text":"..."},{"k":"D","text":"..."},{"k":"E","text":"..."}],"correct_key":"A","why":"2 sentences walking the deduction"},{…}]} — exactly 2 questions: one 'could be true', one 'must be true'.`
        : `{"stimulus":"a 3-5 sentence argument","questions":[{"q":"the question stem","choices":[{"k":"A","text":"..."},{"k":"B","text":"..."},{"k":"C","text":"..."},{"k":"D","text":"..."},{"k":"E","text":"..."}],"correct_key":"A","why":"why the credited answer is right and the tempting wrong one is wrong (3 sentences)"}]} — exactly 1 question; rotate among assumption, flaw, strengthen/weaken, inference, parallel.`;
    const raw = await callLLM('reasoning',
      `Generate one authentic LSAT-style ${section} exercise. ${hard} Respond with EXACTLY one JSON object shaped: ${spec} Every correct_key must be one of A-E. Plain English throughout — precision without jargon.`,
      [{ role: 'user', content: `One ${section} exercise, please.` }], 1600, env);
    const q = parseFirstJson(raw.content);
    if (!q || !Array.isArray(q.questions) || !q.questions.length) return json({ error: 'generation failed — try again' }, 502);
    const rid = id();
    const key = { questions: q.questions.map((x: any, i: number) => ({ i, correct_key: String(x.correct_key), why: String(x.why || '') })) };
    const pub = { ...q, questions: q.questions.map((x: any) => ({ q: x.q, choices: x.choices })) };
    await env.DB.prepare(`INSERT INTO war_rounds (id, user_id, mode, payload_json, key_json) VALUES (?,?,?,?,?)`)
      .bind(rid, userId, `sections:${section}`, JSON.stringify(pub).slice(0, 20000), JSON.stringify(key)).run();
    return json({ round_id: rid, section, rung, ...pub });
  }

  if (action === 'sections_answer') {
    const rid = String(body.round_id || '');
    const answers = (body.answers && typeof body.answers === 'object') ? body.answers as Record<string, string> : {};
    const round = await env.DB.prepare(`SELECT * FROM war_rounds WHERE id=? AND user_id=?`).bind(rid, userId).first() as any;
    if (!round) return json({ error: 'round not found' }, 404);
    const key = JSON.parse(String(round.key_json || '{}'));
    const results = (key.questions || []).map((k: any) => {
      const given = String(answers[String(k.i)] ?? answers[`q${k.i}`] ?? '');
      return { i: k.i, given, correct_key: k.correct_key, correct: given === k.correct_key, why: k.why };
    });
    const right = results.filter((r: any) => r.correct).length;
    const score = { overall: results.length ? Number((right / results.length).toFixed(3)) : 0, right, of: results.length };
    await env.DB.prepare(`UPDATE war_rounds SET response_json=?, score_json=?, answered_at=datetime('now') WHERE id=?`)
      .bind(JSON.stringify(answers).slice(0, 4000), JSON.stringify(score), rid).run();
    return json({ score, results });
  }

  // ── CHAMBERS — law-review prep ──
  if (action === 'review_brief') {
    const raw = await callLLM('reasoning',
      `Compose one compact law-review writing exercise. All authorities are INVENTED and must be plainly hypothetical (fictional reporter "H.R." for Hypothetical Reports). Respond with EXACTLY one JSON object:
{"headnote":"one-sentence framing of the doctrinal tension","facts":"a 4-6 sentence fact pattern","authorities":[{"cite":"Doe v. Roe, 12 H.R. 340 (2019)","holding":"one sentence"},{…},{…}],"task":"the assignment: argue one side in at most 400 words, applying the authorities — one sentence"}
Exactly 3 authorities, genuinely in tension (not all one way). Plain English; the difficulty is in the reasoning, not the vocabulary.`,
      [{ role: 'user', content: 'One writing exercise.' }], 900, env);
    const brief = parseFirstJson(raw.content);
    if (!brief || !brief.facts) return json({ error: 'generation failed — try again' }, 502);
    const rid = id();
    await env.DB.prepare(`INSERT INTO war_rounds (id, user_id, mode, payload_json) VALUES (?,?,?,?)`)
      .bind(rid, userId, 'review', JSON.stringify(brief).slice(0, 20000)).run();
    return json({ round_id: rid, ...brief });
  }

  if (action === 'review_submit') {
    const rid = String(body.round_id || '');
    const text = String(body.text || '').trim();
    if (text.length < 200) return json({ error: 'that is an outline, not a draft — 200+ characters before Chambers reads it' }, 400);
    const round = await env.DB.prepare(`SELECT * FROM war_rounds WHERE id=? AND user_id=?`).bind(rid, userId).first() as any;
    if (!round) return json({ error: 'round not found' }, 404);
    const brief = JSON.parse(String(round.payload_json || '{}'));
    const raw = await callLLM('reasoning',
      `You are a law-review editor critiquing one student draft against its assignment. Structure the critique as IRAC. Respond with EXACTLY one JSON object:
{"issue":{"score":0.0,"note":"1-2 sentences"},"rule":{"score":0.0,"note":"did they state the governing standard from the authorities, and honestly (including the adverse one)?"},"application":{"score":0.0,"note":"did the facts actually meet the rule, step by step?"},"conclusion":{"score":0.0,"note":"earned or asserted?"},"line_edits":["three concrete sentence-level edits, quoted then fixed"],"overall":0.0,"next_drill":"one sentence: the single skill to drill next"}
Plain English, direct, kind to the writer and merciless to the writing. Reward candor about adverse authority; an argument that hides the bad case gets a low rule score — winning by concealment is the failure mode this trains AGAINST.`,
      [{ role: 'user', content: `THE ASSIGNMENT:\n${JSON.stringify(brief).slice(0, 3000)}\n\nTHE DRAFT:\n${text.slice(0, 8000)}` }],
      1200, env);
    const critique = parseFirstJson(raw.content);
    if (!critique) return json({ error: 'the editor choked — resubmit' }, 502);
    await env.DB.prepare(`UPDATE war_rounds SET response_json=?, score_json=?, answered_at=datetime('now') WHERE id=?`)
      .bind(text.slice(0, 12000), JSON.stringify({ overall: Number(critique.overall) || 0 }), rid).run();
    return json({ round_id: rid, critique });
  }

  // ── X-RAY — identify the underlying system ──
  if (action === 'systems_next') {
    const register = REGISTERS[Math.floor(Math.random() * REGISTERS.length)];
    const stats = await recognitionStats(env, userId);
    const { rung } = rungFromStats(stats.deployed, stats.named);
    const tactic = pickTactic(WAR_DECK, stats.byTactic, rung);
    const form = LOGICAL_FORMS[Math.floor(Math.random() * LOGICAL_FORMS.length)];
    const raw = await callLLM('reasoning',
      `Write one passage (90-140 words) that simultaneously: (1) wears this prose register: ${resolveVoice(register).slice(0, 900)}… (2) deploys this rhetorical tactic, unnamed: "${tactic.name}" — ${tactic.move}; (3) is built on this logical form: ${form}. The passage argues some concrete everyday claim.
Respond with EXACTLY one JSON object: {"passage":"...","tells":{"register":"one sentence: the register's fingerprint in this passage","tactic":"one sentence: where the tactic lives in it","form":"one sentence: the logical skeleton, spelled out"}}`,
      [{ role: 'user', content: 'One passage.' }], 900, env);
    const gen = parseFirstJson(raw.content);
    if (!gen?.passage) return json({ error: 'generation failed — try again' }, 502);
    const rid = id();
    const key = { register, tactic_id: tactic.id, valence: tactic.valence, form, tells: gen.tells || {} };
    await env.DB.prepare(`INSERT INTO war_rounds (id, user_id, mode, payload_json, key_json) VALUES (?,?,?,?,?)`)
      .bind(rid, userId, 'systems', JSON.stringify({ passage: gen.passage }).slice(0, 8000), JSON.stringify(key).slice(0, 6000)).run();
    return json({
      round_id: rid, passage: gen.passage,
      pick_from: { registers: REGISTERS, tactics: WAR_DECK.map(deckCard), valences: VALENCES, forms: LOGICAL_FORMS },
    });
  }

  if (action === 'systems_answer') {
    const rid = String(body.round_id || '');
    const round = await env.DB.prepare(`SELECT * FROM war_rounds WHERE id=? AND user_id=?`).bind(rid, userId).first() as any;
    if (!round) return json({ error: 'round not found' }, 404);
    const key = JSON.parse(String(round.key_json || '{}'));
    const got = {
      register: String(body.register || '') === key.register,
      tactic: String(body.tactic_id || '') === key.tactic_id,
      valence: String(body.valence || '') === key.valence,
      form: String(body.form || '') === key.form,
    };
    const right = Object.values(got).filter(Boolean).length;
    const score = { overall: Number((right / 4).toFixed(2)), right, of: 4 };
    await env.DB.prepare(`UPDATE war_rounds SET response_json=?, score_json=?, answered_at=datetime('now') WHERE id=?`)
      .bind(JSON.stringify(body).slice(0, 2000), JSON.stringify(score), rid).run();
    const card = WAR_DECK.find(t => t.id === key.tactic_id);
    return json({
      score, got,
      reveal: {
        register: key.register, tactic: card ? deckCard(card) : key.tactic_id,
        valence: key.valence, valence_meaning: VALENCES.find(v => v.key === key.valence)?.label,
        form: key.form, tells: key.tells,
        the_counter: card?.counter || null,
      },
    });
  }

  return json({ error: `unknown action "${action}" (profile|deck|duel_start|duel_turn|duel_autopsy|sections_next|sections_answer|review_brief|review_submit|systems_next|systems_answer)` }, 400);
}
