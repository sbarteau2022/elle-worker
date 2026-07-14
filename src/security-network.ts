// ============================================================
// ADVERSARIAL SECURITY NETWORK — src/security-network.ts
//
// The same doctrine war-room.ts teaches as rhetoric (WAR_DECK: the 48 Laws +
// Sun Tzu's Art of War, structurally tagged) read a second way — as a
// taxonomy of ATTACKER TACTICS against the worker itself, each paired with
// an automated counter. Where war-room.ts scores whether a student NAMED
// the tactic used against them, this module scores whether the worker
// RECOGNIZED it — and, unlike the tutor, acts on the recognition.
//
// Three moving parts:
//   SECURITY_DECK    — pure taxonomy: id/src/ref mirror WAR_DECK exactly (one
//                       doctrine, two readings), plus attackerMove/counter/
//                       weight reframed for this worker's real signals.
//   recordThreat()    — classifies a real signal (auth failure, SSRF block,
//                       cyber.ts finding, malware hit) against the deck,
//                       updates a per-actor score in KV (SESSIONS, decaying —
//                       so posture heals on its own, "own_move" tactics never
//                       feed the score) and appends to the D1 ledger.
//   scanBuffer()      — deterministic magic-byte / polyglot malware heuristics
//                       for uploaded files, the cyber.ts static-scan idea
//                       extended to binary content.
//
// This is the network's SELF-UPDATE mechanism: posture is never hardcoded —
// it is computed from the rolling ledger, decays without new signal, and a
// confirmed-malicious hash can be blocklisted at runtime (blockHash) with no
// redeploy. Fail-open throughout: a KV/D1 hiccup degrades to 'normal'/allow,
// never to blocking legitimate traffic on an infra error.
// ============================================================

import type { Env } from './index';
import type { Severity } from './cyber';

export type TacticSrc = '48L' | 'AOW';
export type Posture = 'normal' | 'watch' | 'throttled' | 'blocked';
export type Action = 'allow' | 'challenge' | 'throttle' | 'block';

export interface SecurityTactic {
  id: string;
  src: TacticSrc;
  ref: string;
  name: string;
  category: string;
  // What the tactic looks like when deployed AGAINST this worker — the
  // observable attacker behavior, not the original doctrine's rhetorical move.
  attackerMove: string;
  // The automated/operational countermeasure this worker takes or should take.
  counter: string;
  // Escalation cost of one confirmed hit (0 for the two 'own_move' entries,
  // which describe OUR posture — Tactical Dispositions, Know the Terrain —
  // and never accrue score against an actor).
  weight: number;
  ownMove?: true;
}

