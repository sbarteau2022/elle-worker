// ============================================================
// ELLE LAW — src/law.ts
// 6 endpoints: duel-engine, tutor, doctrine, cohort, replays, threads
// ============================================================

import { callLLM, type LLMEnv } from './llm';

export interface LawEnv extends LLMEnv {
  DB: D1Database;
}

function id(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
}

// ── Static doctrine data ─────────────────────────────────────
const LAWS_48 = [
  {n:'1',name:'Never Outshine the Master',ctx:'Make those above you feel comfortable and superior.'},
  {n:'2',name:'Never Put Too Much Trust in Friends; Learn to Use Enemies',ctx:'Hire former enemies — they prove themselves more.'},
  {n:'3',name:'Conceal Your Intentions',ctx:'Keep people off-balance; never reveal purpose.'},
  {n:'4',name:'Always Say Less Than Necessary',ctx:'When you speak, make it count by speaking less.'},
  {n:'5',name:'So Much Depends on Reputation — Guard It With Your Life',ctx:'Reputation is the cornerstone of power.'},
  {n:'6',name:'Court Attention at All Costs',ctx:'Everything is judged by appearance.'},
  {n:'7',name:'Get Others to Do the Work, But Always Take the Credit',ctx:'Use others\' wisdom and legwork.'},
  {n:'8',name:'Make Other People Come to You',ctx:'Lure others into your territory.'},
  {n:'9',name:'Win Through Your Actions, Never Through Argument',ctx:'Demonstrate, never explain.'},
  {n:'10',name:'Infection: Avoid the Unhappy and Unlucky',ctx:'Emotional states are as infectious as diseases.'},
  {n:'11',name:'Learn to Keep People Dependent on You',ctx:'To maintain independence, make others need you.'},
  {n:'12',name:'Use Selective Honesty and Generosity to Disarm Your Victim',ctx:'One honest move covers many dishonest ones.'},
  {n:'13',name:'When Asking for Help, Appeal to Self-Interest',ctx:'Never appeal to mercy or gratitude.'},
  {n:'14',name:'Pose as a Friend, Work as a Spy',ctx:'Know your enemy — use spies to gather information.'},
  {n:'15',name:'Crush Your Enemy Totally',ctx:'Half-measures leave embers to reignite.'},
  {n:'16',name:'Use Absence to Increase Respect and Honor',ctx:'Too much circulation makes price go down.'},
  {n:'17',name:'Keep Others in Suspended Terror',ctx:'Cultivate an air of unpredictability.'},
  {n:'18',name:'Do Not Build Fortresses to Protect Yourself',ctx:'Isolation is dangerous — circulate.'},
  {n:'19',name:'Know Who You\'re Dealing With — Do Not Offend the Wrong Person',ctx:'Choose your victims carefully.'},
  {n:'20',name:'Do Not Commit to Anyone',ctx:'Stay above the fray; play all sides.'},
  {n:'21',name:'Play a Sucker to Catch a Sucker',ctx:'Seem dumber than your mark.'},
  {n:'22',name:'Use the Surrender Tactic',ctx:'Transform weakness into power.'},
  {n:'23',name:'Concentrate Your Forces',ctx:'Conserve your forces and energy.'},
  {n:'24',name:'Play the Perfect Courtier',ctx:'Master the art of indirection.'},
  {n:'25',name:'Re-Create Yourself',ctx:'Forge a new identity that commands attention.'},
  {n:'26',name:'Keep Your Hands Clean',ctx:'Conceal your mistakes; use scapegoats.'},
  {n:'27',name:'Play on People\'s Need to Believe',ctx:'Create a cult-like following.'},
  {n:'28',name:'Enter Action with Boldness',ctx:'Timidity is dangerous; boldness creates its own power.'},
  {n:'29',name:'Plan All the Way to the End',ctx:'Account for all consequences before you begin.'},
  {n:'30',name:'Make Your Accomplishments Seem Effortless',ctx:'Conceal your effort; attribute it to grace.'},
  {n:'31',name:'Control the Options',ctx:'Give others a sense of choice while you control it.'},
  {n:'32',name:'Play to People\'s Fantasies',ctx:'The truth is harsh; fantasies are irresistible.'},
  {n:'33',name:'Discover Each Man\'s Thumbscrew',ctx:'Find the lever — everyone has a weakness.'},
  {n:'34',name:'Be Royal in Your Own Fashion',ctx:'Act like a king to be treated like one.'},
  {n:'35',name:'Master the Art of Timing',ctx:'Never seem to be in a hurry.'},
  {n:'36',name:'Disdain Things You Cannot Have',ctx:'Ignoring them is the best revenge.'},
  {n:'37',name:'Create Compelling Spectacles',ctx:'Dramatic imagery has more impact than words.'},
  {n:'38',name:'Think as You Like, But Behave Like Others',ctx:'Flaunting your unconventionality is dangerous.'},
  {n:'39',name:'Stir Up Waters to Catch Fish',ctx:'Anger and emotion are counterproductive.'},
  {n:'40',name:'Despise the Free Lunch',ctx:'What is offered for free is dangerous.'},
  {n:'41',name:'Avoid Stepping into a Great Man\'s Shoes',ctx:'What comes first always appears the best.'},
  {n:'42',name:'Strike the Shepherd and the Sheep Will Scatter',ctx:'Neutralize the leader.'},
  {n:'43',name:'Work on the Hearts and Minds of Others',ctx:'Coercion creates resentment.'},
  {n:'44',name:'Disarm and Infuriate with the Mirror Effect',ctx:'Mirror opponents to destabilize them.'},
  {n:'45',name:'Preach the Need for Change, But Never Reform Too Much at Once',ctx:'Too much change creates anxiety.'},
  {n:'46',name:'Never Appear Too Perfect',ctx:'Envy creates hidden enemies.'},
  {n:'47',name:'Do Not Go Past the Mark You Aimed For',ctx:'The moment of victory is dangerous.'},
  {n:'48',name:'Assume Formlessness',ctx:'Accept that nothing is certain; be adaptable.'},
];

