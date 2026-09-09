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
poles={k:{s:nrm(sub(pe[k][s])) for s in ('low','high')} for k in PN}   # CENTRED
coords=collections.defaultdict(list)
for r in rows:
    v=E.get(r['title'])
    if v is None: continue
    u=nrm(sub(v))
    for k in PN: coords[k].append(dot(poles[k]['high'],u)-dot(poles[k]['low'],u))
stats={k:(statistics.mean(coords[k]),statistics.pstdev(coords[k])) for k in PN}
print("per-axis calibration from batch-01 (centred):")
for k in PN:
    m,s=stats[k]; print(f"  {k:16s} mean={m:+.5f} sd={s:.5f}   scale needed for +/-1 at 2.5sd = {1/(2.5*s):8.1f}x")
def knobs(c):
    cl=lambda k:max(-1,min(1,c.get(k,0) or 0)); u=lambda k:(cl(k)+1)/2
    lerp=lambda a,b,t:a+(b-a)*t
    return dict(temperature=round(lerp(1.0,0.0,u('risk')),2),
                num_predict=round(lerp(1024,4096,u('granularity'))),
                max_steps=round(lerp(4,12,(u('granularity')+u('action_mode'))/2)),
                review_max=3 if u('risk')>0.6 else 2)
for label,tf in (('CENTRED, no rescale (proposed fix 1 only)', lambda k,x: x),
                 ('CENTRED + z-score/2.5 rescale',            lambda k,x: max(-1,min(1,(x-stats[k][0])/(2.5*stats[k][1]))))):
    got=collections.defaultdict(list)
    n=len(coords[PN[0]])
    for i in range(n):
        c={k:tf(k,coords[k][i]) for k in PN}
        for kk,vv in knobs(c).items(): got[kk].append(vv)
    print(f"\n=== {label} ===")
    for kk in ('temperature','num_predict','max_steps','review_max'):
        vals=got[kk]; d=collections.Counter(vals)
        rng={'temperature':(0.0,1.0),'num_predict':(1024,4096),'max_steps':(4,12),'review_max':(2,3)}[kk]
        pct=100*(max(vals)-min(vals))/(rng[1]-rng[0])
        print(f"  {kk:12s} min={min(vals):<7} max={max(vals):<7} distinct={len(d):<3} uses {pct:5.1f}% of designed range"
              + ("   <-- 3 NOW REACHABLE" if kk=='review_max' and 3 in d else ""))
