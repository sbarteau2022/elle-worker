// ============================================================
// PAYROLL ROUTER TOOLS — src/payroll/tools.ts
//
// Thin string-returning wrappers over sync.ts, mirroring tax.ts's pattern.
// v1 is read/sync only — there is no payroll_connect tool here on purpose:
// connecting requires an OAuth browser redirect (or, for ADP, at least a
// deliberate action), which doesn't fit the router's synchronous
// tool-call loop. Connecting happens through the workbench hitting
// /api/payroll/connect directly; Elle can check status, trigger a sync,
// and read what's already connected.
// ============================================================

import type { Env } from '../index';
import { listConnections, syncConnection, getWageSummaryCents } from './sync';

export async function payrollConnectionStatus(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'payroll_connection_status: business_id required';
  const connections = await listConnections(env, businessId);
  if (!connections.length) return '(no payroll provider connected for this business — connect one from the workbench)';
  return connections.map((c) => `${c.provider}: ${c.status}${c.last_synced_at ? `, last synced ${new Date(c.last_synced_at).toISOString()}` : ', never synced'}${c.last_sync_error ? ` — error: ${c.last_sync_error}` : ''}`).join('\n');
}

export async function payrollSync(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  const provider = String(a.provider || '');
  if (!businessId || !provider) return 'payroll_sync: business_id and provider required';
  const out = await syncConnection(env, businessId, provider);
  return out.note;
}

export async function payrollWageSummary(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'payroll_wage_summary: business_id required';
  const taxYear = Number(a.tax_year) || new Date().getUTCFullYear();
  const summary = await getWageSummaryCents(env, businessId, taxYear);
  if (!summary.hasData) return `No synced payroll wage data for ${taxYear} — connect and sync a payroll provider first (payroll_connection_status / payroll_sync).`;
  return `${taxYear} total wages paid (all connected providers: ${summary.connectedProviders.join(', ')}): $${(summary.totalWagesCents / 100).toFixed(2)}. Assumes all synced wages were earned within this business's registered locality — a multi-location business needs real per-location attribution for full precision.`;
}
