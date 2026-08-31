import { defineConfig } from 'vitest/config';

// Standalone config so vitest doesn't walk up and pick up the repo root's
// config (which has a markdown-loader plugin specific to the worker build).
export default defineConfig({});
