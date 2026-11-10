#!/usr/bin/env python3
"""brief_gate.py - acceptance gate for a 66-row brief batch (11 spheres x 6 rows).

    python3 brief_gate.py gemini-batch-NN.jsonl        # exit 0 = PASS, 1 = FAIL

Replaces the "median within-sphere difflib.SequenceMatcher(brief) < 0.15" bar,
which a capable writer beats with surface-form variation while still writing one
underlying task per sphere.  Three tests, all stdlib, all calibrated on
gemini-batch-01 (known good, 66 distinct tasks) vs the known-bad template batch.

T1 SPEC   shared-specimen core   - do all six rows of a sphere reuse the same
                                   rare tokens (entity names, ids, literals)?
T2 SKEL   masked-skeleton match  - vocabulary-blind: are the six briefs the same
                                   sentence structure with the words swapped?
T3 VERIFY verify rare-term cosine- do the six rows check the same thing, however
                                   differently the briefs are worded?
"""
import sys, json, re, math, statistics, itertools, collections
from difflib import SequenceMatcher

# ---------------------------------------------------------------- thresholds
# Every number below is the midpoint between a measured batch-01 (good) value
# and a measured attack value.  See the block comment at the bottom.
SPEC_FLAG   = 2      # batch-01 = 0 shared rare tokens in all 11 spheres; bad batch = 15..23
SCHEMA_MAX  = 0.33   # batch-01 sphere-medians all 0.0000 (max single pair 0.1170);
                     # one-task-six-shapes attack 1.0000, schema-varying evasion 0.543
SKEL_MAX    = 0.78   # batch-01 worst sphere 0.6927; weakest attack worst sphere 0.8658
VCOS_MAX    = 0.18   # batch-01 worst sphere 0.1218; paraphrase attack 0.2267 / 0.2423
VLEN_MAX    = 178    # 2 x batch-01 median verify length (89); its longest is 147
DF_FRAC     = 0.10   # a token in >10% of the batch is boilerplate, not specimen

FUNC = set("""a an the of to in for on at by with from and or but if then that this these those is are
was were be been being as it its into over under per each all any both not no nor than so such use used
using you your yours we our ours they them their he she his her him i me my mine will would shall should
can could may might must do does did done have has had having there here when where which who whom whose
what why how while after before during between within without across about above below up down out off
only also very more most less least same other another new old first second next last one two three""".split())

TOK = re.compile(r"[a-z0-9][a-z0-9_]*")
def toks(s): return TOK.findall(s.lower())
def med(x): return statistics.median(x) if x else float("nan")

# ---------------------------------------------------------------- T1  SPEC
def spec_cores(by):
    """Per sphere: the batch-rare tokens that appear in EVERY row of that sphere.

    df is computed over the whole batch, so shared scaffolding ("the final summary
    must state", "python3") is filtered out automatically by the df cap; what
    survives an intersection is specimen vocabulary - entity names, identifiers,
    numeric literals.  A set intersection, so it is invariant to genre, register,
    sentence order and length: the moves a re-narrating writer makes.
    """
    rows = [r for rs in by.values() for r in rs]
    n = len(rows)
    tk = {id(r): {w for w in toks(r["brief"]) if len(w) >= 3 and w not in FUNC} for r in rows}
    df = collections.Counter()
    for r in rows: df.update(tk[id(r)])
    k = max(len(v) for v in by.values())
    cap = max(k, math.ceil(DF_FRAC * n))          # a sphere-exclusive token can reach df == k
    out = collections.OrderedDict()
    for s, rs in by.items():
        if len(rs) < 2:                            # a lone row shares nothing with nobody
            out[s] = []; continue
        inter = None
        for r in rs:
            rare = {w for w in tk[id(r)] if df[w] <= cap}
            inter = rare if inter is None else (inter & rare)
        out[s] = sorted(inter or [])
    return out

# ------------------------------------------------- T1 channel b: schema fingerprint
# Recovers the RELATIONAL SCHEMA of a brief's embedded data artifact - how many
# records, how many categorical columns, how many levels each has, and how records
# distribute over them - and compares schemas instead of words.  Blind to
# serialisation (JSON / CSV / pipe table / key=value / prose), to entity names and
# to the values themselves, so re-rendering or renaming or re-rolling one dataset
# does not move it.  Returns 0.0 for any brief with no detectable artifact, which
# is most of them: only 4 of batch-01's 66 briefs carry one.
_TOKEN = re.compile(r"\d+\.\d+|[A-Za-z_][A-Za-z0-9_]*|\d+")
_DEC   = re.compile(r"^\d+\.\d+$")
_INT   = re.compile(r"^\d+$")
_GAP, _MINREC, _COVER = 10, 5, 0.6

def _measurements(tk, freq):
    dec = [i for i, t in enumerate(tk) if _DEC.match(t)]
    if len(dec) >= 4: return dec
    return [i for i, t in enumerate(tk) if _INT.match(t) and freq[t] == 1]

