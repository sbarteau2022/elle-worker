// ============================================================
// ELLE — native RAPID²AI hospitality tools · src/rapid.ts
//
// Ported directly from the deployed rapid2ai-ai-worker (pulled via the
// Cloudflare API — there is no source repo in reach). The router's old
// HOSPITALITY_CATALOG documented ~20 tool names (reconcile, get_financials,
// profit_and_loss, period_compare, sales_summary, sales_trend, top_purchases,
// spend_by_category, vendor_spend, fee_burden, credit_recovery, ap_aging,
// price_variance, price_movers, price_history, product_cost, invoice_detail,
// top_menu_items, menu_engineering, suggested_pars, run_sql) behind a
// generic rapid_data(tool, args) dispatcher that proxied to a `/tool` HTTP
// endpoint. That endpoint was never built — every one of those calls 404'd
// and silently degraded to a plain-English /query fallback (see the old
// router.ts comment "/tool not deployed on the worker yet"). Elle was never
// actually able to run any of that catalog; she was faking precision.
//
// What's REAL on the deployed worker is four SQL context-fetchers plus one
// LLM report generator (POST /query). Those four are ported here verbatim
// (same tables, same TRUE_UNIT_PRICE_SQL catch-weight logic) and run
// directly against a native D1 binding (RAPID_DB → rapid2ai-db) — no HTTP
// hop, no service-binding indirection, no silent 404 fallback.
//
// NOT ported: the deployed worker's Vectorize-backed semantic product/menu
// matching (getSemanticContext). Its index name isn't visible from the
// bundled worker code and there's no source repo in reach to confirm it —
// wiring it blind risks binding the wrong index. The four SQL tools below
// cover recent costs, price variance, POS sales, and menu performance,
// which is the bulk of what /query actually returns.
// ============================================================

import type { Env } from './index';

export interface RapidEnv extends Env {
  RAPID_DB?: D1Database;
  VENUE_ID?: string;
}

function requireDB(env: RapidEnv): D1Database {
  if (!env.RAPID_DB) throw new Error('RAPID_DB not configured — bind it in wrangler.toml ([[d1_databases]] pointing at rapid2ai-db) and redeploy');
  return env.RAPID_DB;
}

function requireVenue(env: RapidEnv): string {
  const v = env.VENUE_ID;
  if (!v) throw new Error('VENUE_ID not configured — set it in wrangler.toml [vars] to the venue UUID in rapid2ai-db');
  return v;
}

// Catch-weight-aware true unit price: extended price / weight for catch-weight
// lines, extended price / qty shipped otherwise. Mirrors the deployed worker.
const TRUE_UNIT_PRICE_SQL = `
  CASE
    WHEN vdl.is_catch_weight = 1 AND vdl.weight_lb > 0
      THEN vdl.extended_price_cents / 100.0 / vdl.weight_lb
    WHEN vdl.qty_shipped > 0
      THEN vdl.extended_price_cents / 100.0 / vdl.qty_shipped
    ELSE NULL
  END`;

interface CostRow {
  product_description: string;
  pricing_unit: string | null;
  is_catch_weight: number;
  true_unit_price: number | null;
  extended_price_cents: number;
  document_date: string;
  document_number: string;
}

function unitLabel(row: { is_catch_weight: number; pricing_unit: string | null }): string {
  if (row.is_catch_weight === 1) return '/lb';
  const u = (row.pricing_unit || 'unit').toUpperCase();
  return `/${u}`;
}

function fmtPrice(v: number | null): string {
  return v == null ? 'n/a' : `$${v.toFixed(4)}`;
}

// ── recent invoice lines (US Foods), last 100 by date ──────────
export async function rapidCosts(env: RapidEnv): Promise<string> {
  const venueId = requireVenue(env);
  const db = requireDB(env);
  const rows = await db.prepare(`
    SELECT vdl.product_description, vdl.pricing_unit, vdl.is_catch_weight,
           vdl.weight_lb, vdl.qty_shipped, vdl.extended_price_cents,
           ${TRUE_UNIT_PRICE_SQL} AS true_unit_price,
           vd.document_date, vd.document_number, vd.document_type
    FROM vendor_document_line vdl
    JOIN vendor_document vd ON vd.id = vdl.vendor_document_id
    JOIN vendor_document_payload vdp ON vdp.id = vd.payload_id
    WHERE vdp.venue_id = ?
      AND vd.document_type IN ('INVOICE','VEND_SHIP')
      AND vdl.qty_shipped > 0
    ORDER BY vd.document_date DESC
    LIMIT 100
  `).bind(venueId).all<CostRow>();
  if (!rows.results?.length) return 'No recent invoice data available.';
  const lines = rows.results.map(r =>
    `${r.document_date} | ${r.document_number} | ${r.product_description} | ${fmtPrice(r.true_unit_price)}${unitLabel(r)} | $${(r.extended_price_cents / 100).toFixed(2)} ext`
  );
  return 'Recent invoice lines (price normalized per selling unit; /lb = catch-weight):\n' + lines.join('\n');
}

