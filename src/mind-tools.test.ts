import { describe, it, expect } from 'vitest';
import { parseRpcBody, renderContent } from './mcp';
import { skillSlug, validateSkill } from './skills';

describe('mcp parseRpcBody', () => {
  it('parses a plain JSON body', () => {
    const msg = parseRpcBody('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}', 'application/json', 2);
    expect(msg.result.ok).toBe(true);
  });

  it('parses an SSE body and prefers the matching id', () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      '',
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"paper_search"}]}}',
      '',
    ].join('\n');
    const msg = parseRpcBody(sse, 'text/event-stream', 2);
    expect(msg.id).toBe(2);
    expect(msg.result.tools[0].name).toBe('paper_search');
  });

  it('survives keep-alives and partial junk lines', () => {
    const sse = ': keepalive\ndata: not-json\ndata: {"jsonrpc":"2.0","id":7,"error":{"message":"nope"}}\n';
    const msg = parseRpcBody(sse, 'text/event-stream', 7);
    expect(msg.error.message).toBe('nope');
  });

  it('returns null on empty/garbage', () => {
    expect(parseRpcBody('', 'application/json')).toBeNull();
    expect(parseRpcBody('<html>oops</html>', 'application/json')).toBeNull();
  });
});

describe('mcp renderContent', () => {
  it('joins text parts and flags tool errors', () => {
    expect(renderContent({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    expect(renderContent({ isError: true, content: [{ type: 'text', text: 'bad' }] })).toMatch(/^TOOL ERROR:/);
  });
  it('describes non-text parts instead of dropping them', () => {
    expect(renderContent({ content: [{ type: 'image' }] })).toBe('[image]');
    expect(renderContent({ content: [{ type: 'resource', resource: { uri: 'x://y', text: 'body' } }] })).toContain('x://y');
  });
});

describe('skills validation', () => {
  it('slugs names', () => {
    expect(skillSlug('EDI X12 / Purveyor!')).toBe('edi-x12-purveyor');
    expect(skillSlug('')).toBe('');
  });
  it('requires a real procedure body', () => {
    expect(validateSkill('x', 'when', 'too short')).toMatch(/too short/);
    expect(validateSkill('x', '', 'y'.repeat(100))).toMatch(/description/);
    expect(validateSkill('', 'when', 'y'.repeat(100))).toMatch(/name/);
    expect(validateSkill('ok-skill', 'when to use', 'step one then step two '.repeat(10))).toBeNull();
    expect(validateSkill('x', 'when', 'y'.repeat(9000))).toMatch(/too long/);
  });
});
