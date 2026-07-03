// ============================================================
// ELLE — safe arithmetic evaluator · src/calc.ts
//
// LLMs are unreliable at exact arithmetic on real numbers — the RAPID
// prompt explicitly tells the model to "do the cost%/margin/variance
// interpretation yourself; never invent figures," which is exactly where a
// model invents figures. A deterministic calculator closes that gap.
//
// Hand-rolled recursive-descent parser rather than eval()/new Function() —
// this runs inside the admin router, but there's no reason to accept
// arbitrary JS when the grammar below is the entire surface a calculator
// needs: + - * / % ^, parens, unary minus, decimals, and a small whitelist
// of Math functions.
// ============================================================

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  log: Math.log, log10: Math.log10, exp: Math.exp,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  pow: (a, b) => Math.pow(a, b),
};

class ParseError extends Error {}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\.\d+|[()+\-*/%^,]|\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    if (m[1].trim()) tokens.push(m[1]);
  }
  return tokens;
}

// expr := term (('+' | '-') term)*
// term := factor (('*' | '/' | '%') factor)*
// factor := power
// power := unary ('^' power)?          (right-assoc)
// unary := '-' unary | primary
// primary := NUMBER | IDENT '(' args ')' | '(' expr ')'
function evalExpr(expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const rhs = parsePower();
      if (op === '*') v *= rhs;
      else if (op === '/') { if (rhs === 0) throw new ParseError('division by zero'); v /= rhs; }
      else v %= rhs;
    }
    return v;
  }
  function parsePower(): number {
    const base = parseUnary();
    if (peek() === '^') { next(); return Math.pow(base, parsePower()); }
    return base;
  }
  function parseUnary(): number {
    if (peek() === '-') { next(); return -parseUnary(); }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = next();
    if (t === undefined) throw new ParseError('unexpected end of expression');
    if (t === '(') {
      const v = parseExpr();
      if (next() !== ')') throw new ParseError('expected ")"');
      return v;
    }
    if (/^\d/.test(t) || /^\.\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      if (t.toLowerCase() === 'pi') return Math.PI;
      if (t.toLowerCase() === 'e') return Math.E;
      const fn = FUNCS[t.toLowerCase()];
      if (!fn) throw new ParseError(`unknown identifier "${t}" (allowed: ${Object.keys(FUNCS).join(', ')}, pi, e)`);
      if (next() !== '(') throw new ParseError(`expected "(" after ${t}`);
      const args: number[] = [];
      if (peek() !== ')') {
        args.push(parseExpr());
        while (peek() === ',') { next(); args.push(parseExpr()); }
      }
      if (next() !== ')') throw new ParseError('expected ")"');
      return fn(...args);
    }
    throw new ParseError(`unexpected token "${t}"`);
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new ParseError(`unexpected trailing token "${tokens[pos]}"`);
  if (!Number.isFinite(result)) throw new ParseError('result is not a finite number');
  return result;
}

export function calc(expression: string): string {
  const expr = String(expression || '').trim();
  if (!expr) return 'calc: expression required';
  try {
    const result = evalExpr(expr);
    return String(result);
  } catch (e) {
    return `calc error: ${e instanceof ParseError ? e.message : 'invalid expression'}`;
  }
}
