import { defineConfig } from 'vitest/config';
// Keep stray checkouts (session worktrees under .claude/) out of the suite —
// they duplicated every test in a full run on 2026-09-06.
export default defineConfig({
  plugins: [
    {
      name: 'markdown-text-loader',
      transform(code, id) {
        if (id.endsWith('.md')) {
          return {
            code: `export default ${JSON.stringify(code)};`,
            map: null,
          };
        }
      },
    },
  ],
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/salvage/**'] },
});
