// VENDORED from CustomCourseBuilder src/runtime/seal.ts — do not hand-edit.
// Authoring, tests, and CLI live in that repo; re-sync with
// scripts/sync-education.sh after building there.
/**
 * Sealing — the credential corpus made tamper-evident.
 *
 * "Sealed. Immutable. Verifiable." is implemented as a hash chain: each
 * reading's SHA-256 covers its canonical content plus the hash of the
 * reading before it. Rewriting any sealed reading invalidates every hash
 * after it, so the corpus can be handed to a third party and verified
 * without trusting the holder.
 */
import { createHash } from "node:crypto";
import type { LearnerState, ReadingKind, SealedReading } from "./state.ts";

export const GENESIS_HASH = "0".repeat(64);

export interface ReadingContent {
  kind: ReadingKind;
  unitId?: string;
  phaseId?: string;
  tier1MaterialGround: string;
  tier2ObserverReading: string;
  tier3SitWithThis: string;
}

function contentHash(seq: number, at: string, content: ReadingContent, prevHash: string): string {
  const canonical = JSON.stringify([
    seq,
    at,
    content.kind,
    content.unitId ?? null,
    content.phaseId ?? null,
    content.tier1MaterialGround,
    content.tier2ObserverReading,
    content.tier3SitWithThis,
    prevHash,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const MIN_TIER_LENGTH = 40;

/** Seal a new reading onto the learner's chain. Thin tiers are refused. */
export function sealReading(state: LearnerState, content: ReadingContent, now: Date): SealedReading {
  for (const [tier, text] of [
    ["tier1MaterialGround", content.tier1MaterialGround],
    ["tier2ObserverReading", content.tier2ObserverReading],
    ["tier3SitWithThis", content.tier3SitWithThis],
  ] as const) {
    if (text.trim().length < MIN_TIER_LENGTH) {
      throw new Error(
        `refusing to seal: ${tier} is under ${MIN_TIER_LENGTH} characters. ` +
          `A reading too thin to mean anything must not enter the credential corpus.`,
      );
    }
  }
  const prev = state.sealedReadings.at(-1);
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const at = now.toISOString();
  const reading: SealedReading = {
    seq,
    at,
    ...content,
    prevHash,
    hash: contentHash(seq, at, content, prevHash),
  };
  state.sealedReadings.push(reading);
  return reading;
}

/** Verify the whole chain. Returns the list of broken seals (empty = intact). */
export function verifyChain(readings: SealedReading[]): string[] {
  const broken: string[] = [];
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of readings) {
    if (r.seq !== expectedSeq) broken.push(`reading #${r.seq}: expected seq ${expectedSeq}`);
    if (r.prevHash !== prevHash) broken.push(`reading #${r.seq}: prevHash does not match chain`);
    const recomputed = contentHash(r.seq, r.at, r, r.prevHash);
    if (recomputed !== r.hash) broken.push(`reading #${r.seq}: content does not match its seal`);
    prevHash = r.hash;
    expectedSeq = r.seq + 1;
  }
  return broken;
}
