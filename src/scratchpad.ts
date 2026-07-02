// ============================================================
// ELLE — router scratchpad · src/scratchpad.ts
//
// The router's only cross-step memory is the raw message list, and every
// tool observation gets hard-clipped to OBS_CAP (3500 chars) before being
// fed back in. On a long multi-tool chain, earlier evidence falls off a
// truncation cliff instead of being retained as structured state. This is a
// small KV-backed working-memory tool so Elle can jot down a finding
// ("invoice total: $4,231.06") and read it back later in the same chain
// without re-deriving or re-fetching it.
//
// Scoped per user (ctxUserId), not per session — a personal scratch space
// that survives across calls within a TTL window, not permanent storage.
// ============================================================

const TTL_SECONDS = 3600; // 1 hour — working memory, not a database
const MAX_KEYS_LISTED = 50;

function prefix(userId: string): string {
  return `scratch:${userId}:`;
}

export async function scratchpadWrite(
  userId: string, key: string, value: string, kv: KVNamespace
): Promise<string> {
  const k = String(key || '').trim();
  if (!k) return 'scratchpad_write: key required';
  await kv.put(prefix(userId) + k, String(value ?? ''), { expirationTtl: TTL_SECONDS });
  return `saved "${k}"`;
}

export async function scratchpadRead(
  userId: string, key: string | undefined, kv: KVNamespace
): Promise<string> {
  if (key && String(key).trim()) {
    const v = await kv.get(prefix(userId) + String(key).trim());
    return v == null ? `(no scratchpad entry for "${key}")` : v;
  }
  // No key given — list everything in this user's scratchpad.
  const list = await kv.list({ prefix: prefix(userId), limit: MAX_KEYS_LISTED });
  if (!list.keys.length) return '(scratchpad is empty)';
  const entries = await Promise.all(
    list.keys.map(async k => {
      const shortKey = k.name.slice(prefix(userId).length);
      const v = await kv.get(k.name);
      return `${shortKey}: ${v ?? ''}`;
    })
  );
  return entries.join('\n');
}
