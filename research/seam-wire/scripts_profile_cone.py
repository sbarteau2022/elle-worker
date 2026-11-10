import json,os,math,statistics
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
pe=A['profileEmb']; mu=A['centreMu']; PN=sorted(pe)
def nrm(v):
    n=math.sqrt(sum(x*x for x in v)) or 1.0; return [x/n for x in v]
def dot(a,b): return sum(a[i]*b[i] for i in range(len(a)))
def sub(v): return [v[i]-mu[i] for i in range(len(v))]
E=json.load(open(B+'gemini-batch-01.jsonl.posted.emb.json'))
rows=[json.loads(l) for l in open(B+'gemini-batch-01.jsonl') if l.strip()]
armstats={}
for arm,ctr in (('RAW',False),('CENTRED',True)):
    poles={k:{s:nrm(sub(pe[k][s]) if ctr else pe[k][s]) for s in ('low','high')} for k in PN}
    per={k:[] for k in PN}
    for r in rows:
        v=E.get(r['title'])
        if v is None: continue
        u=nrm(sub(v) if ctr else v)
        for k in PN: per[k].append(dot(poles[k]['high'],u)-dot(poles[k]['low'],u))
    armstats[arm]=per
print(f"{'profile axis':16s} {'RAW mean':>10s} {'RAW sd':>9s} {'RAW range':>18s} | {'CEN mean':>9s} {'CEN sd':>9s} {'CEN range':>18s} {'sd x':>6s}")
ratios=[]
for k in PN:
    R,C=armstats['RAW'][k],armstats['CENTRED'][k]
    sr,sc=statistics.pstdev(R),statistics.pstdev(C)
    ratios.append(sc/sr if sr else 0)
    print(f"{k:16s} {statistics.mean(R):10.4f} {sr:9.4f} [{min(R):7.4f},{max(R):7.4f}] | {statistics.mean(C):9.4f} {sc:9.4f} [{min(C):7.4f},{max(C):7.4f}] {sc/sr if sr else 0:6.2f}")
print(f"\nmean sd amplification from centring = {statistics.mean(ratios):.2f}x")
# how often does the SIGN of the coordinate flip between arms?
flips=0;tot=0
for k in PN:
    for a,b in zip(armstats['RAW'][k],armstats['CENTRED'][k]):
        tot+=1
        if (a>0)!=(b>0): flips+=1
print(f"sign of profile coordinate differs RAW vs CENTRED: {flips}/{tot} = {flips/tot:.1%}")
