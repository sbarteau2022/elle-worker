// ============================================================
// CONVICTION CHANNEL — src/conviction.ts  —  LIVE (built in)
//
// The asymmetric log-odds regulator (src/recovery.ts), wired into the real
// trading loop. This is the promotion the whole validation arc earned:
// 5yr real OHLC, 591 paired envelopes, three closed gates — measured
// identity: a DRAWDOWN-SHAPER (cheapest-to-run left-tail control in the
// series, robust to 10× costs, halves damage even inside losing
// strategies), not an alpha source. So it is built in as exactly that:
//
//   · every open position gets a regulator; each trading-cron cycle is one
//     observation on the fast (ρ=0.10) clock — dir = did the bar confirm or
//     violate the position's thesis, weight w = |ret| / (2·ATR) (the
//     perturbation IN the recursion, same form the overlay validated);
//   · κ = logistic(z) is the position's conviction, surfaced to the
//     decision loop every cycle (Elle sees her own strain);
//   · sizing is DE-RISK ONLY: target = entryQty · min(1, κ/κ₀), κ₀ = 0.5.
//     Neutral or charged conviction ⇒ full size (the Gate-2 lesson: no
//     up-levering — the throttle that levered UP re-amputated the tail).
//     Strained conviction trims toward the κ floor, which is OPEN
//     (logistic(−3) ≈ 0.047 ⇒ fraction ≈ 0.094): complete failure —
//     size 0 by regulator alone — is structurally unreachable. RULE 0
//     (hard stops in price space) remains outside κ, untouched.
//   · the trim EXECUTOR is gated: ELLE_CONVICTION_ENFORCE === 'on'. The
//     ledger runs live either way — state, κ, and target land in D1 every
//     cycle, so the instrument's live behavior is auditable before and
//     after the switch is thrown.
//
// Workers are stateless across cron firings, so the regulator state (z, the
// ATR scale, the entry-qty reference) persists in D1 (elle_conviction) and
// steps through the SAME pure function the in-memory closure uses
// (stepAsymmetricZ) — one law, whether the state lives in memory or a row.
//
// Step invariant carried over live: one cycle — even a maximal-shock bar —
// cannot collapse a position's size (w=1 from neutral moves the fraction to
// ~0.85, never through the strained threshold; minima proven in
// step-invariant.test.ts hold here as worst-case floors).
// ============================================================
import {
  PHI, ASYM_RHO_DEFAULT, ASYM_Z_MAX,
  stepAsymmetricZ, asymmetricKappa,
  type RecoveryDirection,
} from './recovery';

// Wilder window on the observation cadence itself: the perturbation scale is
// an EMA of |per-cycle return|, n=22 — the same window the validated harness
// used for its ATR, transposed onto the cadence the regulator actually
// observes. Self-consistent: no second data feed, no unit mismatch.
export const CONVICTION_ATR_N = 22;
export const KAPPA_NEUTRAL = 0.5;   // z=0 start: full size until strain is observed
// Meaningful-trim floor: don't churn sub-share or <5%-of-position orders.
export const TRIM_MIN_FRACTION = 0.05;

export interface ConvictionState {
  symbol: string;
  z: number;          // regulator state, persisted between cron firings
  step: number;       // observations taken
  atr: number;        // EMA(|ret|) — the perturbation scale (fractional)
  prevPrice: number;  // last observed price
  entryQty: number;   // high-water qty reference the de-risk fraction applies to
}

export interface ConvictionReading {
  state: ConvictionState;
  kappa: number;
  status: 'strained' | 'holding' | 'charged';
  targetFraction: number;
}

const statusOf = (z: number): ConvictionReading['status'] => {
  const zMaxRecover = ASYM_Z_MAX / (PHI * PHI);
  return z < -ASYM_Z_MAX / 2 ? 'strained' : z > zMaxRecover / 2 ? 'charged' : 'holding';
};

export function freshState(symbol: string, price: number, qty: number): ConvictionState {
  return { symbol, z: 0, step: 0, atr: 0, prevPrice: price, entryQty: Math.abs(qty) };
}

// De-risk-only sizing: neutral (κ₀) and above ⇒ 1; below ⇒ proportional.
// Open floor inherited from the regulator: min fraction ≈ 0.094, never 0.
export function targetFraction(kappa: number): number {
  return Math.min(1, kappa / KAPPA_NEUTRAL);
}

export function reading(state: ConvictionState): ConvictionReading {
  const kappa = asymmetricKappa(state.z);
  return { state, kappa, status: statusOf(state.z), targetFraction: targetFraction(kappa) };
}

