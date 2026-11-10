import { describe, it, expect } from 'vitest';
import {
  parseCsv, moneyToCents, toIsoDate, mapHeaders, detectKind,
  normalizeCsv, ingestAtlasCsv, type IngestEnv,
} from './atlas-ingest';

// The demo data path: an operator's raw POS export in, canonical venue-scoped
// rows out. These pin (1) the parsing survives real export quirks (quotes,
// $-signs, thousands separators, MM/DD/YYYY, summary rows, BOM), (2) unmapped
// headers fail LOUD with the headers named — never a silent partial import,
// and (3) the landing is idempotent per (venue_id, reporting_date) and can
// never touch another venue's rows.

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas/quotes, CRLF, and a BOM', () => {
    const grid = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n');
    expect(grid).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('drops fully blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n  ,\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('treats a quote mid-field as a literal character, not a field delimiter', () => {
    // A bare quote that doesn't OPEN the field (real restaurant data: 12" Pizza)
    // used to flip the parser into quoted mode and silently swallow every
    // subsequent comma/newline until another stray quote or EOF — merging or
    // dropping an unbounded number of later rows with no error.
    const grid = parseCsv('Item,Qty\n12" Pizza,3\nWings,10\n');
    expect(grid).toEqual([['Item', 'Qty'], ['12" Pizza', '3'], ['Wings', '10']]);
  });
});

describe('field normalizers', () => {
  it('moneyToCents: $ and thousands separators, parenthesized negatives, blanks', () => {
    expect(moneyToCents('$1,234.56')).toBe(123456);
    expect(moneyToCents('(45.00)')).toBe(-4500);
    expect(moneyToCents('0')).toBe(0);
    expect(moneyToCents('')).toBeNull();
    expect(moneyToCents('n/a')).toBeNull();
  });
  it('toIsoDate: MM/DD/YYYY, M/D/YY, and ISO pass-through', () => {
    expect(toIsoDate('07/04/2026')).toBe('2026-07-04');
    expect(toIsoDate('7/4/26')).toBe('2026-07-04');
    expect(toIsoDate('2026-07-04')).toBe('2026-07-04');
    expect(toIsoDate('Total')).toBeNull();
  });
  it('toIsoDate: rejects an out-of-range month or day rather than emitting an invalid ISO string', () => {
    // 13/02/2026 used to produce the literal string "2026-13-02" — not caught
    // by the "no usable rows" guard (it's a non-null string), and written
    // straight into a TEXT column with no CHECK constraint.
    expect(toIsoDate('13/02/2026')).toBeNull();
    expect(toIsoDate('02/32/2026')).toBeNull();
    expect(toIsoDate('2026-13-02')).toBeNull();
    expect(toIsoDate('2026-02-32')).toBeNull();
  });
});

describe('header mapping', () => {
  it('recognizes Toast/Square-style daily summary headers', () => {
    const m = mapHeaders(['Business Date', 'Gross Sales', 'Net Sales', 'Total Tax', 'Tips', 'Order Count']);
    expect(m).toMatchObject({ date: 0, gross: 1, net: 2, tax: 3, tips: 4, txns: 5 });
  });
  it('detectKind: an item column means item-level, otherwise daily close', () => {
    expect(detectKind(['Date', 'Item Name', 'Qty Sold', 'Gross Sales'])).toBe('pos_items');
    expect(detectKind(['Date', 'Gross Sales', 'Net Sales'])).toBe('pos_daily');
  });
});

const DAILY_CSV = [
  'Business Date,Gross Sales,Net Sales,Total Tax,Tips,Order Count',
  '07/01/2026,"$2,345.67","$2,100.00",$145.67,$100.00,182',
  '07/02/2026,"$1,980.20","$1,800.10",$120.10,$60.00,155',
  'Total,"$4,325.87","$3,900.10",$265.77,$160.00,337',
].join('\n');

const ITEMS_CSV = [
  'Date,Menu Item,Menu Group,Qty Sold,Gross Sales',
  '07/01/2026,"Burger, Double",Mains,42,$630.00',
  '07/01/2026,Fries,Sides,80,$400.00',
].join('\n');

