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
//     link-local, or the cloud metadata address 169.254.169.254 — including
//     decimal/hex/octal/shortened IPv4 encodings (2130706433, 0x7f000001,
//     0177.0.0.1, 127.1) that fetch would resolve to the same address;
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
//
// IPv4 is matched through a WHATWG-style parser, not a dotted-quad regex,
// because fetch treats ANY host whose last label is numeric as an IPv4
// address: decimal (2130706433), hex (0x7f000001), octal (0177.0.0.1), and
// shortened (127.1) encodings all reach 127.0.0.1. Spec-compliant URL
// implementations canonicalize these before we see them, but this guard is
// pure and exported — it must hold on the raw encoding too. A host that
// looks numeric but doesn't parse as IPv4 is refused outright.
export function isPrivateOrReservedHost(host: string): boolean {
  if (looksIpv4Numeric(host)) {
    const addr = parseIpv4(host);
    if (addr === null) return true;                 // numeric-looking but malformed → refuse
    const a = addr >>> 24, b = (addr >>> 16) & 255;
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

// The WHATWG URL spec routes a host into its IPv4 parser when the last
// dot-separated label is numeric (decimal, 0x-hex, or 0-octal). Same trigger
// here — everything else is an ordinary DNS hostname.
function looksIpv4Numeric(host: string): boolean {
  const h = host.endsWith('.') ? host.slice(0, -1) : host; // one trailing dot is legal
  const last = h.split('.').pop() || '';
  return /^(0x[0-9a-f]*|[0-9]+)$/i.test(last);
}

// WHATWG-style IPv4 parse: up to 4 numeric parts, each decimal / 0x-hex /
// 0-octal; the LAST part fills all remaining bytes (so "127.1" = 127.0.0.1
// and "2130706433" is the whole address). Returns the 32-bit address, or
// null when the host is numeric-shaped but not a valid IPv4 encoding.
function parseIpv4(host: string): number | null {
  const h = host.endsWith('.') ? host.slice(0, -1) : host;
  const parts = h.split('.');
  if (!parts.length || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = parseIpv4Part(p);
    if (n === null) return null;
    nums.push(n);
  }
  const rest = 4 - (nums.length - 1);
  for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 255) return null;
  if (nums[nums.length - 1] >= 256 ** rest) return null;
  let addr = 0;
  for (let i = 0; i < nums.length - 1; i++) addr = addr * 256 + nums[i];
  return (addr * 256 ** rest + nums[nums.length - 1]) >>> 0;
}

function parseIpv4Part(p: string): number | null {
  if (/^0x[0-9a-f]*$/i.test(p)) return p.length === 2 ? 0 : parseInt(p.slice(2), 16); // bare "0x" is 0 per spec
  if (p.length > 1 && p[0] === '0') return /^[0-7]+$/.test(p) ? parseInt(p, 8) : null; // octal; "08" is malformed
  return /^[0-9]+$/.test(p) ? parseInt(p, 10) : null;
}
