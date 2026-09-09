#!/usr/bin/env python3
"""Build attack batches from batch-01 and score them with gate.py."""
import json, re, random, collections, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate

B01 = "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/gemini-batch-01.jsonl"
OUT = os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(B01) if l.strip()]
by = collections.OrderedDict()
for r in rows: by.setdefault(r["sphere"], []).append(r)
SPH = list(by)

TOPICS = ["education", "logistics", "agriculture", "aviation", "retail", "fisheries"]
STOP = set("""a an the of to in for on at by with from and or but if then that this these those is
are was were be been being as it its into over under per each all any both not no than so such use
used using you your we our they their""".split())

DOMAIN = [
 "harbour trawler quota net skipper tide catch mackerel hold winch berth crate haul buoy licence dock keel gull brine ledger pallet crew rope mast chart depth sonar bilge anchor gantry".split(),
 "vineyard trellis brix harvest cask cooper terroir must ferment lees rack sulphur bottling cellar rootstock pruning canopy veraison crush press label vintage varietal barrel yeast tannin oak fining cork".split(),
 "foundry crucible ingot slag tuyere ladle billet quench temper forge anvil scale mill bloom furnace coke flux dross casting mould shear tonnage alloy pour skimmer runner riser gate feeder".split(),
 "observatory dome mirror seeing airmass photometry cadence filter dither exposure guider zenith parallax spectra coude slew altazimuth flat bias dark aperture magnitude transit ephemeris occultation limb cluster nebula redshift".split(),
 "bakery proof levain crumb bake retard hydration bench scoring steam deck banneton starter autolyse gluten oven loaf shape divide flour salt yeast rye spelt crust boule batard couche lame".split(),
 "kennel litter whelp pedigree gait coat groom bench stack handler ring judge stud dam sire titer worming crate leash muzzle bite topline croup withers stifle hock brisket loin dewclaw".split()]

def clone(base, i):
    s = re.sub(r"\d+", lambda m: str(int(m.group(0)) + i) if len(m.group(0)) <= 3 else m.group(0), base, count=8)
    p = s.split("\n")
    p[0] = (re.sub(r"\b(the|a|an)\b", "the " + TOPICS[i], p[0], count=1)
            if re.search(r"\b(the|a|an)\b", p[0]) else TOPICS[i].capitalize() + " task: " + p[0])
    return "\n".join(p)

def reskin(text, i, seen=None):
    pool = DOMAIN[i]; seen = {} if seen is None else seen; k = [len(seen)]
    def f(m):
        w = m.group(0); lw = w.lower()
        if lw in STOP or len(lw) < 3: return w
        if lw not in seen:
            seen[lw] = pool[k[0] % len(pool)]; k[0] += 1
        r = seen[lw]
        return r.upper() if w.isupper() else (r.capitalize() if w[0].isupper() else r)
    return re.sub(r"[A-Za-z][A-Za-z\-]*", f, text)

def reroll(s, rng):
    return re.sub(r"\d+", lambda m: "".join(
        rng.choice("123456789") if k == 0 and len(m.group(0)) > 1 else rng.choice("0123456789")
        for k in range(len(m.group(0)))), s)

VOCAB = ("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho "
         "sigma tau upsilon phi chi psi omega north south east west ridge basin harbor meadow quartz "
         "basalt cobalt indigo amber cedar birch willow falcon heron marten otter lantern compass "
         "anvil bellows ledger satchel trellis quarry kiln foundry beacon cairn").split()
def scramble(s, seed):
    rnd = random.Random(seed)
    return "".join(rnd.choice(VOCAB) if (t.isalnum() and len(t) > 2) else t for t in re.split(r"(\W+)", s))

PAD = ["The workshop upstairs still smells of turpentine from the vellum conservation project, and the "
       "hygrometer by the window has not been calibrated since the spring. None of that bears on the request.",
       "Hydrothermal vent surveys off the Juan de Fuca ridge ran three weeks over schedule last season, "
       "largely because the winch gearbox seized twice. Set all of that aside.",
       "The bossa nova reel archive was rehoused in acid-free sleeves after the flood, though six boxes "
       "remain unlabelled in the annex. That history is irrelevant here.",
       "Sapporo's snow removal fleet dispatches by ward, and the night crews rotate on a fourteen-day "
       "cycle that nobody enjoys. Ignore the preceding paragraph entirely.",
       "Reduction firing in the anagama kiln demands somebody stoking through the small hours, and the "
       "cone packs rarely agree with the pyrometer. None of this changes the task.",
       "Basque cider houses pour from height to aerate, and the txotx season opens in January with a "
       "queue out the door. Disregard that background."]

