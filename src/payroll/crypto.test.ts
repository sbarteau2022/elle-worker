import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, encryptionConfigured } from './crypto';

const TEST_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE='; // 32 bytes, base64

describe('payroll token encryption', () => {
  it('round-trips a plaintext token through encrypt/decrypt', async () => {
    const plain = 'super-secret-access-token-abc123';
    const encrypted = await encryptToken(plain, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY });
    expect(encrypted).not.toContain(plain); // never stored as a recognizable substring
    const decrypted = await decryptToken(encrypted, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY });
    expect(decrypted).toBe(plain);
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext', async () => {
    const plain = 'same-token-twice';
    const a = await encryptToken(plain, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY });
    const b = await encryptToken(plain, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY });
    expect(a).not.toBe(b);
    expect(await decryptToken(a, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY })).toBe(plain);
    expect(await decryptToken(b, { PAYROLL_TOKEN_ENC_KEY: TEST_KEY })).toBe(plain);
  });

  it('throws (never silently stores plaintext) when the encryption key is unset', async () => {
    await expect(encryptToken('x', {})).rejects.toThrow(/PAYROLL_TOKEN_ENC_KEY not configured/);
    await expect(decryptToken('x', {})).rejects.toThrow(/PAYROLL_TOKEN_ENC_KEY not configured/);
  });

  it('throws on a key that does not decode to 32 bytes', async () => {
    await expect(encryptToken('x', { PAYROLL_TOKEN_ENC_KEY: 'dG9vc2hvcnQ=' })).rejects.toThrow(/32 bytes/);
  });

  it('fails to decrypt with the wrong key (AES-GCM auth tag mismatch)', async () => {
    const encrypted = await encryptToken('secret', { PAYROLL_TOKEN_ENC_KEY: TEST_KEY });
    const wrongKey = 'OTg3NjU0MzIxMDk4NzY1NDMyMTA5ODc2NTQzMjEwOTg=';
    await expect(decryptToken(encrypted, { PAYROLL_TOKEN_ENC_KEY: wrongKey })).rejects.toThrow();
  });

  it('encryptionConfigured reflects whether the key is set', () => {
    expect(encryptionConfigured({})).toBe(false);
    expect(encryptionConfigured({ PAYROLL_TOKEN_ENC_KEY: TEST_KEY })).toBe(true);
  });
});