// Same ids/src/ref as war-room.ts's WAR_DECK — one taxonomy, two applications.
export const SECURITY_DECK: SecurityTactic[] = [
  { id: 'conceal_intent', src: '48L', ref: '§3', name: 'Conceal Your Intentions', category: 'concealment',
    attackerMove: 'a payload behaves benignly on its surface (valid extension, harmless-looking request) while a hidden path does the real work — droppers, staged second payloads, polyglot files',
    counter: 'never trust surface form; hold any input with a divergent hidden execution path (base64→exec, magic-byte/extension mismatch, staged fetch-then-run) at max severity until proven inert', weight: 4 },
  { id: 'say_less', src: '48L', ref: '§4', name: 'Always Say Less Than Necessary', category: 'concealment',
    attackerMove: 'a minimal, quiet per-request footprint (one field probed at a time) engineered to stay under any single-request threshold — low-and-slow reconnaissance',
    counter: 'score signal across a rolling window per actor, not per request; a drip that never trips one rule still trips the aggregate', weight: 1 },
  { id: 'court_attention', src: '48L', ref: '§6', name: 'Court Attention at All Costs', category: 'appearance',
    attackerMove: 'a loud, obvious probe or junk payload draws attention while a second, quiet channel does the real work',
    counter: 'a loud hit never closes the investigation — check for a concurrent quiet actor in the same window before standing down', weight: 2 },
  { id: 'come_to_you', src: '48L', ref: '§8', name: 'Make Others Come to You', category: 'positioning',
    attackerMove: 'forces the server onto attacker-chosen ground — a crafted redirect or callback URL that makes the worker initiate an outbound connection (SSRF)',
    counter: 'the SSRF guard rejects before any outbound fetch; its rejection is itself a scored signal, not just a 400', weight: 3 },
  { id: 'selective_honesty', src: '48L', ref: '§12', name: 'Selective Honesty to Disarm', category: 'honesty',
    attackerMove: 'one deliberately cheap, obvious indicator (a decoy secret, a junk string) gets a scanner to log one low finding and move on, while the real payload sits unexamined nearby',
    counter: 'one low-severity hit on a submission raises scrutiny of the WHOLE submission — it never closes the review', weight: 2 },
  { id: 'self_interest', src: '48L', ref: '§13', name: 'Appeal to Self-Interest', category: 'assistance',
    attackerMove: 'phishing/social-engineering payloads framed around what the target gains (refund, prize, urgent benefit) to short-circuit scrutiny of a link or attachment',
    counter: 'benefit-now framing in inbound content is scored as a signal independent of, and in addition to, the technical payload', weight: 2 },
  { id: 'unpredictability', src: '48L', ref: '§17', name: 'Suspended Terror (Unpredictability)', category: 'predictability',
    attackerMove: 'polymorphic code, jittered beacon timing, randomized request shape — engineered so no two hits share a signature',
    counter: 'detect by WHAT the code does (exec sinks, exfil shape), not a fixed byte signature, and track actor identity across shape changes', weight: 4 },
  { id: 'play_sucker', src: '48L', ref: '§21', name: 'Play a Sucker to Catch a Sucker', category: 'deception',
    attackerMove: 'bait content (a fake error, an inviting "debug" endpoint) is probed to reveal attacker intent or tooling',
    counter: 'deploy the same trick back — honeytoken routes with no legitimate caller; any hit is unambiguous', weight: 2 },
  { id: 'surrender_tactic', src: '48L', ref: '§22', name: 'The Surrender Tactic', category: 'concession',
    attackerMove: 'goes quiet after a block or throttle (rotates IP, waits out a cooldown) to look clean, then re-enters from a new vector',
    counter: 'posture decays slowly, not instantly, and score ties to identity (account/fingerprint) that survives an IP change', weight: 2 },
  { id: 'need_to_believe', src: '48L', ref: '§27', name: "Play on People's Need to Believe", category: 'attraction',
    attackerMove: 'a convincing but fabricated trusted source — spoofed sender, forged cert chain, look-alike domain',
    counter: 'verify provenance mechanically (signatures, cert chain, domain distance); plausibility never substitutes for verification', weight: 3 },
  { id: 'boldness', src: '48L', ref: '§28', name: 'Enter Action with Boldness', category: 'boldness',
    attackerMove: 'a request that LOOKS like an authenticated admin action, counting on the system to trust presentation over credential',
    counter: 'every privileged action re-checks the actual credential/scope at the point of execution, never the caller\'s framing', weight: 2 },
  { id: 'control_options', src: '48L', ref: '§31', name: 'Control the Options', category: 'frame-control',
    attackerMove: 'a downgrade attack — narrows the protocol/scheme/port menu so the weakest option gets picked',
    counter: 'refuse to negotiate down: fixed allowlist of schemes/ports (ssrf.ts), no fallback path that accepts a weaker option', weight: 3 },
  { id: 'fantasies', src: '48L', ref: '§32', name: "Play to People's Fantasies", category: 'attraction',
    attackerMove: 'attachments/links pitched as something desirable (free tool, "you won") to get unexamined content run or clicked',
    counter: 'score the pitch itself alongside the technical scan; a desirable pitch on executable content is a finding on its own', weight: 2 },
  { id: 'thumbscrew', src: '48L', ref: '§33', name: "Discover Each Man's Thumbscrew", category: 'positioning',
    attackerMove: 'targets a known weak point precisely — a stale dependency, a disabled-but-reachable route, a credential believed leaked',
    counter: 'maintain a live inventory of known-weak surface and monitor it MORE once it is known-weak, not less', weight: 3 },
  { id: 'spectacle', src: '48L', ref: '§37', name: 'Create Compelling Spectacles', category: 'appearance',
    attackerMove: 'a dramatic-looking payload (huge encoded blob, alarming filename) engineered so the reviewer inspects the spectacle and misses the sink',
    counter: 'the structural scan runs regardless of how the input looks; findings are reported by kind/line, never narrative impression', weight: 1 },
  { id: 'stir_waters', src: '48L', ref: '§39', name: 'Stir Up Waters to Catch Fish', category: 'timing',
    attackerMove: 'floods the system with noise (junk requests, alarming errors) to degrade monitoring right before or during the real move',
    counter: 'rate-limit and log the flood itself as an event, then keep scanning underneath it — flood is signal, not a wall', weight: 3 },
  { id: 'hearts_minds', src: '48L', ref: '§43', name: 'Work on Hearts and Minds', category: 'attraction',
    attackerMove: 'social content built to earn trust/identity affinity (impersonating a known contact) so a malicious link is waved through on relationship, not verification',
    counter: 'sender/source identity is verified mechanically; felt trust never substitutes for that check', weight: 2 },
  { id: 'mirror', src: '48L', ref: '§44', name: 'The Mirror Effect', category: 'frame-control',
    attackerMove: 'replays legitimate-looking traffic shapes or mimics a known-good client fingerprint to blend into normal use',
    counter: 'a request fingerprint that is a byte-for-byte match to internal tooling, from an EXTERNAL actor, is itself the anomaly', weight: 3 },
  { id: 'formlessness', src: '48L', ref: '§48', name: 'Assume Formlessness', category: 'frame-control',
    attackerMove: 'fileless/in-memory execution with no fixed signature, reformulated on every attempt',
    counter: 'no single detector is trusted alone; code with no resolvable, testable structural commitment (an eval/exec/network sink) stays flagged rather than cleared', weight: 4 },
  { id: 'laying_plans', src: 'AOW', ref: 'I', name: 'Laying Plans (Frame the Battlefield)', category: 'positioning',
    attackerMove: 'reconnaissance — enumerates routes, headers, error messages to map the target before the real attempt',
    counter: 'recon patterns (systematic path-walking, header fuzzing) are logged and scored per actor before any "real" attempt lands', weight: 2 },
  { id: 'win_without_fighting', src: 'AOW', ref: 'III', name: 'Win Without Fighting', category: 'authority',
    attackerMove: 'wins through a trusted channel rather than a direct attack — a compromised dependency or forged CI credential that arrives already "authorized"',
    counter: 'trust is verified at the artifact (hash/signature), never granted merely for arriving over an internal channel', weight: 4 },
  { id: 'tactical_disposition', src: 'AOW', ref: 'IV', name: 'Tactical Dispositions (Invincibility First)', category: 'positioning',
    attackerMove: '(our own posture, not an attacker signal — see war-room.ts\'s "+" valence)',
    counter: 'secure the choke points before an incident, not after: auth, SSRF, and static scan run as a standing gate on every request, not on demand', weight: 0, ownMove: true },
  { id: 'attack_emptiness', src: 'AOW', ref: 'VI', name: 'Attack the Emptiness', category: 'deception',
    attackerMove: 'targets whichever surface is least monitored — the one route or code path nobody is watching — instead of the hardened front door',
    counter: 'monitoring coverage is uniform across every route/binding; there is no unmonitored surface for an attacker to find', weight: 3 },
  { id: 'know_terrain', src: 'AOW', ref: 'X', name: 'Know the Terrain', category: 'positioning',
    attackerMove: '(our own posture, not an attacker signal — see war-room.ts\'s "+" valence)',
    counter: 'maintain a live map — this deck plus the events ledger — so the defender knows the terrain at least as well as anyone mapping it', weight: 0, ownMove: true },
];

