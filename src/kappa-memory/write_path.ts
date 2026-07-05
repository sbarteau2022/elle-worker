// write_path.ts — extract (perturbation, response, settling, r), write idempotently.
// Text triple ALWAYS written (functional). κ/r written but provisional until gate clears.
import { SEAM, KAPPA_PROVISIONAL } from "./seam";
import { estimateR, reserveOf, velocityPeak } from "./kappa";

export interface Trace {
  id: string; thread_id: string; created_at: number;
  perturbation: string; response: string; settling: string; settled_open: boolean;
  r_estimate: number | null; kappa_traj: number[] | null; reserve: number | null;
  velocity_peak: number | null; embedding_id: string | null;
  source_mass: "corpus" | "elle" | "reader";
}

async function traceId(thread_id: string, boundary_idx: number): Promise<string> {
  const data = new TextEncoder().encode(`${thread_id}:${boundary_idx}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function writeTrace(db: D1Database, args: {
  thread_id: string; boundary_idx: number; perturbation: string; response: string;
  settling: string; kappa_window?: number[]; embedding_id?: string;
  source_mass: "corpus" | "elle" | "reader";
}): Promise<string> {
  const id = await traceId(args.thread_id, args.boundary_idx);
  const settled_open = args.settling.startsWith("OPEN:");
  const traj = args.kappa_window ?? null;
  const r = traj ? estimateR(traj) : null;
  const reserve = traj ? reserveOf(traj) : null;
  const vpeak = traj ? velocityPeak(traj) : null;

  await db.prepare(
    `INSERT OR IGNORE INTO bending_trace
     (id, thread_id, created_at, perturbation, response, settling, settled_open,
      r_estimate, kappa_traj, reserve, velocity_peak, kappa_provisional, embedding_id, source_mass)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, args.thread_id, Date.now(), args.perturbation, args.response, args.settling,
    settled_open ? 1 : 0, r, traj ? JSON.stringify(traj) : null, reserve, vpeak,
    KAPPA_PROVISIONAL ? 1 : 0, args.embedding_id ?? null, args.source_mass
  ).run();
  return id;
}

// Heuristic boundary until VELOCITY_BOUNDARY clears, then dκ/dt cuts the traces.
export function isBoundary(turnGap: number, topicShift: boolean, vpeak: number): boolean {
  return SEAM.VELOCITY_BOUNDARY ? vpeak > 0 : (turnGap >= 2 || topicShift);
}
