// ============================================================
// ATLAS INGEST — src/atlas-ingest.ts
//
// The "90-second demo" data path: an operator signs in, grants access to (or
// exports from) their POS, and drops the CSVs here — POST /api/atlas/upload,
// venue-scoped to THEIR venue_id. Parsing is ephemeral: the raw CSV is
// normalized in memory and only the canonical rows land in rapid2ai-db
// (pos_daily_close / pos_item_sale), where the rapid_* dashboard tools see
// them immediately. Nothing else is retained.
//
// Deterministic first: headers are matched against the synonym tables below
// (Toast/Square/Clover-style export names). If a required column can't be
// found, the error NAMES the headers we saw and the ones we needed — loud
// and actionable, never a silent partial import. Re-uploads are idempotent:
// rows are replaced per (venue_id, reporting_date), scoped to this venue
// only, so a corrected export overwrites cleanly and can never touch
// another tenant's rows.
// ============================================================

export type IngestKind = 'pos_daily' | 'pos_items';

// ── CSV parsing (RFC-4180-ish: quotes, escaped quotes, CRLF) ─────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      // Only a quote that OPENS a field starts quoted mode (RFC 4180: a field
      // is either wholly quoted or wholly unquoted). A quote appearing after
      // other characters have already been written to this field — e.g. a
      // menu item like `12" Pizza` — is realistic restaurant data, not a
      // field delimiter; treating it as one used to desync the parser for
      // the rest of the file (every subsequent comma/newline read as literal
      // content until a later stray quote or EOF), silently merging or
      // dropping an unbounded number of rows with no error.
      inQuotes = true;
    }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