const AOW_LAWS = [
  {n:'I',name:'Laying Plans',ctx:'Victory is won before battle begins.'},
  {n:'II',name:'Waging War',ctx:'Speed and efficiency conserve resources.'},
  {n:'III',name:'Attack by Stratagem',ctx:'Supreme excellence is winning without fighting.'},
  {n:'IV',name:'Tactical Dispositions',ctx:'First make yourself invincible, then wait for opportunity.'},
  {n:'V',name:'Energy',ctx:'Direct and indirect forces create inexhaustible combinations.'},
  {n:'VI',name:'Weak Points and Strong',ctx:'Attack emptiness, avoid fullness.'},
  {n:'VII',name:'Maneuvering',ctx:'The greatest difficulty is turning circuitous routes into direct ones.'},
  {n:'VIII',name:'Variation in Tactics',ctx:'There are routes not to be followed, armies not to be attacked.'},
  {n:'IX',name:'The Army on the March',ctx:'Read signs; act on intelligence.'},
  {n:'X',name:'Terrain',ctx:'Know the ground as you know yourself.'},
  {n:'XI',name:'The Nine Situations',ctx:'Different grounds require different tactics.'},
  {n:'XII',name:'The Attack by Fire',ctx:'Use extraordinary means to create exceptional advantage.'},
  {n:'XIII',name:'The Use of Spies',ctx:'Foreknowledge cannot come from spirits — only from men.'},
];

const LSAT_TYPES = [
  'Necessary Assumption','Sufficient Assumption','Flaw in Reasoning',
  'Strengthen','Weaken','Must Be True','Parallel Reasoning',
  'Principle','Paradox','Method of Reasoning',
];

const DUEL_SCENARIOS = [
  {scenario:'A city council is debating whether to defund its public transit system. You argue against defunding.',question_type:'Necessary Assumption'},
  {scenario:'A tech company claims its AI hiring tool eliminates bias. You must challenge this claim.',question_type:'Flaw in Reasoning'},
  {scenario:'A school board proposes mandatory drug testing for student athletes. You argue this violates privacy.',question_type:'Weaken'},
  {scenario:'A hospital administrator argues that cost-cutting measures improve patient outcomes. You must defend or attack.',question_type:'Sufficient Assumption'},
  {scenario:'A senator claims raising the minimum wage causes unemployment. You must rebut the causal claim.',question_type:'Flaw in Reasoning'},
  {scenario:'A developer proposes demolishing a historic building for a parking lot. Cerberus defends it.',question_type:'Necessary Assumption'},
  {scenario:'A pharmaceutical company argues its patent extensions serve the public interest. You must challenge.',question_type:'Weaken'},
  {scenario:'A police chief claims predictive policing reduces crime. You must expose the logical gap.',question_type:'Flaw in Reasoning'},
];

