import { defineConfig } from 'vitest/config';

// Wrangler bundles **/*.md as Text modules ([[rules]] in wrangler.toml), so
// worker source imports markdown as strings (corpus-seed.ts, education/).
// Vitest runs on vite, which has no such rule — this plugin mirrors it so
// any test that pulls in an .md-importing module loads the same way it
// deploys.
export default defineConfig({
  plugins: [
    {
      name: 'markdown-as-text',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('.md')) {
          return { code: `export default ${JSON.stringify(code)};`, map: null };
        }
      },
    },
  ],
});
