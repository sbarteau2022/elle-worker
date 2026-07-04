import { describe, it, expect } from 'vitest';
import { toolAllowed } from './router';

// The cofounder contract: sees and uses everything EXCEPT the code-shipping
// path. These are the guarantees the demo account rides on — if any flip, a
// potential co-founder either loses access he should have or gains the ability
// to ship code he shouldn't.
describe('cofounder scope', () => {
  const DENIED = ['forge_open', 'forge_write', 'forge_pr', 'run_shell'];
  const ALLOWED = [
    'repo_read', 'repo_search', 'github_read_file', 'github_list_files', 'github_search_code',
    'forge_check', 'run_code', 'read_sql', 'search_corpus', 'find_document', 'recall_memory',
    'web_search', 'diagnose', 'code_engine', 'constraint_analyzer', 'pfar', 'provenance',
    'intent', 'review_runs', 'self_state', 'remember', 'journal_read', 'journal_write',
    'trade_execute', 'trigger_dream', 'ingest_paper', 'rapid_report', 'mcp_add', 'skill_read',
  ];

  it('blocks exactly the code-shipping tools', () => {
    for (const t of DENIED) expect(toolAllowed('cofounder', t), t).toBe(false);
  });

  it('allows everything else — every read into her code and every other capability', () => {
    for (const t of ALLOWED) expect(toolAllowed('cofounder', t), t).toBe(true);
  });

  it('is strictly a subset of full and a strict superset of member', () => {
    for (const t of [...DENIED, ...ALLOWED]) {
      expect(toolAllowed('full', t), t).toBe(true); // full allows all
    }
    // member cannot read_sql or trade; cofounder can — proves cofounder ⊃ member
    expect(toolAllowed('member', 'read_sql')).toBe(false);
    expect(toolAllowed('cofounder', 'read_sql')).toBe(true);
  });

  it('does not leak the shipping tools into full (full keeps them)', () => {
    for (const t of DENIED) expect(toolAllowed('full', t), t).toBe(true);
  });
});