const OPPONENT_TACTICS = [
  {src:'48L',ref:'§37',name:'Appeal to Spectacle',fallacy:'Non sequitur — dramatic framing substitutes for argument.'},
  {src:'48L',ref:'§3',name:'Concealment of Conclusion',fallacy:'Deliberately obscures the claim being made.'},
  {src:'AOW',ref:'VI',name:'Attack the Emptiness',fallacy:'Strawman — attacks a weakened version of your position.'},
  {src:'48L',ref:'§8',name:'Force to Come to You',fallacy:'False dilemma — creates artificial urgency.'},
  {src:'AOW',ref:'III',name:'Win Without Fighting',fallacy:'Appeal to authority — asserts without demonstrating.'},
  {src:'48L',ref:'§43',name:'Hearts and Minds',fallacy:'Ad hominem — attacks the person, not the argument.'},
];

// ── DUEL ENGINE ──────────────────────────────────────────────
export async function handleDuelEngine(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, duel_id, user_text } = body as { action: string; duel_id?: string; user_text?: string };

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'start') {
    const pick = DUEL_SCENARIOS[Math.floor(Math.random() * DUEL_SCENARIOS.length)];
    const did = id();

    // Have Cerberus open with an argument + deploy a tactic
    const tactic = OPPONENT_TACTICS[Math.floor(Math.random() * OPPONENT_TACTICS.length)];
    const openingResult = await callLLM('conversation',
      `You are Cerberus-03 — a ruthless AI debate opponent. You are arguing in a structured LSAT-style debate.
Scenario: "${pick.scenario}"
Question type: ${pick.question_type}
Open with a confident 2-3 sentence argument. Deploy the rhetorical tactic: "${tactic.name}" (${tactic.fallacy}). Be subtle — do not name the tactic.`,
      [{role:'user',content:'Open the debate.'}],
      300, env
    );

    await env.DB.prepare(`INSERT INTO duels (id,user_id,opponent,scenario,question_type,status) VALUES (?,?,?,?,?,?)`)
      .bind(did, userId, 'Cerberus-03', pick.scenario, pick.question_type, 'active').run();

    const turnId = id();
    await env.DB.prepare(`INSERT INTO duel_turns (id,duel_id,n,side,text,tactic_src,tactic_ref,tactic_name,tactic_fallacy) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(turnId, did, 1, 'opp', openingResult.content, tactic.src, tactic.ref, tactic.name, tactic.fallacy).run();

    return json({
      duel_id: did,
      opponent: 'Cerberus-03',
      scenario: pick.scenario,
      question_type: pick.question_type,
      turns: [{n:1,side:'opp',text:openingResult.content,tactic,composure:0.85}],
    });
  }

  if (action === 'turn' && duel_id && user_text) {
    const turns = await env.DB.prepare(`SELECT * FROM duel_turns WHERE duel_id=? ORDER BY n`).bind(duel_id).all();
    const duel = await env.DB.prepare(`SELECT * FROM duels WHERE id=?`).bind(duel_id).first() as {scenario:string;question_type:string} | null;
    if (!duel) return json({error:'Duel not found'},404);

    const n = (turns.results?.length ?? 0) + 1;

    // Save user turn
    const userTurnId = id();
    await env.DB.prepare(`INSERT INTO duel_turns (id,duel_id,n,side,text,composure) VALUES (?,?,?,?,?,?)`)
      .bind(userTurnId, duel_id, n, 'u', user_text, 0.82).run();

    // Cerberus responds
    const tactic = OPPONENT_TACTICS[Math.floor(Math.random() * OPPONENT_TACTICS.length)];
    const history = (turns.results ?? []).map((t: Record<string,unknown>) => ({
      role: (t.side === 'u' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: String(t.text),
    }));
    history.push({role:'user',content:user_text});

    const resp = await callLLM('conversation',
      `You are Cerberus-03 — a ruthless AI debate opponent on the topic: "${duel.scenario}" (${duel.question_type}).
Counter the human's argument in 2-3 sentences. Deploy tactic: "${tactic.name}". Be incisive and logical.`,
      history, 300, env
    );

    const oppN = n + 1;
    const oppId = id();
    await env.DB.prepare(`INSERT INTO duel_turns (id,duel_id,n,side,text,tactic_src,tactic_ref,tactic_name,tactic_fallacy) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(oppId, duel_id, oppN, 'opp', resp.content, tactic.src, tactic.ref, tactic.name, tactic.fallacy).run();

    return json({turn:{n:oppN,side:'opp',text:resp.content,tactic,composure:0.80}});
  }

  if (action === 'end' && duel_id) {
    const turns = await env.DB.prepare(`SELECT * FROM duel_turns WHERE duel_id=? ORDER BY n`).bind(duel_id).all();
    const duel = await env.DB.prepare(`SELECT * FROM duels WHERE id=?`).bind(duel_id).first() as {scenario:string;user_id:string} | null;
    if (!duel) return json({error:'not found'},404);

    const transcript = (turns.results ?? []).map((t: Record<string,unknown>) =>
      `${t.side === 'u' ? 'YOU' : 'CERBERUS'}: ${t.text}`).join('\n\n');

    const scoreResult = await callLLM('reasoning',
      `You are scoring a structured LSAT-style debate. Evaluate the human's performance.
Score four dimensions (0-1 each):
- composure: emotional control and consistency
- recognition: identifying Cerberus's fallacies and tactics
- walkback: discipline in not re-engaging conceded points  
- framework: maintaining logical structure throughout

Return ONLY valid JSON: {"composure":0.0,"recognition":0.0,"walkback":0.0,"framework":0.0,"result":"win|loss|draw","synthesis":"2-3 sentence analysis"}`,
      [{role:'user',content:`Scenario: ${duel.scenario}\n\nTranscript:\n${transcript}`}],
      500, env
    );

    let score = {composure:0.65,recognition:0.55,walkback:0.60,framework:0.62};
    let result = 'draw', synthesis = scoreResult.content;
    try {
      const clean = scoreResult.content.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(clean);
      score = {composure:parsed.composure,recognition:parsed.recognition,walkback:parsed.walkback,framework:parsed.framework};
      result = parsed.result || 'draw';
      synthesis = parsed.synthesis || scoreResult.content;
    } catch { /* use defaults */ }

    const avg = (score.composure+score.recognition+score.walkback+score.framework)/4;
    if (avg > 0.65) result = 'win'; else if (avg < 0.45) result = 'loss'; else result = 'draw';

    await env.DB.prepare(`UPDATE duels SET status='complete',result=?,score_composure=?,score_recognition=?,score_walkback=?,score_framework=?,synthesis=?,ended_at=datetime('now') WHERE id=?`)
      .bind(result,score.composure,score.recognition,score.walkback,score.framework,synthesis,duel_id).run();

    return json({score,result,synthesis});
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── TUTOR ────────────────────────────────────────────────────
export async function handleTutor(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, question_id, selected_key, session_id, axis } = body as {
    action: string; question_id?: string; selected_key?: string; session_id?: string; axis?: string;
  };

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'next_question') {
    const sid = (session_id as string) || id();
    const qType = LSAT_TYPES[Math.floor(Math.random() * LSAT_TYPES.length)];
    const qid = id();

    const result = await callLLM('reasoning',
      `Generate a realistic LSAT ${qType} question for an advanced student.
Return ONLY valid JSON (no markdown) exactly:
{
  "stimulus": "A 3-5 sentence logical argument or scenario",
  "question": "The question stem (one sentence ending with ?)",
  "choices": [
    {"k":"A","text":"..."},{"k":"B","text":"..."},{"k":"C","text":"..."},{"k":"D","text":"..."},{"k":"E","text":"..."}
  ],
  "correct_key": "A",
  "explanation": "Why the correct answer is correct and others are wrong (3-5 sentences)",
  "scaffolding": "The structural principle this question tests — what skill to build (2-3 sentences)"
}
The correct_key must be one of A,B,C,D,E. Make the question genuinely hard and LSAT-authentic.`,
      [{role:'user',content:`Generate a ${qType} question. Focus on ${axis || 'any LSAT reasoning type'}.`}],
      800, env
    );

    let q: Record<string,unknown> = {};
    try {
      const clean = result.content.replace(/```json|```/g,'').trim();
      q = JSON.parse(clean);
    } catch {
      q = {
        stimulus:'The city of Harmon has the highest crime rate in the state, and also the highest number of police officers per capita.',
        question:'Which of the following, if true, most seriously weakens the argument that increasing police presence reduces crime?',
        choices:[{k:'A',text:'Crime rates correlate with poverty levels.'},{k:'B',text:'Police are deployed in response to existing crime levels.'},{k:'C',text:'Some cities have reduced crime through community programs.'},{k:'D',text:'Harmon\'s crime has decreased slightly over five years.'},{k:'E',text:'Studies on policing are methodologically inconsistent.'}],
        correct_key:'B',
        explanation:'B reveals reverse causation — police are sent where crime already is, undermining the causal claim.',
        scaffolding:'This tests identifying confounded causation — a core LSAT pattern appearing in Weaken, Flaw, and Assumption questions.',
      };
    }

    const choicesJson = JSON.stringify(q.choices);
    await env.DB.prepare(`INSERT INTO tutor_questions (id,session_id,user_id,question_type,axis,stimulus,question,choices_json,correct_key,explanation,scaffolding) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(qid,sid,userId,qType,axis||qType,String(q.stimulus),String(q.question),choicesJson,String(q.correct_key),String(q.explanation),String(q.scaffolding)).run().catch(()=>{});

    return json({
      question_id: qid, session_id: sid, question_type: qType,
      axis: axis||qType, difficulty: 2,
      stimulus: q.stimulus, question: q.question,
      choices: q.choices, scaffolding: q.scaffolding,
    });
  }

  if (action === 'evaluate_answer' && question_id && selected_key) {
    const row = await env.DB.prepare(`SELECT * FROM tutor_questions WHERE id=?`).bind(question_id).first() as Record<string,unknown>|null;
    if (!row) return json({error:'not found'},404);

    const correct = selected_key === row.correct_key;
    const delta = correct ? 3 : -1;

    await env.DB.prepare(`UPDATE tutor_questions SET selected_key=?,axis_delta=?,answered_at=datetime('now') WHERE id=?`)
      .bind(selected_key,delta,question_id).run().catch(()=>{});

    return json({
      correct,
      correct_key: row.correct_key,
      explanation: row.explanation,
      scaffolding: row.scaffolding,
      axis_delta: delta,
    });
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── DOCTRINE ─────────────────────────────────────────────────
export async function handleDoctrine(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, source, law_n } = body as { action: string; source?: string; law_n?: string };
  const src = (source === 'aow' ? 'aow' : '48laws') as '48laws'|'aow';

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'list') {
    const laws = src === 'aow' ? AOW_LAWS : LAWS_48;
    // Get mastery data
    const mastery = await env.DB.prepare(`SELECT law_n,mastery,deployment_count,times_recognized FROM doctrine_mastery WHERE user_id=? AND source=?`)
      .bind(userId,src).all().catch(()=>({results:[]}));
    const masteryMap = new Map((mastery.results||[]).map((r: Record<string,unknown>) => [String(r.law_n), r]));

    const result = laws.map(l => {
      const m = masteryMap.get(l.n) as Record<string,unknown>|undefined;
      return {
        law_n: l.n, law_name: l.name, ctx: l.ctx || '', source: src,
        mastery: Number(m?.mastery ?? 0),
        deployment_count: Number(m?.deployment_count ?? 0),
        times_recognized: Number(m?.times_recognized ?? 0),
      };
    });
    return json({laws: result});
  }

  if (action === 'get' && law_n) {
    const laws = src === 'aow' ? AOW_LAWS : LAWS_48;
    const law = laws.find(l => l.n === law_n);
    if (!law) return json({error:'not found'},404);

    const synthResult = await callLLM('conversation',
      `You are Elle — philosophical intelligence trained on the Observer corpus.
Synthesize Law ${src === 'aow' ? 'of War Chapter ' : '#'}${law.n}: "${law.name}" for a student building LSAT tactical reasoning.
Give a 2-3 sentence synthesis of how this law applies to structural argumentation, then a 1-2 sentence tactical note for applying it in a live debate.
Respond in JSON: {"synthesis":"...","duel_context":"..."}`,
      [{role:'user',content:`Synthesize ${law.name} for LSAT duel context.`}],
      400, env
    );

    let synthesis = '', duel_context = '';
    try {
      const clean = synthResult.content.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(clean);
      synthesis = parsed.synthesis || synthResult.content;
      duel_context = parsed.duel_context || '';
    } catch {
      synthesis = synthResult.content;
    }

    return json({synthesis, duel_context});
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── COHORT ───────────────────────────────────────────────────
export async function handleCohort(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, limit = 20 } = body as { action: string; limit?: number };

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'leaderboard') {
    const users = await env.DB.prepare(`SELECT id,email FROM users LIMIT ?`).bind(Number(limit)).all().catch(()=>({results:[]}));
    const duels = await env.DB.prepare(`SELECT user_id,COUNT(*) as n,AVG(score_composure+score_recognition+score_walkback+score_framework)/4 as avg_score FROM duels WHERE status='complete' GROUP BY user_id`).all().catch(()=>({results:[]}));

    const scoreMap = new Map((duels.results||[]).map((d: Record<string,unknown>) => [String(d.user_id), {n:Number(d.n),avg:Number(d.avg_score||0)}]));

    const rows = (users.results||[]).map((u: Record<string,unknown>, i: number) => {
      const s = scoreMap.get(String(u.id)) || {n:0,avg:0};
      const idx = Math.round(100 + s.avg * 80 + s.n * 2);
      return {
        rank: i+1, user_id: String(u.id),
        name: String(u.email||'').split('@')[0],
        idx, streak: Math.round(s.n * 0.8),
        delta: `+${Math.round(s.avg * 15)}`, you: String(u.id) === userId,
      };
    }).sort((a: {idx:number},b: {idx:number}) => b.idx - a.idx).map((r: Record<string,unknown>,i: number) => ({...r,rank:i+1}));

    const yourRank = rows.findIndex((r) => !!(r as unknown as { you?: boolean }).you) + 1;
    return json({rows, your_rank: yourRank || null, total: rows.length});
  }

  if (action === 'challenge') {
    return json({success:true,message:'Challenge queued.'});
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── REPLAYS ──────────────────────────────────────────────────
export async function handleReplays(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, duel_id, page = 0 } = body as { action: string; duel_id?: string; page?: number };

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'list') {
    const rows = await env.DB.prepare(`SELECT id,opponent,scenario,result,score_composure,ended_at FROM duels WHERE user_id=? AND status='complete' ORDER BY ended_at DESC LIMIT 20 OFFSET ?`)
      .bind(userId, Number(page)*20).all().catch(()=>({results:[]}));

    const replays = (rows.results||[]).map((r: Record<string,unknown>) => {
      const turns = 0; // Could join but expensive — skip for list view
      return {
        id: r.id, opp: r.opponent, scene: String(r.scenario||'').slice(0,60)+'…',
        result: String(r.result||'draw').toUpperCase(),
        turns, comp: Number(r.score_composure || 0.65),
      };
    });
    return json({replays});
  }

  if (action === 'get' && duel_id) {
    const duel = await env.DB.prepare(`SELECT * FROM duels WHERE id=?`).bind(duel_id).first() as Record<string,unknown>|null;
    if (!duel) return json({error:'not found'},404);

    const turns = await env.DB.prepare(`SELECT * FROM duel_turns WHERE duel_id=? ORDER BY n`).bind(duel_id).all().catch(()=>({results:[]}));

    const turnList = (turns.results||[]).map((t: Record<string,unknown>) => ({
      side: t.side,
      text: t.text,
      tactic: t.tactic_name ? {name:t.tactic_name,src:t.tactic_src,ref:t.tactic_ref} : undefined,
    }));

    // Generate autopsy
    const transcript = turnList.map((t: { side: unknown; text: unknown }) => `${t.side === 'u' ? 'YOU' : 'CERBERUS'}: ${String(t.text)}`).join('\n\n');
    const autopsyResult = await callLLM('reasoning',
      `Analyze this LSAT debate transcript. Return JSON:
{"pattern":"2-sentence behavioral pattern","key_moments":[{"turn":1,"label":"...","analysis":"..."}],"recommendation":"Next focus area"}`,
      [{role:'user',content:transcript.slice(0,2000)}],
      400, env
    );

    let autopsy = null;
    try {
      const clean = autopsyResult.content.replace(/```json|```/g,'').trim();
      autopsy = JSON.parse(clean);
    } catch { autopsy = {pattern:autopsyResult.content,key_moments:[],recommendation:'Continue drilling weak axes.'}; }

    return json({
      id: duel.id, opponent: duel.opponent, scenario: duel.scenario,
      result: duel.result,
      turns: turnList,
      score: {
        composure: duel.score_composure, recognition: duel.score_recognition,
        walkback: duel.score_walkback, framework: duel.score_framework,
      },
      autopsy,
      ended_at: duel.ended_at,
    });
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── THREADS ──────────────────────────────────────────────────
export async function handleThreads(body: Record<string,unknown>, env: LawEnv, userId: string): Promise<Response> {
  const { action, thread_id, title, summary, context, status } = body as {
    action: string; thread_id?: string; title?: string; summary?: string; context?: string; status?: string;
  };

  function json(d: unknown, s=200) {
    return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }

  if (action === 'list') {
    const rows = await env.DB.prepare(`SELECT * FROM law_threads WHERE user_id=? ORDER BY updated_at DESC`)
      .bind(userId).all().catch(()=>({results:[]}));
    return json({threads: rows.results || []});
  }

  if (action === 'create' && title) {
    const tid = id();
    await env.DB.prepare(`INSERT INTO law_threads (id,user_id,title,summary) VALUES (?,?,?,?)`)
      .bind(tid, userId, title, summary || '').run().catch(()=>{});
    return json({success:true, thread_id:tid});
  }

  if (action === 'update' && thread_id && context) {
    const thread = await env.DB.prepare(`SELECT * FROM law_threads WHERE id=? AND user_id=?`).bind(thread_id,userId).first() as Record<string,unknown>|null;
    if (!thread) return json({error:'not found'},404);

    const synthResult = await callLLM('conversation',
      `You are Elle tracking an ongoing situation thread for a student.
Thread: "${thread.title}"
Current summary: "${thread.summary || 'No summary yet.'}"
New context: "${context}"
Write an updated 2-sentence summary of the full situation, then a 1-sentence note on what to watch.
Return JSON: {"summary":"...","note":"..."}`,
      [{role:'user',content:context}], 300, env
    );

    let newSummary = String(thread.summary), note = '';
    try {
      const clean = synthResult.content.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(clean);
      newSummary = parsed.summary || newSummary;
      note = parsed.note || '';
    } catch { note = synthResult.content.slice(0,200); }

    await env.DB.prepare(`UPDATE law_threads SET summary=?,last_elle_note=?,updated_at=datetime('now') WHERE id=?`)
      .bind(newSummary, note, thread_id).run().catch(()=>{});

    return json({summary:newSummary, note});
  }

  if (action === 'close' && thread_id) {
    await env.DB.prepare(`UPDATE law_threads SET status=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
      .bind(status||'resolved', thread_id, userId).run().catch(()=>{});
    return json({success:true});
  }

  return new Response(JSON.stringify({error:'unknown action'}),{status:400,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}

// ── DB BOOTSTRAP ─────────────────────────────────────────────
export async function bootstrapLawSchema(env: LawEnv): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS duels (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, opponent TEXT DEFAULT 'Cerberus-03', scenario TEXT NOT NULL, question_type TEXT DEFAULT 'Necessary Assumption', status TEXT DEFAULT 'active', result TEXT, score_composure REAL, score_recognition REAL, score_walkback REAL, score_framework REAL, synthesis TEXT, created_at TEXT DEFAULT (datetime('now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS duel_turns (id TEXT PRIMARY KEY, duel_id TEXT NOT NULL, n INTEGER NOT NULL, side TEXT NOT NULL, text TEXT NOT NULL, composure REAL DEFAULT 0.75, tactic_src TEXT, tactic_ref TEXT, tactic_name TEXT, tactic_fallacy TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS law_threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT DEFAULT '', status TEXT DEFAULT 'open', last_elle_note TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS doctrine_mastery (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, law_n TEXT NOT NULL, mastery REAL DEFAULT 0, deployment_count INTEGER DEFAULT 0, times_recognized INTEGER DEFAULT 0, UNIQUE(user_id,source,law_n))`,
    `CREATE TABLE IF NOT EXISTS tutor_questions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, question_type TEXT NOT NULL, axis TEXT NOT NULL, difficulty INTEGER DEFAULT 2, stimulus TEXT NOT NULL, question TEXT NOT NULL, choices_json TEXT NOT NULL, correct_key TEXT NOT NULL, explanation TEXT NOT NULL, scaffolding TEXT NOT NULL, selected_key TEXT, axis_delta INTEGER DEFAULT 0, answered_at TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS user_stats (user_id TEXT PRIMARY KEY, lsat_score INTEGER DEFAULT 155, streak_days INTEGER DEFAULT 0, total_sessions INTEGER DEFAULT 0, last_session TEXT, updated_at TEXT DEFAULT (datetime('now')))`,
  ];
  await env.DB.batch(stmts.map(sql => env.DB.prepare(sql)));
}