interface VarianceRow {
  product_number: string;
  product_description: string;
  is_catch_weight: number;
  pricing_unit: string | null;
  avg_price: number;
  min_price: number;
  max_price: number;
  occurrences: number;
}

// ── 90-day price variance by SKU (2+ deliveries) ────────────────
export async function rapidVariance(env: RapidEnv): Promise<string> {
  const venueId = requireVenue(env);
  const db = requireDB(env);
  const rows = await db.prepare(`
    SELECT vdl.product_number, vdl.product_description,
           MAX(vdl.is_catch_weight) AS is_catch_weight,
           vdl.pricing_unit AS pricing_unit,
           AVG(${TRUE_UNIT_PRICE_SQL}) AS avg_price,
           MIN(${TRUE_UNIT_PRICE_SQL}) AS min_price,
           MAX(${TRUE_UNIT_PRICE_SQL}) AS max_price,
           COUNT(*) AS occurrences
    FROM vendor_document_line vdl
    JOIN vendor_document vd ON vd.id = vdl.vendor_document_id
    JOIN vendor_document_payload vdp ON vdp.id = vd.payload_id
    WHERE vdp.venue_id = ?
      AND vd.document_date >= date('now', '-90 days')
      AND vdl.qty_shipped > 0
    GROUP BY vdl.product_number, vdl.product_description, vdl.pricing_unit
    HAVING occurrences >= 2 AND min_price > 0
    ORDER BY (max_price - min_price) / min_price DESC
    LIMIT 20
  `).bind(venueId).all<VarianceRow>();
  if (!rows.results?.length) return 'No variance data available (need 2+ deliveries per SKU in the last 90 days).';
  const lines = rows.results.map(r => {
    const u = unitLabel(r);
    const swing = ((r.max_price - r.min_price) / r.min_price * 100).toFixed(1);
    return `${r.product_description}: avg $${r.avg_price.toFixed(4)}${u}, range $${r.min_price.toFixed(4)}–$${r.max_price.toFixed(4)}${u} (+${swing}% swing, ${r.occurrences} deliveries)`;
  });
  return '90-day price variance by SKU:\n' + lines.join('\n');
}

interface POSRow {
  reporting_date: string;
  gross_sales_cents: number;
  net_sales_cents: number;
  tax_cents: number;
  tips_cents: number;
  transaction_count: number;
}

// ── last 14 days POS daily close ─────────────────────────────────
export async function rapidPOS(env: RapidEnv): Promise<string> {
  const venueId = requireVenue(env);
  const db = requireDB(env);
  const rows = await db.prepare(`
    SELECT reporting_date, gross_sales_cents, net_sales_cents, tax_cents,
           tips_cents, transaction_count
    FROM pos_daily_close
    WHERE venue_id = ?
    ORDER BY reporting_date DESC
    LIMIT 14
  `).bind(venueId).all<POSRow>();
  if (!rows.results?.length) return 'No POS daily close data available.';
  const lines = rows.results.map(r =>
    `${r.reporting_date}: gross $${(r.gross_sales_cents / 100).toFixed(2)}, net $${(r.net_sales_cents / 100).toFixed(2)}, tax $${(r.tax_cents / 100).toFixed(2)}, tips $${(r.tips_cents / 100).toFixed(2)}, ${r.transaction_count} txns`
  );
  return 'Last 14 days POS summary:\n' + lines.join('\n');
}

interface MenuRow {
  item_name: string;
  category: string | null;
  units_sold: number;
  gross_dollars: number;
  days_sold: number;
}

// ── last 30 days menu performance, top 25 by revenue ────────────
export async function rapidMenu(env: RapidEnv): Promise<string> {
  const venueId = requireVenue(env);
  const db = requireDB(env);
  const rows = await db.prepare(`
    SELECT item_name, category,
           SUM(qty) as units_sold,
           ROUND(SUM(gross_sales_cents)/100.0, 2) as gross_dollars,
           COUNT(DISTINCT reporting_date) as days_sold
    FROM pos_item_sale
    WHERE venue_id = ?
      AND reporting_date >= date('now', '-30 days')
    GROUP BY item_name, category
    ORDER BY gross_dollars DESC
    LIMIT 25
  `).bind(venueId).all<MenuRow>();
  if (!rows.results?.length) return 'No menu sales data available.';
  const lines = rows.results.map(r =>
    `${r.item_name} (${r.category || 'uncategorized'}): ${r.units_sold} units, $${r.gross_dollars} gross, ${r.days_sold} days`
  );
  return 'Last 30-day menu performance (top 25 by revenue):\n' + lines.join('\n');
}

