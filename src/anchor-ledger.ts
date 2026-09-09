/** Service-writer anchor ledger. Readers cannot mutate anchors. κ controls recovery,
 * not truth: revisions also require independent-source support and a confidence floor.
 * Evidence independence is supplied by the trusted intake process, not inferred here.
 */
export interface AnchorEvidence { source: string; reference: string; supports: boolean }
export interface AnchorProposal {
  id: string; sphere: number; expectedVersion: number; statement: string;
  kappa: number; evidence: AnchorEvidence[]; exceptions: string[];
}
export interface AnchorPolicy { minSources: number; supportFloor: number; recoveryFloor: number }
export const ANCHOR_POLICY: AnchorPolicy = { minSources: 3, supportFloor: 0.5, recoveryFloor: 0.5 };
export interface AnchorState {
  id: string; sphere: number; version: number; statement: string;
  evidence: AnchorEvidence[]; exceptions: string[]; supportLowerBound: number;
}
export function validateProposal(p: AnchorProposal): void {
  if (!p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 200 ||
      !Number.isInteger(p.sphere) || p.sphere < 1 || p.sphere > 12 ||
      !Number.isInteger(p.expectedVersion) || p.expectedVersion < 0 ||
      typeof p.statement !== 'string' || !p.statement.trim() || p.statement.length > 16000 ||
      !Number.isFinite(p.kappa) || p.kappa < 0 || p.kappa > 1 ||
      !Array.isArray(p.evidence) || p.evidence.length > 1000 ||
      p.evidence.some(e => !e || typeof e.source !== 'string' || !e.source.trim() ||
        typeof e.reference !== 'string' || !e.reference.trim() || typeof e.supports !== 'boolean') ||
      !Array.isArray(p.exceptions) || p.exceptions.length > 1000 || p.exceptions.some(e => typeof e !== 'string' || !e.trim())) {
    throw new Error('invalid anchor proposal');
  }
}
/** Wilson lower bound on source support frequency. Not a calibrated truth probability. */
export function supportBound(evidence: AnchorEvidence[]): number {
  const sources = new Map<string, boolean>();
  for (const e of evidence) sources.set(e.source, (sources.get(e.source) ?? true) && e.supports);
  const n = sources.size; if (!n) return 0;
  const p = [...sources.values()].filter(Boolean).length / n, z = 1.96;
  return (p + z*z/(2*n) - z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1+z*z/n);
}
export function assessAnchor(p: AnchorProposal, current: AnchorState | null, policy = ANCHOR_POLICY) {
  validateProposal(p);
  if (!Number.isInteger(policy.minSources) || policy.minSources < 1 ||
      !Number.isFinite(policy.supportFloor) || policy.supportFloor <= 0 || policy.supportFloor > 1 ||
      !Number.isFinite(policy.recoveryFloor) || policy.recoveryFloor < 0 || policy.recoveryFloor > 1) throw new Error('invalid anchor policy');
  if ((current?.version ?? 0) !== p.expectedVersion) return { accepted: false, reason: 'stale-version', state: current };
  if (current && (current.id !== p.id || current.sphere !== p.sphere)) throw new Error('anchor identity is immutable');
  // A changed statement must earn support afresh; old supporting votes cannot certify new words.
  const prior = current?.statement === p.statement ? current.evidence : [];
  const evidence = [...new Map([...prior, ...p.evidence].map(e => [JSON.stringify(e), e])).values()];
  const lower = supportBound(evidence);
  const state: AnchorState = { id:p.id, sphere:p.sphere, version:p.expectedVersion+1, statement:p.statement,
    evidence, exceptions:[...new Set([...(current?.exceptions ?? []), ...p.exceptions])], supportLowerBound:lower };
  const enough = new Set(evidence.map(e => e.source)).size >= policy.minSources;
  const reason = p.kappa < policy.recoveryFloor ? 'recover-evidence' : !enough ? 'evidence-floor' : lower < policy.supportFloor ? 'support-floor' : 'accepted';
  return { accepted:reason === 'accepted', reason, state };
}
export interface AnchorEnv { DB: D1Database }
async function schema(env: AnchorEnv) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_anchor_events (
    event_id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, version INTEGER NOT NULL,
    accepted INTEGER NOT NULL, reason TEXT NOT NULL, proposal_json TEXT NOT NULL,
    state_json TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
  await env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS elle_anchor_versions
    ON elle_anchor_events(anchor_id, version) WHERE accepted = 1`).run();
}
export async function readAnchor(env: AnchorEnv, id: string): Promise<AnchorState | null> {
  await schema(env);
  const row = await env.DB.prepare('SELECT state_json FROM elle_anchor_events WHERE anchor_id = ? AND accepted = 1 ORDER BY version DESC LIMIT 1').bind(id).first<{state_json:string}>();
  return row ? JSON.parse(row.state_json) : null;
}
export async function anchorHistory(env: AnchorEnv, id: string) {
  await schema(env);
  return (await env.DB.prepare('SELECT event_id, version, accepted, reason, proposal_json, state_json, created_at FROM elle_anchor_events WHERE anchor_id = ? ORDER BY created_at, event_id').bind(id).all()).results;
}
/** Reconstruct the current evidence view without rewriting the accepted statement.
 * Rejected revisions remain visible as exceptions/proposals. Same-statement
 * counterevidence lowers the support score even when it cannot replace the anchor.
 */
export async function recallAnchor(env: AnchorEnv, id: string, kappa: number) {
  if (!Number.isFinite(kappa) || kappa < 0 || kappa > 1) throw new Error('invalid recovery kappa');
  const anchor = await readAnchor(env,id);
  const history = await anchorHistory(env,id);
  const proposals = history.map(row => JSON.parse(row.proposal_json as string) as AnchorProposal);
  const relevant = proposals.filter(p => p.statement === anchor?.statement).flatMap(p => p.evidence);
  const supportLowerBound = supportBound(relevant);
  return { anchor, supportLowerBound,
    action:!anchor || kappa < ANCHOR_POLICY.recoveryFloor || supportLowerBound < ANCHOR_POLICY.supportFloor ? 'recover-evidence' : 'retrieve',
    exceptions:[...new Set(proposals.flatMap(p => p.exceptions))],
    evidenceReferences:[...new Set(proposals.flatMap(p => p.evidence.map(e => e.reference)))],
    history };
}

export async function proposeAnchor(env: AnchorEnv, proposal: AnchorProposal) {
  validateProposal(proposal);
  const current = await readAnchor(env, proposal.id), verdict = assessAnchor(proposal, current);
  const eventId = crypto.randomUUID();
  // Compare-and-swap in the INSERT itself: two writers cannot both advance one version.
  const result = await env.DB.prepare(`INSERT INTO elle_anchor_events
    (event_id,anchor_id,version,accepted,reason,proposal_json,state_json,created_at)
    SELECT ?,?,?, CASE WHEN ? = 1 AND COALESCE((SELECT MAX(version) FROM elle_anchor_events WHERE anchor_id = ? AND accepted = 1),0) = ? THEN 1 ELSE 0 END,
    CASE WHEN ? = 1 AND COALESCE((SELECT MAX(version) FROM elle_anchor_events WHERE anchor_id = ? AND accepted = 1),0) != ? THEN 'stale-version' ELSE ? END,
    ?,?,?`).bind(eventId,proposal.id,proposal.expectedVersion+1,verdict.accepted?1:0,proposal.id,proposal.expectedVersion,
      verdict.accepted?1:0,proposal.id,proposal.expectedVersion,verdict.reason,JSON.stringify(proposal),JSON.stringify(verdict.state),Date.now()).run();
  if (!result.success) throw new Error('anchor event was not persisted');
  const saved = await env.DB.prepare('SELECT accepted FROM elle_anchor_events WHERE event_id = ?').bind(eventId).first<{accepted:number}>();
  return { eventId, accepted:saved?.accepted === 1, reason:verdict.accepted && saved?.accepted !== 1 ? 'stale-version' : verdict.reason,
    anchor:await readAnchor(env,proposal.id) };
}
