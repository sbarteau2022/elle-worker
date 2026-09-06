import { defineConfig } from 'vitest/config';
// Keep stray checkouts (session worktrees under .claude/) out of the suite —
// they duplicated every test in a full run on 2026-09-06.
export default defineConfig({
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/salvage/**'] },
});
