// ============================================================
// PAYROLL TOKEN ENCRYPTION — src/payroll/crypto.ts
//
// The first D1-stored third-party credential in this repo, per-tenant
// rather than a single global Worker secret (every other integration —
// Alpaca, GitHub, the MCP connector table — uses one shared key/token in
// Worker secrets or a plain bearer column). A live business's QuickBooks/
// Gusto/ADP access + refresh tokens are real money-adjacent secrets, so
// they're encrypted at rest with AES-256-GCM before ever touching D1.
//
// PAYROLL_TOKEN_ENC_KEY is a base64-encoded 32-byte key
// (`openssl rand -base64 32`), set as a Worker secret. Unset ⇒ every
// encrypt/decrypt call throws — callers (payroll/sync.ts, the doors in
// index.ts) surface that as "payroll: encryption key not configured"
// rather than silently storing plaintext.
// ============================================================

export interface CryptoEnv {
  PAYROLL_TOKEN_ENC_KEY?: string;
}

const keyCache = new Map<string, CryptoKey>();

async function getKey(env: CryptoEnv): Promise<CryptoKey> {
  const raw = env.PAYROLL_TOKEN_ENC_KEY;
  if (!raw) throw new Error('payroll: PAYROLL_TOKEN_ENC_KEY not configured — set with `wrangler secret put PAYROLL_TOKEN_ENC_KEY` (base64, `openssl rand -base64 32`)');
  const cached = keyCache.get(raw);
  if (cached) return cached;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error(`payroll: PAYROLL_TOKEN_ENC_KEY must decode to 32 bytes (got ${bytes.length}) — generate with \`openssl rand -base64 32\``);
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  keyCache.set(raw, key);
  return key;
}

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Stored form: base64(12-byte IV || ciphertext+tag) — one self-contained string per column.
export async function encryptToken(plaintext: string, env: CryptoEnv): Promise<string> {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toB64(combined);
}

export async function decryptToken(stored: string, env: CryptoEnv): Promise<string> {
  const key = await getKey(env);
  const combined = fromB64(stored);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function encryptionConfigured(env: CryptoEnv): boolean {
  return !!env.PAYROLL_TOKEN_ENC_KEY;
}
