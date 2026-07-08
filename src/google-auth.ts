// ============================================================
// ELLE — Google sign-in audience check · src/google-auth.ts
//
// The pure half of handleOAuth (index.ts): is this ID token's `aud` one of
// ours? GOOGLE_CLIENT_ID accepts a COMMA-SEPARATED allowlist because one
// Google Cloud project legitimately mints tokens under several client IDs —
// the web client (GSI on a website, and what the Android native lib puts in
// `aud` when configured with webClientId) and the iOS client (what the iOS
// native lib can present). One env var, N platforms.
// ============================================================

export function parseAllowedAudiences(configured: string | undefined): string[] {
  return String(configured || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function audienceAllowed(aud: string | undefined, configured: string | undefined): boolean {
  if (!aud) return false;
  return parseAllowedAudiences(configured).includes(aud);
}
