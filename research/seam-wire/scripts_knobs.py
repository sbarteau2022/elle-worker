import json,os,math,statistics,collections
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
pe=A['profileEmb']; mu=A['centreMu']; PN=sorted(pe)
nrm=lambda v:(lambda n:[x/n for x in v])(math.sqrt(sum(x*x for x in v)) or 1.0)
dot=lambda a,b:sum(a[i]*b[i] for i in range(len(a)))
sub=lambda v:[v[i]-mu[i] for i in range(len(v))]
E=json.load(open(B+'gemini-batch-01.jsonl.posted.emb.json'))
rows=[json.loads(l) for l in open(B+'gemini-batch-01.jsonl') if l.strip()]
def knobs(c):
    cl=lambda k:max(-1,min(1,c.get(k,0) or 0)); u=lambda k:(cl(k)+1)/2
    lerp=lambda a,b,t:a+(b-a)*t
    return dict(temperature=round(lerp(1.0,0.0,u('risk')),2),
                num_predict=round(lerp(1024,4096,u('granularity'))),
                max_steps=round(lerp(4,12,(u('granularity')+u('action_mode'))/2)),
                review_max=3 if u('risk')>0.6 else 2)
for arm,ctr in (('RAW  (deployed)',False),('CENTRED (proposed)',True)):
    poles={k:{s:nrm(sub(pe[k][s]) if ctr else pe[k][s]) for s in ('low','high')} for k in PN}
    got=collections.defaultdict(list)
    for r in rows:
        v=E.get(r['title'])
        if v is None: continue
        u=nrm(sub(v) if ctr else v)
        c={k:dot(poles[k]['high'],u)-dot(poles[k]['low'],u) for k in PN}
        for kk,vv in knobs(c).items(): got[kk].append(vv)
    print(f"\n=== {arm} — knobs actually emitted across 66 briefs ===")
    for kk in ('temperature','num_predict','max_steps','review_max'):
        vals=got[kk]; d=collections.Counter(vals)
        print(f"  {kk:12s} min={min(vals):<8} max={max(vals):<8} distinct={len(d):<3} {'CONSTANT' if len(d)==1 else dict(list(d.most_common(4)))}")