def _clusters(idx):
    if not idx: return []
    out, cur = [], [idx[0]]
    for a, b in zip(idx, idx[1:]):
        if b - a <= _GAP: cur.append(b)
        else: out.append(cur); cur = [b]
    out.append(cur); return out

def schema(text):
    tk = [m.group(0).lower() for m in _TOKEN.finditer(text)]
    freq = collections.Counter(tk)
    cl = [c for c in _clusters(_measurements(tk, freq)) if len(c) >= _MINREC]
    if not cl: return None
    cl = max(cl, key=len)
    gaps = sorted(b - a for a, b in zip(cl, cl[1:]))
    if not gaps: return None
    g = gaps[len(gaps) // 2]; half = (g + 1) // 2
    lo = max(0, cl[0] - (g - half)); hi = min(len(tk), cl[-1] + half); ms = set(cl)
    bounds = [lo] + [(a + b + 1) // 2 for a, b in zip(cl, cl[1:])] + [hi]
    recs = [{tk[j] for j in range(a, b) if j not in ms} for a, b in zip(bounds, bounds[1:])]
    n = len(recs)
    where = {}
    for i, r in enumerate(recs):
        for t in r: where.setdefault(t, set()).add(i)
    cols = []
    for t in sorted((t for t, v in where.items() if len(v) >= 2), key=lambda t: (-len(where[t]), t)):
        for c in cols:
            if all(where[t].isdisjoint(where[u]) for u in c): c.append(t); break
        else: cols.append([t])
    out = []
    for c in cols:
        cov = sum(len(where[t]) for t in c)
        if len(c) >= 2 and cov >= _COVER * n:
            out.append(tuple(sorted((len(where[t]) / cov for t in c), reverse=True)))
    out.sort(key=lambda p: (-len(p), p))
    return out[:6] or None                      # cap: keeps the permutation search small

def _profile_sim(pa, pb):
    n = max(len(pa), len(pb))
    a = list(pa) + [0.0] * (n - len(pa)); b = list(pb) + [0.0] * (n - len(pb))
    num = sum(min(x, y) for x, y in zip(a, b)); den = sum(max(x, y) for x, y in zip(a, b))
    return num / den if den else 0.0

def schema_sim(a, b):
    fa, fb = schema(a), schema(b)
    if not fa or not fb: return 0.0
    if len(fa) > len(fb): fa, fb = fb, fa
    best = 0.0
    for perm in itertools.permutations(range(len(fb)), len(fa)):
        best = max(best, sum(_profile_sim(fa[i], fb[j]) for i, j in enumerate(perm)))
    return best / max(len(fa), len(fb))

# ---------------------------------------------------------------- T2  SKEL
def skeleton(b):
    """Every run of letters -> 'W', every run of digits -> '0'.  Punctuation,
    spacing, clause count and sentence shape survive; all vocabulary dies."""
    return re.sub(r"\d+", "0", re.sub(r"[A-Za-z]+", "W", b))

def skel_sphere(briefs):
    sk = [skeleton(b) for b in briefs]
    return med([SequenceMatcher(None, a, b).ratio() for a, b in itertools.combinations(sk, 2)])

# ---------------------------------------------------------------- T3  VERIFY
def idf_map(docs):
    n = len(docs); df = collections.Counter()
    for d in docs: df.update(set(toks(d)))
    return {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}, math.log(n + 1) + 1.0

def idf_cos(a, b, idf, dflt):
    va = {w: c * idf.get(w, dflt) for w, c in collections.Counter(toks(a)).items()}
    vb = {w: c * idf.get(w, dflt) for w, c in collections.Counter(toks(b)).items()}
    na = math.sqrt(sum(v * v for v in va.values())); nb = math.sqrt(sum(v * v for v in vb.values()))
    return sum(va[w] * vb.get(w, 0.0) for w in va) / (na * nb) if na and nb else 0.0

# ---------------------------------------------------------------- driver
def load(path):
    rows, by = [], collections.OrderedDict()
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            line = line.strip()
            if not line: continue
            try: r = json.loads(line)
            except Exception as e: sys.exit("line %d: bad JSON (%s)" % (i, e))
            for k in ("sphere", "brief", "verify"):
                if k not in r: sys.exit("line %d: row is missing required field %r" % (i, k))
            rows.append(r); by.setdefault(r["sphere"], []).append(r)
    if not rows: sys.exit("no rows")
    return rows, by

def main(path):
    rows, by = load(path)
    idf, dflt = idf_map([r["verify"] for r in rows])
    cores = spec_cores(by)
    vlen = [len(r["verify"]) for r in rows]
    vlen_med = med(vlen)

    per = collections.OrderedDict()
    for s, rs in by.items():
        P = list(itertools.combinations(range(len(rs)), 2))
        per[s] = {
            "n":    len(rs),
            "spec": len(cores[s]),
            "skel": skel_sphere([r["brief"] for r in rs]) if P else 0.0,
            "schm": med([schema_sim(rs[i]["brief"], rs[j]["brief"]) for i, j in P]) if P else 0.0,
            "meas": bool(P),
            "vcos": med([idf_cos(rs[i]["verify"], rs[j]["verify"], idf, dflt) for i, j in P]) if P else 0.0,
        }

    print("batch: %s   %d rows, %d spheres, %s rows/sphere"
          % (path, len(rows), len(by), "/".join(str(v["n"]) for v in per.values())))
    odd = [s for s, v in per.items() if v["n"] != 6]
    if odd:
        print("WARNING: every threshold here is calibrated on spheres of exactly 6 rows.")
        print("         %d sphere(s) are not 6 rows (%s); their T1 core value in particular"
              % (len(odd), ", ".join("%s=%d" % (s, per[s]["n"]) for s in odd[:5])))
        print("         is not comparable to the batch-01 calibration - read it, do not gate on it.")
    print()
    print("%-28s %4s %6s %8s %8s %8s   %s" % ("sphere", "rows", "T1core", "T1schm", "T2skel", "T3vcos", "verdict"))
    print("-" * 96)
    for s, v in per.items():
        f = []
        if v["spec"] >= SPEC_FLAG or v["schm"] > SCHEMA_MAX: f.append("T1")
        if v["skel"] > SKEL_MAX:   f.append("T2")
        if v["vcos"] > VCOS_MAX:   f.append("T3")
        print("%-28s %4d %6d %8.4f %8.4f %8.4f   %s" % (s, v["n"], v["spec"], v["schm"], v["skel"], v["vcos"],
              ("FAIL " + "+".join(f)) if f else ("ok" if v["meas"] else "n/a (<2 rows: NOT MEASURED)")))
        if v["spec"] >= SPEC_FLAG:
            c = cores[s]
            print("%-28s        shared by all %d rows: %s%s"
                  % ("", v["n"], ", ".join(c[:10]), " ..." if len(c) > 10 else ""))
    print("-" * 96)

    worst_spec = max(v["spec"] for v in per.values())
    worst_schm = max(v["schm"] for v in per.values())
    worst_skel = max(v["skel"] for v in per.values())
    worst_vcos = max(v["vcos"] for v in per.values())
    fails = []
    if worst_spec >= SPEC_FLAG:
        fails.append("T1 SPEC   %d sphere(s) reuse >=%d rare tokens across all rows (worst %d; batch-01 = 0)"
                     % (sum(1 for v in per.values() if v["spec"] >= SPEC_FLAG), SPEC_FLAG, worst_spec))
    if worst_schm > SCHEMA_MAX:
        fails.append("T1 SPEC   %d sphere(s) over %.2f data-schema match (worst %.4f; batch-01 0.0000 in every sphere)"
                     % (sum(1 for v in per.values() if v["schm"] > SCHEMA_MAX), SCHEMA_MAX, worst_schm))
    if worst_skel > SKEL_MAX:
        fails.append("T2 SKEL   %d sphere(s) over %.2f masked-skeleton match (worst %.4f; batch-01 max 0.6927)"
                     % (sum(1 for v in per.values() if v["skel"] > SKEL_MAX), SKEL_MAX, worst_skel))
    if worst_vcos > VCOS_MAX:
        fails.append("T3 VERIFY %d sphere(s) over %.2f verify rare-term cosine (worst %.4f; batch-01 max 0.1218)"
                     % (sum(1 for v in per.values() if v["vcos"] > VCOS_MAX), VCOS_MAX, worst_vcos))
    if vlen_med > VLEN_MAX:
        fails.append("T3 VERIFY median verify length %d > %d chars - padding inflates verify to dilute T3"
                     % (vlen_med, VLEN_MAX))

    print("T1 SPEC   worst sphere core   %6d   (fail at >=%d)      batch-01 0 everywhere" % (worst_spec, SPEC_FLAG))
    print("T1 SPEC   worst sphere schema %6.4f   (fail above %.2f)   batch-01 0.0000 (max single pair 0.1170)" % (worst_schm, SCHEMA_MAX))
    print("T2 SKEL   worst sphere match  %6.4f   (fail above %.2f)   batch-01 0.5644 median / 0.6927 worst" % (worst_skel, SKEL_MAX))
    print("T3 VERIFY worst sphere cosine %6.4f   (fail above %.2f)   batch-01 0.0777 median / 0.1218 worst" % (worst_vcos, VCOS_MAX))
    print("          median verify length %5d   (fail above %d)     batch-01 89" % (vlen_med, VLEN_MAX))
    print()
    if fails:
        print("OVERALL: FAIL")
        for f in fails: print("  - " + f)
    else:
        print("OVERALL: PASS")
    return 1 if fails else 0

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: brief_gate.py BATCH.jsonl")
    sys.exit(main(sys.argv[1]))
