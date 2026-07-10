import { describe, it, expect } from 'vitest';
import { ssrfGuard, isPrivateOrReservedHost } from './ssrf';

describe('ssrfGuard — allows real public URLs', () => {
  it('passes ordinary https and http public hosts', () => {
    expect(ssrfGuard('https://example.com/path?q=1').ok).toBe(true);
    expect(ssrfGuard('http://data.gov/x').ok).toBe(true);
    expect(ssrfGuard('https://sub.domain.co.uk:443/y').ok).toBe(true);
  });
});

describe('ssrfGuard — rejects the SSRF classics', () => {
  it('blocks non-http(s) schemes', () => {
    for (const u of ['file:///etc/passwd', 'gopher://x', 'data:text/html,hi', 'ws://x', 'blob:x']) {
      expect(ssrfGuard(u).ok).toBe(false);
    }
  });

  it('blocks the cloud metadata address and loopback', () => {
    expect(ssrfGuard('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(ssrfGuard('http://127.0.0.1/').ok).toBe(false);
    expect(ssrfGuard('http://localhost/admin').ok).toBe(false);
    expect(ssrfGuard('http://[::1]/').ok).toBe(false);
  });

  it('blocks RFC1918 private ranges (v4)', () => {
    for (const h of ['http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.9.9/', 'http://172.31.255.1/']) {
      expect(ssrfGuard(h).ok, h).toBe(false);
    }
    // 172.32 is public — not in 172.16/12
    expect(ssrfGuard('http://172.32.0.1/').ok).toBe(true);
  });

  it('blocks IPv6 unique-local and link-local, and IPv4-mapped metadata', () => {
    expect(isPrivateOrReservedHost('fd00::1')).toBe(true);
    expect(isPrivateOrReservedHost('fe80::1')).toBe(true);
    expect(isPrivateOrReservedHost('::ffff:169.254.169.254')).toBe(true);
  });

  it('blocks embedded credentials (host smuggling) and odd ports', () => {
    expect(ssrfGuard('http://user:pass@evil.com/').ok).toBe(false);
    expect(ssrfGuard('http://example.com:22/').ok).toBe(false);
    expect(ssrfGuard('http://example.com:8080/').ok).toBe(false);
  });

  it('rejects malformed input and out-of-range octets', () => {
    expect(ssrfGuard('').ok).toBe(false);
    expect(ssrfGuard('not a url').ok).toBe(false);
    expect(isPrivateOrReservedHost('999.1.1.1')).toBe(true); // malformed → refuse
  });
});