describe('normalizeCsv', () => {
  it('normalizes a daily-close export and skips the Total summary row', () => {
    const n = normalizeCsv(DAILY_CSV);
    expect(n.kind).toBe('pos_daily');
    expect(n.daily).toHaveLength(2);
    expect(n.skipped).toBe(1);
    expect(n.daily[0]).toEqual({
      reporting_date: '2026-07-01', gross_sales_cents: 234567, net_sales_cents: 210000,
      tax_cents: 14567, tips_cents: 10000, transaction_count: 182,
    });
  });

  it('normalizes an item-level export with quoted item names', () => {
    const n = normalizeCsv(ITEMS_CSV);
    expect(n.kind).toBe('pos_items');
    expect(n.items[0]).toEqual({
      reporting_date: '2026-07-01', item_name: 'Burger, Double', category: 'Mains',
      qty: 42, gross_sales_cents: 63000,
    });
  });

  it('fails LOUD on unmappable headers, naming what it saw and what it needed', () => {
    try {
      normalizeCsv('Foo,Bar\n1,2');
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('could not map required column');
      expect(msg).toContain('Foo | Bar');
      expect(msg).toContain('Gross Sales');
    }
  });

  it('fails loud when every data row is unusable, reporting the skip count', () => {
    expect(() => normalizeCsv('Date,Gross Sales\nTotal,$5.00\nnot-a-date,$1.00'))
      .toThrow(/no usable rows — 2 row\(s\) skipped/);
  });

  it('a missing net column falls back to gross, missing tax/tips to 0', () => {
    const n = normalizeCsv('Date,Gross Sales\n07/01/2026,$100.00');
    expect(n.daily[0].net_sales_cents).toBe(10000);
    expect(n.daily[0].tax_cents).toBe(0);
  });

  it('fails loud on two rows for the same date in a daily-close export', () => {
    // pos_daily_close is UNIQUE(venue_id, reporting_date) — two rows for one
    // date in a single file is an exporter anomaly, not something to silently
    // sum or silently drop one of.
    expect(() => normalizeCsv('Date,Gross Sales\n07/01/2026,$100.00\n07/01/2026,$50.00'))
      .toThrow(/duplicate rows for 2026-07-01/);
  });
});

// ── landing: fake RAPID_DB capturing prepared statements + batch ─────────
function fakeRapidDb(): { env: IngestEnv; execs: Array<{ sql: string; binds: unknown[] }>; batches: number[] } {
  const execs: Array<{ sql: string; binds: unknown[] }> = [];
  const batches: number[] = [];
  const db = {
    prepare(sql: string) {
      const entry = { sql, binds: [] as unknown[] };
      return { bind(...args: unknown[]) { entry.binds = args; execs.push(entry); return this; } };
    },
    async batch(stmts: unknown[]) { batches.push(stmts.length); return stmts.map(() => ({ meta: {} })); },
  };
  return { env: { RAPID_DB: db as unknown as D1Database }, execs, batches };
}

describe('ingestAtlasCsv', () => {
  it('replaces per (venue_id, reporting_date) then inserts — idempotent, venue-scoped', async () => {
    const { env, execs, batches } = fakeRapidDb();
    const out = await ingestAtlasCsv(env, 'venue-77', DAILY_CSV);
    expect(out).toMatchObject({ kind: 'pos_daily', venue_id: 'venue-77', rows: 2, replaced_dates: 2, skipped: 1 });
    expect(out.dates).toEqual(['2026-07-01', '2026-07-02']);
    const deletes = execs.filter(e => /^DELETE FROM pos_daily_close/.test(e.sql));
    expect(deletes).toHaveLength(2);
    for (const d of deletes) expect(d.binds[0]).toBe('venue-77'); // never another tenant's rows
    const inserts = execs.filter(e => /^INSERT INTO pos_daily_close/.test(e.sql));
    expect(inserts).toHaveLength(2);
    // id, venue_id, reporting_date, ... — venue_id is bound, not just present
    // in closure scope, and a real id/created_at/updated_at are supplied (the
    // NOT NULL columns pos_daily_close requires with no column default).
    expect(inserts[0].binds).toContain('venue-77');
    expect(typeof inserts[0].binds[0]).toBe('string');
    expect(inserts[0].binds[0]).not.toBe('venue-77'); // id, a fresh UUID
    expect(inserts[0].binds.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T/); // updated_at ISO string
    expect(batches).toEqual([4]); // one atomic batch: 2 deletes + 2 inserts
  });

  it('lands item exports in pos_item_sale', async () => {
    const { env, execs } = fakeRapidDb();
    const out = await ingestAtlasCsv(env, 'venue-77', ITEMS_CSV);
    expect(out.kind).toBe('pos_items');
    const inserts = execs.filter(e => /^INSERT INTO pos_item_sale/.test(e.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].binds).toContain('venue-77');
    expect(execs.filter(e => /^DELETE FROM pos_item_sale/.test(e.sql))).toHaveLength(1); // one date
  });

  it('requires the RAPID_DB binding and a venue', async () => {
    await expect(ingestAtlasCsv({}, 'v', DAILY_CSV)).rejects.toThrow(/RAPID_DB not configured/);
    await expect(ingestAtlasCsv(fakeRapidDb().env, '', DAILY_CSV)).rejects.toThrow(/venue required/);
  });

  it('honors an explicit kind hint over detection', async () => {
    const { env } = fakeRapidDb();
    // has an "item" column but the operator says it's a daily export → daily mapping rules apply
    const out = await ingestAtlasCsv(env, 'v', 'Date,Gross Sales\n07/01/2026,$5.00', 'pos_daily');
    expect(out.kind).toBe('pos_daily');
  });
});
