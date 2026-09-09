/** Trusted device intake. Numeric geometry is descriptive; it does not create
 * factual support votes. The caller must supply evidence and source attribution.
 */
import type { Env } from './index';
import { analyzeSpectrum } from './pfar';
import { pamiIndex, pamiStore } from './pami';
import { pamiBridgeVector } from './pami-bridge';
import { placeFeatures } from './hyper';
import { ATLAS_BALL_DIM } from './atlas-store';
import { proposeAnchor, validateProposal, ensureAnchorSchema, type AnchorProposal } from './anchor-ledger';

export interface AnchorIntake {
  source: string; content: string; samples: number[]; prediction?: number[];
  sampleRate?: number; proposal: AnchorProposal;
}
async function schema(env: Pick<Env,'DB'>) {
  await ensureAnchorSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_anchor_intake (
    memory_id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, event_id TEXT NOT NULL,
    source TEXT NOT NULL, content TEXT NOT NULL, observation_json TEXT NOT NULL,
    geometry_json TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
}
export function encodeAnchorIntake(input: AnchorIntake) {
  validateProposal(input.proposal);
  if (typeof input.source !== 'string' || !input.source.trim() || typeof input.content !== 'string' ||
      !input.content.trim() || input.content.length > 64000 || !Array.isArray(input.samples) ||
      input.samples.length < 32 || input.samples.length > 4096 || input.samples.some(x=>!Number.isFinite(x)) ||
      (input.prediction !== undefined && (!Array.isArray(input.prediction) || input.prediction.length !== input.samples.length || input.prediction.some(x=>!Number.isFinite(x)))) ||
      (input.sampleRate !== undefined && (!Number.isFinite(input.sampleRate) || input.sampleRate<=0))) throw new Error('invalid measured intake');
  if (!input.proposal.evidence.some(e=>e.source === input.source)) throw new Error('intake source must occur in proposal evidence');
  const residual = input.samples.map((x,i)=>x-(input.prediction?.[i] ?? 0));
  if (residual.some(x=>!Number.isFinite(x))) throw new Error('residual overflow');
  const index = pamiIndex(residual);
  if (!index) throw new Error('PAMI could not encode this observation');
  const ball = placeFeatures(pamiBridgeVector(index),ATLAS_BALL_DIM);
  if (ball.some(x=>!Number.isFinite(x)) || Math.hypot(...ball)>=1) throw new Error('invalid PAMI ball embedding');
  const r=2/(1+Math.sqrt(5));
  const surfacePairs = Array.from({length:4},(_,i)=>{
    const theta=index.phases[2*i], phi=index.phases[2*i+1], rho=1+r*Math.cos(theta);
    return [rho*Math.cos(phi),rho*Math.sin(phi),r*Math.sin(theta)];
  });
  return {index, spectrum:analyzeSpectrum(residual,input.sampleRate), ball,
    torus:{kind:'embedded-ring-torus',R:1,r,phases:index.phases,surfacePairs},
    residual, baselineAvailable:input.prediction!==undefined};
}
export async function ingestAnchorObservation(env: Env, input: AnchorIntake) {
  const encoded=encodeAnchorIntake(input);
  await schema(env);
  // Raw observation remains lossless here. PAMI's short content field is an index preview.
  const memoryId=await pamiStore(env,encoded.index,input.content);
  const proposal={...input.proposal,evidence:input.proposal.evidence.map(e=>e.source===input.source?{...e,reference:`pami:${memoryId}`}:e)};
  const revision=await proposeAnchor(env,proposal,eventId=>[env.DB.prepare(`INSERT INTO elle_anchor_intake
    (memory_id,anchor_id,event_id,source,content,observation_json,geometry_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(memoryId,proposal.id,eventId,input.source,input.content,
      JSON.stringify({samples:input.samples,prediction:input.prediction??null,residual:encoded.residual}),
      JSON.stringify({index:encoded.index,spectrum:encoded.spectrum,ball:encoded.ball,torus:encoded.torus,baselineAvailable:encoded.baselineAvailable}),Date.now())]);
  return {memoryId,...revision,geometry:encoded};
}
/** Only accepted current revisions enter this read-only map. Rejected intake remains auditable. */
export async function readAnchorIntakeMap(env: Pick<Env,'DB'>) {
  await schema(env);
  return (await env.DB.prepare(`SELECT i.memory_id,i.anchor_id,i.source,i.geometry_json,e.version
    FROM elle_anchor_intake i JOIN elle_anchor_events e ON i.event_id=e.event_id
    WHERE e.accepted=1 AND e.version=(SELECT MAX(v.version) FROM elle_anchor_events v WHERE v.anchor_id=i.anchor_id AND v.accepted=1)
    ORDER BY i.anchor_id`).all()).results;
}