def emit(name, rowsout):
    p = os.path.join(OUT, name)
    with open(p, "w") as f:
        for r in rowsout: f.write(json.dumps(r) + "\n")
    return p

# ---- A: batch-02 reconstruction (clone + noun swap + number jitter)
A = [dict(by[s][0], brief=clone(by[s][0]["brief"], i)) for s in SPH for i in range(6)]
# ---- B: domain re-skin  (beats every surface-lexical statistic)
B = []
for s in SPH:
    for i in range(6):
        b = clone(by[s][0]["brief"], i)
        B.append(dict(by[s][0], brief=reskin(b, i)))
# ---- C: ATTACK X - scramble briefs only, verify untouched (passes the incumbent 0.15 bar)
C = [dict(by[s][0], brief=scramble(clone(by[s][0]["brief"], i), hash((s, i)) & 0xffff)) for s in SPH for i in range(6)]
# ---- D: padding - unique high-entropy prose around an unchanged core
D = [dict(by[s][0], brief=PAD[i] + "\n" + by[s][0]["brief"] + "\n" + PAD[5 - i]) for s in SPH for i in range(6)]
# ---- E: decoy operation verbs, k per row, disjoint across rows
def decoys(k):
    out = []
    for s in SPH:
        base = [clone(by[s][0]["brief"], i) for i in range(6)]
        core = set()
        for b in base: core |= gate.op_set(b)
        pool = sorted(gate.OPS - core)
        for i, b in enumerate(base):
            d = pool[i * k:(i + 1) * k]
            out.append(dict(by[s][0], brief=b + ((" Additionally " + ", ".join(d) + " the output line.") if d else "")))
    return out
# ---- F: full stack - reskin brief AND verify with a per-row domain, reroll every number
F = []
for s in SPH:
    for i in range(6):
        rng = random.Random(hash((s, i)) & 0xffff)
        seen = {}
        b = reskin(reroll(clone(by[s][0]["brief"], i), rng), i, seen)
        v = reskin(by[s][0]["verify"], i, seen)
        F.append(dict(by[s][0], brief=b, verify=v))

paths = [("A b02-reconstruction", emit("atk_A.jsonl", A)),
         ("B domain re-skin", emit("atk_B.jsonl", B)),
         ("C scramble brief only", emit("atk_C.jsonl", C)),
         ("D padding", emit("atk_D.jsonl", D)),
         ("F full stack reskin+reroll+verify", emit("atk_F.jsonl", F))]
for k in (3, 6, 9, 12):
    paths.append(("E decoy verbs k=%d" % k, emit("atk_E%d.jsonl" % k, decoys(k))))

import itertools, statistics, difflib
def incumbent(p):
    rs = [json.loads(l) for l in open(p) if l.strip()]
    g = collections.OrderedDict()
    for r in rs: g.setdefault(r["sphere"], []).append(r["brief"])
    return statistics.median([statistics.median(
        [difflib.SequenceMatcher(None, a, b).ratio() for a, b in itertools.combinations(v, 2)]) for v in g.values()])

print("%-36s %8s | %8s %8s | %8s %7s | %5s | %s" % (
    "batch", "incumb", "T1 min", "T1 med", "T2 max", "vlen", "T3max", "verdict"))
print("-" * 118)
for label, p in [("batch-01 (GOOD)", B01),
                 ("batch-03 (BAD, b02 stand-in)", "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/gemini-batch-03.jsonl")] + paths:
    per, vmed, _ = gate.analyse(p)
    t1 = [v["t1"] for v in per.values()]; t2 = [v["t2"] for v in per.values()]; t3 = [v["t3"] for v in per.values()]
    f = []
    if min(t1) < 0.60 or gate.med(t1) < 0.85: f.append("T1")
    if max(t2) > 0.20 or vmed > 178: f.append("T2")
    if max(t3) >= 2: f.append("T3")
    print("%-36s %8.4f | %8.4f %8.4f | %8.4f %7d | %5d | %s" % (
        label, incumbent(p), min(t1), gate.med(t1), max(t2), vmed, max(t3),
        "REJECT " + "+".join(f) if f else "*** PASSES GATE ***"))