// One trading-cron cycle = one observation. Direction is thesis-relative
// (a red bar CONFIRMS a short); weight is the validated perturbation form.
export function observeCycle(
  state: ConvictionState, price: number, side: 'long' | 'short',
): ConvictionReading {
  if (!Number.isFinite(price) || price <= 0 || state.prevPrice <= 0) {
    return reading({ ...state, prevPrice: Number.isFinite(price) && price > 0 ? price : state.prevPrice });
  }
  const ret = (price - state.prevPrice) / state.prevPrice;
  const absRet = Math.abs(ret);
  // Seed the scale with the first move ever seen (w = 0.5 on that step);
  // thereafter Wilder-blend. A zero-move cycle is a w=0 observation: no
  // information, the leak alone breathes the state back toward neutral.
  const atrPrev = state.step === 0 || state.atr === 0 ? absRet : state.atr;
  const w = atrPrev > 0 ? Math.min(1, absRet / (2 * atrPrev)) : 0;
  const adverse = side === 'short' ? ret > 0 : ret < 0;
  const dir: RecoveryDirection = adverse ? 'strain' : 'recover';
  const z = stepAsymmetricZ(state.z, dir, w);
  const atr = atrPrev + (absRet - atrPrev) / CONVICTION_ATR_N;
  return reading({ ...state, z, atr, prevPrice: price, step: state.step + 1 });
}

// How many units the executor may trim THIS cycle. De-risk only — never a
// buy-back — and only when the trim is meaningful (≥1 unit, ≥5% of the
// position). Returns 0 when nothing should happen.
export function trimQty(currentQty: number, state: ConvictionState, kappa: number): number {
  const qty = Math.abs(currentQty);
  // max(1, …): the regulator's κ floor is open (never 0), so its executor
  // must never flatten a position either — floor() on a small position
  // would otherwise round the last unit away. Full exits belong to the
  // decision loop and RULE 0, not to this path.
  const target = Math.max(1, Math.floor(state.entryQty * targetFraction(kappa)));
  const trim = Math.floor(qty - target);
  if (trim < 1) return 0;
  if (trim / qty < TRIM_MIN_FRACTION) return 0;
  return trim;
}

// Plain equities only: OCC option symbols carry digits (e.g. NVDA260320C...)
// and their marks aren't observed here — the channel would be stepping blind.
export function isEquitySymbol(symbol: string): boolean {
  return /^[A-Z][A-Z.]{0,6}$/.test(symbol);
}

// ── replay: the SAME live functions, run over a historical bar series ──
// "Run the previous trades back through" = seed at the entry bar, then feed
// every bar close through observeCycle exactly as the live cron would have,
// one bar = one cycle. Nothing here re-implements the regulator; it drives
// the identical observeCycle/trimQty the live path uses, so the trajectory
// is what the channel WOULD have reported had it been live for that trade.
export interface ReplayStep {
  d: string;   // bar date (ISO)
  c: number;   // close
  k: number;   // kappa
  s: ConvictionReading['status'];
  tf: number;  // target fraction
  trim: number; // units the (gated) executor would have trimmed this bar
}
export interface ReplayResult {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  entryQty: number;
  bars: number;
  finalKappa: number;
  minKappa: number;
  minStatus: ConvictionReading['status'];
  everStrained: boolean;
  maxTrimFraction: number;   // deepest de-risk the executor would have taken
  totalTrimmed: number;      // units, if every would-be trim had fired in sequence
  trajectory: ReplayStep[];
}

// closes: chronological bar closes over the holding period (closes[0] = entry
// bar). qty/side are the real position. The executor half is simulated in
// sequence (running qty walks down as trims fire) so the trajectory reflects
// what enforcement WOULD have done, not just the passive κ.
export function replayBars(
  symbol: string, side: 'long' | 'short', closes: Array<{ d: string; c: number }>, entryQty: number,
): ReplayResult | null {
  const clean = closes.filter(b => Number.isFinite(b.c) && b.c > 0);
  if (clean.length < 2) return null;
  let state = freshState(symbol, clean[0].c, entryQty);
  const trajectory: ReplayStep[] = [];
  let minKappa = 0.5, minStatus: ConvictionReading['status'] = 'holding';
  let maxTrimFraction = 0, runningQty = entryQty, totalTrimmed = 0;
  let everStrained = false;
  for (let i = 1; i < clean.length; i++) {
    const r = observeCycle(state, clean[i].c, side);
    state = r.state;
    const trim = trimQty(runningQty, state, r.kappa);
    if (trim > 0) { runningQty -= trim; totalTrimmed += trim; }
    const trimmedFraction = 1 - runningQty / entryQty;
    if (trimmedFraction > maxTrimFraction) maxTrimFraction = trimmedFraction;
    if (r.kappa < minKappa) { minKappa = r.kappa; minStatus = r.status; }
    if (r.status === 'strained') everStrained = true;
    trajectory.push({ d: clean[i].d, c: clean[i].c, k: r.kappa, s: r.status, tf: r.targetFraction, trim });
  }
  const last = trajectory[trajectory.length - 1];
  return {
    symbol, side, entryPrice: clean[0].c, entryQty,
    bars: clean.length, finalKappa: last.k, minKappa, minStatus, everStrained,
    maxTrimFraction, totalTrimmed, trajectory,
  };
}