const DECK_BY_ID = new Map(SECURITY_DECK.map(t => [t.id, t]));

// ── Signal → tactic classification — pure, deterministic, unit-tested ──────
// Real call sites pass a `kind` string; this is the one place that maps a
// raw signal to the doctrine. Unknown kinds classify to nothing (fail-open).
export const SIGNAL_TACTIC: Record<string, string[]> = {
  'auth.bad_credentials':        ['thumbscrew'],
  'auth.signup_flood':           ['stir_waters', 'say_less'],
  'auth.token_replay':           ['mirror'],
  'ratelimit.exceeded':          ['stir_waters', 'say_less'],
  'ssrf.blocked':                ['come_to_you', 'control_options'],
  'cyber.secret':                ['selective_honesty'],
  'cyber.exec':                  ['conceal_intent', 'formlessness'],
  'cyber.obfuscation':           ['conceal_intent', 'formlessness'],
  'cyber.injection':             ['attack_emptiness'],
  'cyber.reverse_shell':         ['conceal_intent'],
  'upload.polyglot':             ['conceal_intent'],
  'upload.malware_signature':    ['formlessness'],
  'recon.enumeration':           ['laying_plans'],
  'supply_chain.unverified':     ['win_without_fighting'],
};

export function tacticsFor(signalKind: string): SecurityTactic[] {
  const ids = SIGNAL_TACTIC[signalKind] || [];
  return ids.map(id => DECK_BY_ID.get(id)).filter((t): t is SecurityTactic => !!t);
}

// ── Posture — pure scoring/escalation, unit-tested ─────────────────────────
// Score decays continuously so a quiet actor's posture heals without any
// admin action — the network updating its own defenses without a redeploy.
const DECAY_PER_HOUR = 1;

