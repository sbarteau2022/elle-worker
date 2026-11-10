import json,os,math,statistics,random
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
fe=A['facultyEmb']; mu=A['centreMu']; FN=sorted(fe)
nrm=lambda v:(lambda n:[x/n for x in v])(math.sqrt(sum(x*x for x in v)) or 1.0)
dot=lambda a,b:sum(a[i]*b[i] for i in range(len(a)))
sub=lambda v:[v[i]-mu[i] for i in range(len(v))]
E=json.load(open(B+'gemini-batch-01.jsonl.posted.emb.json'))
rows=[json.loads(l) for l in open(B+'gemini-batch-01.jsonl') if l.strip()]
POOL_FLOOR,POOL_CAP,TAU,KAPPA=1024,4096,0.25,0.5
def partition_budget(affs,pool=None):
    n=len(affs); t=max(1e-6,TAU)
    w=[math.exp(a*KAPPA/t) for a in affs]
    z=sum(w) or 1
    total=max(POOL_FLOOR*n, pool if pool else POOL_FLOOR*n)
    return [round(max(POOL_FLOOR,min(POOL_CAP,total*x/z))) for x in w]
for arm,ctr in (('RAW  (deployed)',False),('CENTRED',True)):
    facs={k:nrm(sub(fe[k]) if ctr else fe[k]) for k in FN}
    affs=[]
    for r in rows:
        v=E.get(r['title'])
        if v is None: continue
        u=nrm(sub(v) if ctr else v)
        affs.append(max(dot(u,facs[k]) for k in FN))   # top-1 affinity, what a region carries
    print(f"\n=== {arm} ===")
    print(f"  top-1 affinity: min {min(affs):.4f}  max {max(affs):.4f}  sd {statistics.pstdev(affs):.4f}  spread {max(affs)-min(affs):.4f}")
    random.seed(3); groups=[affs[i:i+6] for i in range(0,60,6)]
    allb=[]
    for g in groups: allb += partition_budget(g)
    print(f"  budgets over 10 partitions of 6: min {min(allb)}  max {max(allb)}  distinct {len(set(allb))}")
    print(f"     designed range {POOL_FLOOR}-{POOL_CAP};  used {max(allb)-min(allb)} tokens = {100*(max(allb)-min(allb))/(POOL_CAP-POOL_FLOOR):.1f}% of range")
    ex=partition_budget(affs[:6]); print(f"     example partition: {ex}   ratio max/min = {max(ex)/min(ex):.3f}")