// ── /query equivalent: keyword-routed context + one LLM report call ──
// Mirrors the deployed worker's handleQuery: pick relevant context blocks by
// keyword, hand them to the model, return the same {intro, blocks} contract
// so a frontend built against the original /query response shape still
// parses this unchanged if repointed here.
export interface RapidBlock { type: string; [k: string]: unknown }
export interface RapidReportResult { intro: string; blocks: RapidBlock[]; context_used: boolean }

const RAPID_SYSTEM_PROMPT = `You are RAPID²AI, an operational intelligence assistant for a restaurant. You help the operator understand food costs, vendor pricing, invoice verification, menu performance, and sales data.

RESPONSE FORMAT — you must always return a valid JSON object. No markdown, no preamble, no explanation outside the JSON.

Return this structure:
{
  "intro": "One sentence summary. Use **bold** for key figures.",
  "blocks": [
    { "type": "prose", "body": "..." },
    { "type": "kpi", "items": [ { "label": "Food Cost %", "value": "28.4%", "gold": false, "delta": { "text": "▲ 1.2 pts WoW", "direction": "up" } } ] },
    { "type": "table", "title": "...", "columns": [ { "key": "product", "label": "Product" }, { "key": "current", "label": "Current", "align": "right", "format": "currency" } ], "rows": [ { "product": "Chicken Breast 40lb", "current": 71.20 } ] }
  ]
}

Rules:
- Answer only about this venue's data. Never speculate about other venues.
- Use numbers from the context. Be specific — name SKUs, magnitudes, dates.
- For cost metrics: up = bad (red), down = good (green).
- Keep intro to one sentence. Depth goes in the blocks.
- If data is insufficient for a block, omit that block. Never fabricate numbers.
- Always return valid JSON.`;

export async function rapidReport(question: string, env: RapidEnv): Promise<RapidReportResult> {
  const q = question.toLowerCase();
  const needsCosts = q.includes('cost') || q.includes('invoice') || q.includes('price') || q.includes('paid') || (!q.includes('sales') && !q.includes('menu'));
  const needsVariance = q.includes('variance') || q.includes('change') || q.includes('increase') || q.includes('trend') || q.includes('mover');
  const needsPOS = q.includes('sales') || q.includes('revenue') || q.includes('transaction') || q.includes('tips');
  const needsMenu = q.includes('menu') || q.includes('dish') || q.includes('seller') || q.includes('selling') || q.includes('popular') || q.includes('item') || q.includes('food cost');

  const contextParts: string[] = [];
  if (needsCosts) contextParts.push(await rapidCosts(env));
  if (needsVariance) contextParts.push(await rapidVariance(env));
  if (needsPOS) contextParts.push(await rapidPOS(env));
  if (needsMenu) contextParts.push(await rapidMenu(env));

  const contextBlock = contextParts.join('\n\n---\n\n') || 'No relevant data found for this query.';
  const messages = [
    { role: 'system', content: RAPID_SYSTEM_PROMPT },
    { role: 'user', content: `Context from the venue's operational data:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}` },
  ];

  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages, max_tokens: 1500 }) as { response?: string };
  const raw = (response.response ?? '').trim();
  try {
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean) as { intro?: string; blocks?: RapidBlock[] };
    return {
      intro: parsed.intro ?? '',
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [{ type: 'prose', body: raw }],
      context_used: contextParts.length > 0,
    };
  } catch {
    return { intro: '', blocks: [{ type: 'prose', body: raw }], context_used: contextParts.length > 0 };
  }
}

// Flatten {intro, blocks} into plain text — router tool observations are fed
// back to Elle's OWN reasoning model as a string, not rendered as UI, so the
// block structure needs to read as prose rather than be handed back as raw JSON.
export function flattenRapidReport(r: RapidReportResult): string {
  const parts: string[] = [];
  if (r.intro) parts.push(r.intro);
  for (const b of r.blocks) {
    if (b.type === 'prose' && typeof b.body === 'string') parts.push(b.body);
    else if (b.type === 'kpi' && Array.isArray(b.items)) {
      parts.push((b.items as Array<{ label: string; value: string; delta?: { text: string } }>)
        .map(i => `${i.label}: ${i.value}${i.delta ? ` (${i.delta.text})` : ''}`).join(' · '));
    } else if (b.type === 'table' && Array.isArray(b.rows)) {
      const title = typeof b.title === 'string' ? b.title + ':\n' : '';
      parts.push(title + JSON.stringify(b.rows).slice(0, 2000));
    } else {
      parts.push(JSON.stringify(b).slice(0, 1000));
    }
  }
  return parts.join('\n\n') || '(no data)';
}