export function decayedScore(score: number, elapsedMs: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  return Math.max(0, score - DECAY_PER_HOUR * hours);
}

const POSTURE_THRESHOLDS: { min: number; posture: Posture }[] = [
  { min: 12, posture: 'blocked' },
  { min: 6, posture: 'throttled' },
  { min: 2, posture: 'watch' },
  { min: 0, posture: 'normal' },
];

export function postureFor(score: number): Posture {
  for (const t of POSTURE_THRESHOLDS) if (score >= t.min) return t.posture;
  return 'normal';
}

export function actionFor(posture: Posture): Action {
  if (posture === 'blocked') return 'block';
  if (posture === 'throttled') return 'throttle';
  if (posture === 'watch') return 'challenge';
  return 'allow';
}

// Pure: the next stored score given the previous score/timestamp and a new
// hit's weight. ownMove tactics (weight 0) never move the needle.
export function nextScore(prevScore: number, prevAtMs: number, nowMs: number, weight: number): number {
  return decayedScore(prevScore, nowMs - prevAtMs) + Math.max(0, weight);
}

// ── Malware / file heuristics — pure, unit-tested ──────────────────────────
export interface FileFinding { kind: string; severity: Severity; detail: string }

const MAGIC_SIGNATURES: { bytes: number[]; kind: string; label: string }[] = [
  { bytes: [0x4d, 0x5a], kind: 'exe.pe', label: 'Windows PE/EXE' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: 'exe.elf', label: 'ELF executable' },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], kind: 'exe.macho', label: 'Mach-O executable (64-bit)' },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], kind: 'exe.macho', label: 'Mach-O executable (32-bit)' },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], kind: 'exe.macho-fat', label: 'Mach-O fat binary / Java class' },
];

const EXECUTABLE_EXT = /\.(exe|dll|so|dylib|bin|out|elf|scr|com|msi)$/i;
const SCRIPT_EXT = /\.(sh|bash|ps1|bat|cmd|vbs|js|cjs|mjs|py|pl)$/i;
const IMAGE_OR_DOC_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md)$/i;

function matchMagic(bytes: Uint8Array): { kind: string; label: string } | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (bytes.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => bytes[i] === b)) return { kind: sig.kind, label: sig.label };
  }
  return null;
}

