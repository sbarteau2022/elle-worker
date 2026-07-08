// Pure-logic tests for the forge loop and ideation: spec validation, harness
// compilation, response parsing, pass detection, PR file layout, and proposal
// parsing. No network, no D1, no sandbox — the same discipline as the other
// suites (self-tools, scope, connect-sandbox).
import { describe, it, expect } from 'vitest';
import {
  validateForgeSpec, normalizeSpec, buildHarness, parseWriteResponse,
  parseReviewResponse, allGoalsPass, forgedFiles,
  type ForgeSpec, type GoalResult,
} from './forge-loop';
import { parseProposals, proposalToSpec, conceptOf } from './forge-ideate';

const goodSpec: ForgeSpec = {
  name: 'roman', description: 'convert integers to roman numerals', language: 'python',
  goals: [
    { id: 'g1', describe: '1994 is MCMXCIV', assert: "roman(1994) == 'MCMXCIV'" },
    { id: 'g2', describe: '4 is IV', assert: "roman(4) == 'IV'" },
  ],
};

describe('forge · validateForgeSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(validateForgeSpec(goodSpec)).toBeNull();
  });
  it('rejects a spec with no goals — it cannot converge', () => {
    expect(validateForgeSpec({ ...goodSpec, goals: [] })).toMatch(/at least one/i);
  });
  it('rejects a goal missing its assert', () => {
    const bad = { ...goodSpec, goals: [{ id: 'g1', describe: 'x', assert: '' }] };
    expect(validateForgeSpec(bad)).toMatch(/assert/i);
  });
  it('rejects a name with spaces', () => {
    expect(validateForgeSpec({ ...goodSpec, name: 'my tool' })).toMatch(/alphanumeric|spaces/i);
  });
  it('rejects a too-short description', () => {
    expect(validateForgeSpec({ ...goodSpec, description: 'nope' })).toMatch(/description/i);
  });
  it('rejects an unknown language', () => {
    expect(validateForgeSpec({ ...goodSpec, language: 'ruby' as never })).toMatch(/language/i);
  });
});

describe('forge · normalizeSpec', () => {
  it('slugs the name and assigns goal ids when missing', () => {
    const n = normalizeSpec({ name: 'My Tool!!', description: 'does a thing well', language: 'javascript',
      goals: [{ id: '', describe: 'd', assert: 'true' }] });
    expect(n.name).toBe('my_tool');
    expect(n.goals[0].id).toBe('g1');
    expect(n.language).toBe('javascript');
  });
});

describe('forge · buildHarness', () => {
  it('python harness embeds the impl, the assert, and exits on pass/fail', () => {
    const h = buildHarness('python', 'def roman(n): return "IV"', goodSpec.goals[1]);
    expect(h).toContain('def roman(n): return "IV"');
    expect(h).toContain("roman(4) == 'IV'");
    expect(h).toContain('_forge_sys.exit(0 if _forge_ok else 1)');
    expect(h).toContain('GOAL g2');
  });
  it('javascript harness wraps the assert in an async IIFE with process.exit', () => {
    const h = buildHarness('javascript', 'function slug(s){return s}', { id: 'g1', describe: 'x', assert: "slug('a') === 'a'" });
    expect(h).toContain('function slug(s){return s}');
    expect(h).toContain("slug('a') === 'a'");
    expect(h).toContain('process.exit(__ok ? 0 : 1)');
  });
});

describe('forge · parseWriteResponse', () => {
  it('parses a clean JSON object', () => {
    const r = parseWriteResponse('{"thought":"ok","code":"def f(): pass"}');
    expect(r?.code).toBe('def f(): pass');
    expect(r?.thought).toBe('ok');
  });
  it('strips ```json fences before parsing', () => {
    const r = parseWriteResponse('```json\n{"thought":"t","code":"x=1"}\n```');
    expect(r?.code).toBe('x=1');
  });
  it('salvages a bare code fence when the model ignored the JSON contract', () => {
    const r = parseWriteResponse('here you go:\n```python\nprint(1)\n```');
    expect(r?.code.trim()).toBe('print(1)');
  });
  it('returns null when there is no code at all', () => {
    expect(parseWriteResponse('sorry I cannot')).toBeNull();
  });
});

describe('forge · parseReviewResponse', () => {
  it('reads approve', () => {
    expect(parseReviewResponse('{"verdict":"approve","notes":"clean"}').verdict).toBe('approve');
  });
  it('reads revise with notes', () => {
    const r = parseReviewResponse('{"verdict":"revise","notes":"handle n=0"}');
    expect(r.verdict).toBe('revise');
    expect(r.notes).toBe('handle n=0');
  });
  it('defaults to revise on garbage (never silently ships)', () => {
    expect(parseReviewResponse('¯\\_(ツ)_/¯').verdict).toBe('revise');
  });
});

describe('forge · allGoalsPass', () => {
  const mk = (id: string, pass: boolean): GoalResult => ({ goal_id: id, describe: id, pass, exit: pass ? 0 : 1, stdout: '', stderr: '', duration_ms: 1 });
  it('is true only when every goal passed and the count matches', () => {
    expect(allGoalsPass([mk('g1', true), mk('g2', true)], 2)).toBe(true);
    expect(allGoalsPass([mk('g1', true), mk('g2', false)], 2)).toBe(false);
    expect(allGoalsPass([mk('g1', true)], 2)).toBe(false); // a goal never ran
  });
});

describe('forge · forgedFiles (the PR layout)', () => {
  it('lays down tool + manifest + README under forged/<name>/', () => {
    const files = forgedFiles(goodSpec, 'def roman(n): return ""', 'approved');
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['forged/roman/README.md', 'forged/roman/manifest.json', 'forged/roman/tool.py']);
    const manifest = JSON.parse(files.find(f => f.path.endsWith('manifest.json'))!.content);
    expect(manifest.name).toBe('roman');
    expect(manifest.goals).toHaveLength(2);
  });
  it('uses the .js extension for a javascript tool', () => {
    const files = forgedFiles({ ...goodSpec, language: 'javascript' }, 'x', 'ok');
    expect(files.some(f => f.path.endsWith('tool.js'))).toBe(true);
  });
});

describe('forge · ideation proposal parsing', () => {
  const raw = JSON.stringify([
    { name: 'slugify', description: 'turn text into url slugs cleanly', rationale: 'the corpus needs stable ids', language: 'python',
      goals: [{ id: 'g1', describe: 'spaces become dashes', assert: "slugify('a b') == 'a-b'" }] },
    { name: 'bad', description: 'no goals here at all', rationale: 'x', language: 'python', goals: [] }, // dropped: forge-unready
  ]);
  it('keeps only forge-ready proposals (name + purpose + goals)', () => {
    const props = parseProposals(raw);
    expect(props).toHaveLength(1);
    expect(props[0].name).toBe('slugify');
  });
  it('tolerates prose around the JSON array', () => {
    expect(parseProposals('Here are my ideas:\n' + raw + '\nThat is all.')).toHaveLength(1);
  });
  it('proposalToSpec produces a valid, normalized forge spec', () => {
    const spec = proposalToSpec(parseProposals(raw)[0]);
    expect(validateForgeSpec(spec)).toBeNull();
    expect(spec.name).toBe('slugify');
  });
  it('conceptOf renders the rationale and goals for the idea row', () => {
    const c = conceptOf(parseProposals(raw)[0]);
    expect(c).toMatch(/Why:/);
    expect(c).toMatch(/spaces become dashes/);
  });
});
