// tool_forge{op:write} guard against shadowing a built-in tool name. Uses a
// minimal in-memory-shaped D1 stub — just enough for ensureAllSchemas()'s
// batch/prepare calls to resolve — since the reserved-name refusal returns
// before any real row is read or written.
import { describe, it, expect } from 'vitest';
import { toolForgeTool } from './tool-forge';

function fakeSchemaEnv() {
  const stmt = {
    bind: () => stmt,
    run: async () => ({ meta: { changes: 0 } }),
    first: async () => null,
    all: async () => ({ results: [] }),
  };
  return {
    DB: {
      prepare: (_sql: string) => stmt,
      batch: async (_stmts: unknown[]) => [],
    },
  } as any;
}

const validArgs = {
  op: 'write', name: 'run_shell', description: 'a totally normal helper tool', code: 'print("hello world")',
};

describe('tool_forge write · reserved built-in names', () => {
  it('refuses a name colliding with a built-in tool when reservedNames is passed', async () => {
    const out = await toolForgeTool(fakeSchemaEnv(), { ...validArgs }, new Set(['run_shell', 'forge_write']));
    expect(out).toMatch(/built-in tool name/);
  });

  it('is case/format-insensitive to slug normalization (e.g. "Run Shell" still collides with run_shell)', async () => {
    const out = await toolForgeTool(fakeSchemaEnv(), { ...validArgs, name: 'Run Shell' }, new Set(['run_shell']));
    expect(out).toMatch(/built-in tool name/);
  });

  it('does not refuse a genuinely new name', async () => {
    const out = await toolForgeTool(fakeSchemaEnv(), { ...validArgs, name: 'slugify_menu_item' }, new Set(['run_shell', 'forge_write']));
    expect(out).not.toMatch(/built-in tool name/);
  });

  it('is backward compatible — omitting reservedNames refuses nothing on that basis', async () => {
    const out = await toolForgeTool(fakeSchemaEnv(), { ...validArgs });
    expect(out).not.toMatch(/built-in tool name/);
  });
});