// Pure. Deterministic magic-byte + polyglot heuristics — this worker never
// executes an upload (same containment posture as cyber.ts's static scan).
export function scanBuffer(bytes: Uint8Array, filename: string): FileFinding[] {
  const out: FileFinding[] = [];
  const name = String(filename || '');
  const magic = matchMagic(bytes);

  if (magic) {
    if (IMAGE_OR_DOC_EXT.test(name)) {
      // conceal_intent: the surface form (image/document extension) disagrees
      // with the actual content (executable bytes) — a dropper/polyglot shape.
      out.push({
        kind: `polyglot.${magic.kind}`, severity: 'critical',
        detail: `${magic.label} header found inside a file named like a document/image (${name}) — content disagrees with its declared type`,
      });
    } else if (!EXECUTABLE_EXT.test(name)) {
      out.push({
        kind: magic.kind, severity: 'high',
        detail: `${magic.label} content in a file with no executable extension (${name || 'unnamed upload'})`,
      });
    }
  }

  if (IMAGE_OR_DOC_EXT.test(name) && !SCRIPT_EXT.test(name)) {
    const head = new TextDecoder('utf-8').decode(bytes.slice(0, 4096));
    if (/<script[\s>]|autoopen|vbaproject|shell\s*\(|activexobject/i.test(head)) {
      out.push({
        kind: 'polyglot.embedded-script', severity: 'high',
        detail: `document/image-typed file (${name}) contains embedded script or macro markers`,
      });
    }
  }

  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Runtime state — KV for hot-path posture (decaying score), D1 for the
//    durable event ledger. Every write here is best-effort: an infra hiccup
//    must never block the request path (fail-open, same posture as cyber.ts). ──
const POSTURE_PREFIX = 'secnet:posture:';
const HASH_BLOCKLIST_KEY = 'secnet:hash-blocklist';

function genId(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export interface ThreatSignal {
  actorKey: string;   // 'ip:x.x.x.x' | 'user:<id>' | 'hash:<sha256>'
  source: 'auth' | 'ratelimit' | 'ssrf' | 'cyber' | 'upload' | 'recon' | 'supply_chain';
  kind: string;       // key into SIGNAL_TACTIC
  detail: string;
}

export interface ThreatOutcome {
  tactics: SecurityTactic[];
  posture: Posture;
  action: Action;
  score: number;
}

export async function getPosture(env: Env, actorKey: string): Promise<{ posture: Posture; score: number }> {
  try {
    const raw = await env.SESSIONS.get(POSTURE_PREFIX + actorKey);
    if (!raw) return { posture: 'normal', score: 0 };
    const st = JSON.parse(raw) as { score: number; at: number };
    const score = decayedScore(st.score, Date.now() - st.at);
    return { posture: postureFor(score), score };
  } catch {
    return { posture: 'normal', score: 0 }; // fail-open
  }
}

export async function recordThreat(env: Env, signal: ThreatSignal): Promise<ThreatOutcome> {
  const tactics = tacticsFor(signal.kind);
  const weight = tactics.reduce((m, t) => Math.max(m, t.weight), tactics.length ? 0 : 1);
  const now = Date.now();

  let prevScore = 0, prevAt = now;
  try {
    const raw = await env.SESSIONS.get(POSTURE_PREFIX + signal.actorKey);
    if (raw) { const st = JSON.parse(raw) as { score: number; at: number }; prevScore = st.score; prevAt = st.at; }
  } catch { /* fail-open: treat as a clean actor */ }

  const score = nextScore(prevScore, prevAt, now, weight);
  const posture = postureFor(score);

  await env.SESSIONS.put(POSTURE_PREFIX + signal.actorKey, JSON.stringify({ score, at: now }), { expirationTtl: 86400 }).catch(() => {});

  await env.DB.prepare(
    `INSERT INTO elle_security_events (id, actor_key, source, kind, tactic_ids, severity_weight, posture, detail) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    genId(), signal.actorKey, signal.source, signal.kind,
    tactics.map(t => t.id).join(','), weight, posture, String(signal.detail || '').slice(0, 500),
  ).run().catch(() => {});

  return { tactics, posture, action: actionFor(posture), score };
}

export async function isBlockedHash(env: Env, hash: string): Promise<boolean> {
  try {
    const raw = await env.SESSIONS.get(HASH_BLOCKLIST_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as string[]).includes(hash);
  } catch { return false; }
}

// The network updating its own defenses at runtime: once a hash is confirmed
// malicious, block it outright for every future submission — no redeploy.
export async function blockHash(env: Env, hash: string, reason: string): Promise<void> {
  try {
    const raw = await env.SESSIONS.get(HASH_BLOCKLIST_KEY);
    let list: string[] = [];
    try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
    if (!list.includes(hash)) list.push(hash);
    await env.SESSIONS.put(HASH_BLOCKLIST_KEY, JSON.stringify(list.slice(-500)));
  } catch { /* best-effort */ }
  await recordThreat(env, { actorKey: `hash:${hash}`, source: 'upload', kind: 'upload.malware_signature', detail: reason });
}

// ── Report — the tactical dashboard, admin-gated in index.ts ───────────────
export interface SecurityReportRow {
  id: string; actor_key: string; source: string; kind: string;
  tactic_ids: string; severity_weight: number; posture: string; detail: string; created_at: string;
}

export async function securityReport(env: Env): Promise<{
  recent: SecurityReportRow[];
  posture_counts: Record<Posture, number>;
  by_tactic: { id: string; name: string; category: string; src: TacticSrc; ref: string; counter: string; hits: number }[];
}> {
  const recent = await env.DB.prepare(
    `SELECT id, actor_key, source, kind, tactic_ids, severity_weight, posture, detail, created_at
     FROM elle_security_events ORDER BY created_at DESC LIMIT 50`
  ).all().then(r => (r.results || []) as unknown as SecurityReportRow[]).catch(() => [] as SecurityReportRow[]);

  const tally: Record<string, number> = {};
  const posture_counts: Record<Posture, number> = { normal: 0, watch: 0, throttled: 0, blocked: 0 };
  for (const row of recent) {
    for (const tid of String(row.tactic_ids || '').split(',').filter(Boolean)) tally[tid] = (tally[tid] || 0) + 1;
    const p = row.posture as Posture;
    if (p in posture_counts) posture_counts[p]++;
  }

  const by_tactic = SECURITY_DECK
    .filter(t => tally[t.id])
    .map(t => ({ id: t.id, name: t.name, category: t.category, src: t.src, ref: t.ref, counter: t.counter, hits: tally[t.id] }))
    .sort((a, b) => b.hits - a.hits);

  return { recent, posture_counts, by_tactic };
}

// Actor key helper — IP-first, so an unauthenticated door still gets a posture.
export function actorKeyFor(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `ip:${ip}`;
}