export async function ensureReplaySchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_conviction_replay (
       symbol TEXT PRIMARY KEY,
       side TEXT, entry_source TEXT, entry_price REAL, current_price REAL,
       qty REAL, bars INTEGER, final_kappa REAL, min_kappa REAL, min_status TEXT,
       ever_strained INTEGER, max_trim_fraction REAL, total_trimmed REAL,
       trajectory_json TEXT, as_of TEXT, updated_at TEXT
     )`,
  ).run();
}

// ── D1 persistence (thin; all judgment lives in the pure functions above) ──

export async function ensureConvictionSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_conviction (
       symbol TEXT PRIMARY KEY,
       z REAL NOT NULL DEFAULT 0,
       step INTEGER NOT NULL DEFAULT 0,
       atr REAL NOT NULL DEFAULT 0,
       prev_price REAL NOT NULL DEFAULT 0,
       entry_qty REAL NOT NULL DEFAULT 0,
       kappa REAL,
       status TEXT,
       target_fraction REAL,
       updated_at TEXT
     )`,
  ).run();
}

export interface LivePosition {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  price: number;
}

// One pass over the open positions: rehydrate each regulator from its row,
// observe (market hours only — closed-market cycles carry no information and
// must not leak the state), persist, and return the readings keyed by
// symbol. Rows for symbols no longer held are cleared: a closed position's
// conviction history ends with the position (fresh entry ⇒ fresh trust).
export async function runConvictionCycle(
  db: D1Database, positions: LivePosition[], marketIsOpen: boolean,
): Promise<Map<string, ConvictionReading>> {
  await ensureConvictionSchema(db);
  const readings = new Map<string, ConvictionReading>();
  const held = positions.filter(p => isEquitySymbol(p.symbol) && Number.isFinite(p.qty) && p.qty !== 0);

  const rows = await db.prepare(`SELECT symbol, z, step, atr, prev_price, entry_qty FROM elle_conviction`).all();
  const bySymbol = new Map<string, ConvictionState>();
  for (const r of (rows.results || []) as Array<Record<string, unknown>>) {
    bySymbol.set(String(r.symbol), {
      symbol: String(r.symbol),
      z: Number(r.z) || 0,
      step: Number(r.step) || 0,
      atr: Number(r.atr) || 0,
      prevPrice: Number(r.prev_price) || 0,
      entryQty: Number(r.entry_qty) || 0,
    });
  }

  for (const p of held) {
    let st = bySymbol.get(p.symbol);
    if (!st) {
      // First sight: record the baseline, take no observation — the first
      // OBSERVED move is the first step, same as the harness.
      st = freshState(p.symbol, p.price, p.qty);
    } else if (Math.abs(p.qty) > st.entryQty) {
      // Position was added to: the fraction's reference is the new high water.
      st = { ...st, entryQty: Math.abs(p.qty) };
    }
    const r = marketIsOpen && bySymbol.has(p.symbol) ? observeCycle(st, p.price, p.side) : reading(st);
    readings.set(p.symbol, r);
    await db.prepare(
      `INSERT INTO elle_conviction (symbol, z, step, atr, prev_price, entry_qty, kappa, status, target_fraction, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         z=excluded.z, step=excluded.step, atr=excluded.atr,
         prev_price=excluded.prev_price, entry_qty=excluded.entry_qty,
         kappa=excluded.kappa, status=excluded.status,
         target_fraction=excluded.target_fraction, updated_at=excluded.updated_at`,
    ).bind(
      r.state.symbol, r.state.z, r.state.step, r.state.atr, r.state.prevPrice,
      r.state.entryQty, r.kappa, r.status, r.targetFraction,
    ).run();
  }

  const heldSet = new Set(held.map(p => p.symbol));
  for (const symbol of bySymbol.keys()) {
    if (!heldSet.has(symbol)) {
      await db.prepare(`DELETE FROM elle_conviction WHERE symbol = ?`).bind(symbol).run().catch(() => {});
    }
  }

  return readings;
}