// ── field normalizers ────────────────────────────────────────────────────
// "$1,234.56" → 123456 · "(45.00)" → -4500 · "" → null
export function moneyToCents(v: string): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[$,()\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

// MM/DD/YYYY · M/D/YY · YYYY-MM-DD → ISO YYYY-MM-DD (rapid_* sorts on it).
// A month outside 1-12 or day outside 1-31 is rejected (not silently accepted
// into an invalid ISO string like "2026-13-02") — the caller counts this as a
// skipped row rather than writing a bogus reporting_date. This does not (and
// cannot, without an explicit format hint) resolve the inherent MM/DD-vs-DD/MM
// ambiguity when both components are <=12; it only closes the case that used
// to produce a string SQLite would happily store as-is.
function validDateParts(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function toIsoDate(v: string): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    if (!validDateParts(Number(m[2]), Number(m[3]))) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    if (!validDateParts(Number(m[1]), Number(m[2]))) return null;
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

// ── header mapping (Toast / Square / Clover export vocabulary) ──────────
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SYNONYMS: Record<string, string[]> = {
  date:     ['date', 'business date', 'business day', 'reporting date', 'day', 'order date', 'sales date', 'close date'],
  gross:    ['gross sales', 'gross amount', 'gross', 'total sales', 'sales', 'total collected'],
  net:      ['net sales', 'net amount', 'net', 'net total'],
  tax:      ['tax', 'taxes', 'tax amount', 'total tax', 'sales tax'],
  tips:     ['tips', 'tip', 'total tips', 'gratuity', 'tip amount'],
  txns:     ['transactions', 'transaction count', 'orders', 'order count', 'checks', 'check count', 'payments'],
  item:     ['item', 'item name', 'menu item', 'product', 'product name', 'name'],
  category: ['category', 'menu group', 'group', 'sales category', 'menu category'],
  qty:      ['qty', 'quantity', 'units', 'units sold', 'qty sold', 'item qty', 'count sold', 'sold'],
};

export function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const normed = headers.map(norm);
  for (const [field, names] of Object.entries(SYNONYMS)) {
    const idx = normed.findIndex(h => names.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

// An item column present means an item-level export; otherwise a daily close.
export function detectKind(headers: string[]): IngestKind {
  const m = mapHeaders(headers);
  return m.item != null ? 'pos_items' : 'pos_daily';
}

export interface DailyRow {
  reporting_date: string; gross_sales_cents: number; net_sales_cents: number;
  tax_cents: number; tips_cents: number; transaction_count: number;
}
export interface ItemRow {
  reporting_date: string; item_name: string; category: string | null;
  qty: number; gross_sales_cents: number;
}
export interface Normalized {
  kind: IngestKind;
  daily: DailyRow[];
  items: ItemRow[];
  skipped: number; // summary/total/blank-date rows dropped, reported not hidden
}

function requireCols(kind: IngestKind, headers: string[], m: Record<string, number>): void {
  const need = kind === 'pos_daily' ? ['date', 'gross'] : ['date', 'item', 'qty', 'gross'];
  const missing = need.filter(f => m[f] == null);
  if (missing.length) {
    throw new Error(
      `could not map required column(s) [${missing.join(', ')}] — headers seen: ` +
      `[${headers.join(' | ')}]. Export the standard ${kind === 'pos_daily' ? 'daily sales summary' : 'item sales'} ` +
      `CSV from the POS, or rename the columns to match (e.g. "Date", "Gross Sales"${kind === 'pos_items' ? ', "Item", "Qty"' : ''}).`
    );
  }
}

// A "Total" line in the date column is a summary row, not a day.
const isSummaryCell = (s: string) => /^(total|totals|grand total|summary)$/i.test(s.trim());

export function normalizeCsv(csvText: string, kindHint?: string): Normalized {
  const grid = parseCsv(csvText);
  if (grid.length < 2) throw new Error('CSV has no data rows (need a header row plus at least one row)');
  const headers = grid[0];
  const kind: IngestKind = kindHint === 'pos_daily' || kindHint === 'pos_items' ? kindHint : detectKind(headers);
  const m = mapHeaders(headers);
  requireCols(kind, headers, m);

  const daily: DailyRow[] = [], items: ItemRow[] = [];
  let skipped = 0;
  for (const row of grid.slice(1)) {
    const rawDate = row[m.date] ?? '';
    if (isSummaryCell(rawDate)) { skipped++; continue; }
    const date = toIsoDate(rawDate);
    if (!date) { skipped++; continue; }
    if (kind === 'pos_daily') {
      const gross = moneyToCents(row[m.gross] ?? '');
      if (gross == null) { skipped++; continue; }
      daily.push({
        reporting_date: date,
        gross_sales_cents: gross,
        net_sales_cents: (m.net != null ? moneyToCents(row[m.net] ?? '') : null) ?? gross,
        tax_cents: (m.tax != null ? moneyToCents(row[m.tax] ?? '') : null) ?? 0,
        tips_cents: (m.tips != null ? moneyToCents(row[m.tips] ?? '') : null) ?? 0,
        transaction_count: m.txns != null ? Math.round(Number(String(row[m.txns] ?? '').replace(/[,\s]/g, '')) || 0) : 0,
      });
    } else {
      const name = String(row[m.item] ?? '').trim();
      const gross = moneyToCents(row[m.gross] ?? '');
      const qty = Number(String(row[m.qty] ?? '').replace(/[,\s]/g, ''));
      if (!name || gross == null || !Number.isFinite(qty)) { skipped++; continue; }
      items.push({
        reporting_date: date,
        item_name: name.slice(0, 200),
        category: m.category != null ? (String(row[m.category] ?? '').trim().slice(0, 100) || null) : null,
        qty,
        gross_sales_cents: gross,
      });
    }
  }
  const rows = kind === 'pos_daily' ? daily.length : items.length;
  if (!rows) throw new Error(`no usable rows — ${skipped} row(s) skipped (unparseable dates/amounts or summary lines)`);
  // pos_daily_close is one row per (venue, reporting_date) — a second row for
  // the same date in one file is an exporter anomaly (a concatenated
  // multi-location export, a re-run total, a duplicated line), not a case
  // this ingest can safely guess how to combine. Fail loud and name the date,
  // matching this file's "never a silent partial import" design, rather than
  // silently summing (assuming the caller meant to combine two partial days)
  // or silently dropping one (assuming the other row is garbage).
  if (kind === 'pos_daily') {
    const seen = new Set<string>();
    for (const r of daily) {
      if (seen.has(r.reporting_date)) {
        throw new Error(`duplicate rows for ${r.reporting_date} — a daily-close export has one row per date; remove the duplicate and re-upload`);
      }
      seen.add(r.reporting_date);
    }
  }
  return { kind, daily, items, skipped };
}

// ── landing it in rapid2ai-db, venue-scoped and idempotent ──────────────
export interface IngestResult {
  kind: IngestKind; venue_id: string; rows: number; dates: string[]; skipped: number; replaced_dates: number;
}

export interface IngestEnv { RAPID_DB?: D1Database }

export async function ingestAtlasCsv(
  env: IngestEnv, venueId: string, csvText: string, kindHint?: string,
): Promise<IngestResult> {
  if (!env.RAPID_DB) throw new Error('RAPID_DB not configured');
  if (!venueId) throw new Error('venue required');
  const db = env.RAPID_DB;
  const n = normalizeCsv(csvText, kindHint);
  const dates = [...new Set((n.kind === 'pos_daily' ? n.daily : n.items).map(r => r.reporting_date))].sort();

  // Replace-by-day, scoped to THIS venue: a re-upload of a corrected export
  // overwrites its own days and can never touch another tenant's rows.
  const stmts: D1PreparedStatement[] = [];
  const table = n.kind === 'pos_daily' ? 'pos_daily_close' : 'pos_item_sale';
  for (const d of dates) {
    stmts.push(db.prepare(`DELETE FROM ${table} WHERE venue_id = ? AND reporting_date = ?`).bind(venueId, d));
  }
  // rapid2ai-db's convention throughout (see RAPIDAi's schema/migrations) is
  // an app-generated TEXT PRIMARY KEY plus NOT NULL created_at/updated_at with
  // no column default — pos_daily_close (and the new pos_item_sale) follow
  // that same convention, so both must be supplied here rather than omitted.
  const now = new Date().toISOString();
  if (n.kind === 'pos_daily') {
    for (const r of n.daily) {
      stmts.push(db.prepare(
        `INSERT INTO pos_daily_close (id, venue_id, reporting_date, gross_sales_cents, net_sales_cents, tax_cents, tips_cents, transaction_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), venueId, r.reporting_date, r.gross_sales_cents, r.net_sales_cents, r.tax_cents, r.tips_cents, r.transaction_count, now, now));
    }
  } else {
    for (const r of n.items) {
      stmts.push(db.prepare(
        `INSERT INTO pos_item_sale (id, venue_id, reporting_date, item_name, category, qty, gross_sales_cents, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), venueId, r.reporting_date, r.item_name, r.category, r.qty, r.gross_sales_cents, now));
    }
  }
  await db.batch(stmts);
  return {
    kind: n.kind, venue_id: venueId,
    rows: n.kind === 'pos_daily' ? n.daily.length : n.items.length,
    dates, skipped: n.skipped, replaced_dates: dates.length,
  };
}
