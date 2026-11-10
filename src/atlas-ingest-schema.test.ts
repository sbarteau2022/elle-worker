import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ingestAtlasCsv, type IngestEnv } from './atlas-ingest';

// ingestAtlasCsv's write path used to omit columns rapid2ai-db's real schema
// requires (pos_daily_close.id/created_at/updated_at are NOT NULL with no
// column default) and wrote to a table, pos_item_sale, that did not exist in
// any RAPIDAi migration at all. The fake stub in atlas-ingest.test.ts only
// records SQL text + bound params — it never executes against a schema, so
// neither bug ever surfaced there. This file runs the same code against a
// REAL SQLite engine with the actual column set (mirroring
// RAPIDAi's schema/migrations/002_tin_mill_module.sql pos_daily_close and the
// new schema/migrations/007_pos_item_sale.sql pos_item_sale, kept in sync by
// hand — if either migration's column list changes, update the DDL below).
//
// Foreign keys are deliberately left OFF: this table's venue_id/entity
// provisioning for self-serve signups is a separate, already-flagged gap
// (createClientProfile never inserts into RAPIDAi's venue/entity tables) —
// out of scope here, which is only about pos_daily_close / pos_item_sale's
// own column requirements.

const POS_DAILY_CLOSE_DDL = `
  CREATE TABLE pos_daily_close (
    id                     TEXT PRIMARY KEY,
    venue_id               TEXT NOT NULL,
    reporting_date         TEXT NOT NULL,
    gross_sales_cents      INTEGER NOT NULL DEFAULT 0,
    discounts_cents        INTEGER NOT NULL DEFAULT 0,
    net_sales_cents        INTEGER NOT NULL DEFAULT 0,
    tax_cents              INTEGER NOT NULL DEFAULT 0,
    tips_cents             INTEGER NOT NULL DEFAULT 0,
    service_charges_cents  INTEGER NOT NULL DEFAULT 0,
    refunds_cents          INTEGER NOT NULL DEFAULT 0,
    transaction_count      INTEGER NOT NULL DEFAULT 0,
    cover_count            INTEGER NOT NULL DEFAULT 0,
    closed_at              TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    UNIQUE(venue_id, reporting_date)
  );
`;

const POS_ITEM_SALE_DDL = `
  CREATE TABLE pos_item_sale (
    id                TEXT PRIMARY KEY,
    venue_id          TEXT NOT NULL,
    reporting_date    TEXT NOT NULL,
    item_name         TEXT NOT NULL,
    category          TEXT,
    qty               REAL NOT NULL,
    gross_sales_cents INTEGER NOT NULL,
    created_at        TEXT NOT NULL
  );
`;

// Minimal D1-shaped shim over node:sqlite: prepare().bind() returns a handle
// batch() executes atomically, matching how ingestAtlasCsv uses D1Database.
function d1Shim(db: DatabaseSync): IngestEnv['RAPID_DB'] {
  function prepare(sql: string) {
    let args: unknown[] = [];
    return {
      bind(...a: unknown[]) { args = a; return this; },
      _run: () => db.prepare(sql).run(...(args as never[])),
    };
  }
  return {
    prepare,
    async batch(stmts: Array<{ _run: () => unknown }>) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as IngestEnv['RAPID_DB'];
}

const DAILY_CSV = [
  'Business Date,Gross Sales,Net Sales,Total Tax,Tips,Order Count',
  '07/01/2026,"$2,345.67","$2,100.00",$145.67,$100.00,182',
  '07/02/2026,"$1,980.20","$1,800.10",$120.10,$60.00,155',
].join('\n');

const ITEMS_CSV = [
  'Date,Menu Item,Menu Group,Qty Sold,Gross Sales',
  '07/01/2026,"Burger, Double",Mains,42,$630.00',
  '07/01/2026,Fries,Sides,80,$400.00',
].join('\n');

describe('ingestAtlasCsv against the real pos_daily_close / pos_item_sale schema', () => {
  let db: DatabaseSync;
  let env: IngestEnv;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(POS_DAILY_CLOSE_DDL);
    db.exec(POS_ITEM_SALE_DDL);
    env = { RAPID_DB: d1Shim(db) };
  });

  it('writes a daily-close upload without violating any NOT NULL column', async () => {
    const out = await ingestAtlasCsv(env, 'venue-77', DAILY_CSV);
    expect(out.rows).toBe(2);
    const rows = db.prepare('SELECT * FROM pos_daily_close ORDER BY reporting_date').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].created_at).toBeTruthy();
    expect(rows[0].updated_at).toBeTruthy();
    expect(rows[0].venue_id).toBe('venue-77');
    expect(rows[0].gross_sales_cents).toBe(234567);
  });

  it('writes an item-level upload into pos_item_sale', async () => {
    const out = await ingestAtlasCsv(env, 'venue-77', ITEMS_CSV);
    expect(out.rows).toBe(2);
    const rows = db.prepare('SELECT * FROM pos_item_sale ORDER BY item_name').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].created_at).toBeTruthy();
    expect(rows.map((r) => r.item_name)).toEqual(['Burger, Double', 'Fries']);
  });

  it('a re-upload replaces the same dates rather than duplicating them (idempotent, real UNIQUE constraint)', async () => {
    await ingestAtlasCsv(env, 'venue-77', DAILY_CSV);
    const out2 = await ingestAtlasCsv(env, 'venue-77', DAILY_CSV);
    expect(out2.rows).toBe(2);
    const rows = db.prepare('SELECT * FROM pos_daily_close').all() as unknown[];
    expect(rows).toHaveLength(2); // not 4 — the delete-then-insert replace worked
  });

  it('never writes another venue\'s rows on a scoped re-upload', async () => {
    await ingestAtlasCsv(env, 'venue-A', DAILY_CSV);
    await ingestAtlasCsv(env, 'venue-B', 'Date,Gross Sales\n07/01/2026,$50.00');
    const rows = db.prepare('SELECT venue_id, reporting_date FROM pos_daily_close ORDER BY venue_id').all() as Array<{ venue_id: string }>;
    expect(rows.filter((r) => r.venue_id === 'venue-A')).toHaveLength(2);
    expect(rows.filter((r) => r.venue_id === 'venue-B')).toHaveLength(1);
  });
});
