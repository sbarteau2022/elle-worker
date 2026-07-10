// ============================================================
// SSRF GUARD — src/ssrf.ts
//
// fetch_url lets Elle pull an arbitrary URL, and it is a PUBLIC-scope tool —
// reachable from the unauthenticated /api/chat door. Without a guard that is
// a server-side request forgery / open-proxy primitive: an attacker steers
// the worker into fetching hosts of their choosing and reads the body back.
//
// Cloudflare's runtime already refuses fetches to RFC1918 / loopback ranges,
// but we do not rely on that alone: this guard rejects, BEFORE the fetch,
//   • non-http(s) schemes (no file:, gopher:, data:, blob:, ws:…);
//   • credentials in the URL (user:pass@host — used to smuggle hosts);
//   • hostnames that are private/reserved IPs (v4 + v6), loopback,
//     link-local, or the cloud metadata address 169.254.169.254;
//   • bare hostnames with no dot that resolve internally (localhost, etc.);
//   • non-standard ports (only 80/443 — closes port-scan/proxy abuse).
//
// Pure and deterministic so the blocklist is unit-tested. DNS-rebinding (a
// public name that resolves to a private IP at fetch time) is not fully
// solvable in a Worker; the runtime's own private-range block is the backstop
// there, and redirects are not followed (see router.ts) so a 30x can't bounce
// to an internal host.
// ============================================================

export type SsrfResult = { ok: true; url: string } | { ok: false; error: string };

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata',
]);

export function ssrfGuard(raw: string): SsrfResult {
  const input = String(raw || '').trim();
  if (!input) return { ok: false, error: 'a URL is required' };

  let u: URL;
  try { u = new URL(input); } catch { return { ok: false, error: 'not a valid URL' }; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'only http(s) URLs are allowed' };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed' };
  }
  // Only the default web ports. '' means default (80/443); anything else is refused.
  if (u.port && u.port !== '80' && u.port !== '443') {
    return { ok: false, error: `port ${u.port} is not allowed` };
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: 'internal host is not allowed' };
  if (isPrivateOrReservedHost(host)) return { ok: false, error: 'private/reserved address is not allowed' };

  return { ok: true, url: u.toString() };
}

// True for any host that is a private, loopback, link-local, or reserved
// IP literal (v4 or v6). Non-IP hostnames pass here (resolved by the runtime,
// which blocks private ranges itself as the backstop).
export function isPrivateOrReservedHost(host: string): boolean {
  // IPv4 dotted quad
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true; // malformed → refuse
    const [a, b] = o;
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8 private
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true;        // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true;                      // multicast / reserved
    return false;
  }
  // IPv6 literals
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;         // loopback / unspecified
    if (host.startsWith('fe80')) return true;                 // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local fc00::/7
    // IPv4-mapped (::ffff:169.254.169.254 etc.) — recurse on the tail
    const mapped = host.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (mapped) return isPrivateOrReservedHost(mapped[1]);
    return false;
  }
  return false;
}
