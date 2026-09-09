import json,os,math,collections
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
fe=A['facultyEmb']; mu=A['centreMu']; FN=sorted(fe.keys())
def sub(v): return [v[i]-mu[i] for i in range(len(v))]
def nrm(v):
    n=math.sqrt(sum(x*x for x in v)) or 1.0
    return [x/n for x in v]
raw={k:nrm(fe[k]) for k in FN}
cen={k:nrm(sub(fe[k])) for k in FN}
def dot(a,b): return sum(a[i]*b[i] for i in range(len(a)))

for batch in ['01','02','03']:
    ep=B+f'gemini-batch-{batch}.jsonl.posted.emb.json'
    if not os.path.exists(ep): continue
    E=json.load(open(ep))
    rows=[json.loads(l) for l in open(B+f'gemini-batch-{batch}.jsonl') if l.strip()]
    stats={}
    for arm,facs,ctr in (('RAW',raw,False),('CENTRED',cen,True)):
        r1=collections.Counter(); top3=collections.Counter(); stolen=collections.Counter(); n=0
        for r in rows:
            v=E.get(r['title'])
            if v is None: continue
            n+=1
            q=nrm(sub(v)) if ctr else nrm(v)
            sc=sorted(((dot(q,facs[k]),k) for k in FN), reverse=True)
            r1[sc[0][1]]+=1
            for _,k in sc[:3]: top3[k]+=1
            if sc[0][1]=='convergent_logic': stolen[r['sphere']]+=1
        stats[arm]=(n,r1,top3,stolen)
    print(f"\n=== batch-{batch}  (n={stats['RAW'][0]}) ===")
    print(f"{'faculty':28s} {'RAW r1':>7s} {'CEN r1':>7s} {'RAW t3':>7s} {'CEN t3':>7s}")
    for k in FN:
        mark=' <-- NEVER LABELLED' if k=='convergent_logic' else ''
        print(f"{k:28s} {stats['RAW'][1][k]:7d} {stats['CENTRED'][1][k]:7d} {stats['RAW'][2][k]:7d} {stats['CENTRED'][2][k]:7d}{mark}")
    for arm in ('RAW','CENTRED'):
        n,r1,t3,st=stats[arm]
        print(f"  {arm}: convergent_logic wins {r1['convergent_logic']}/{n} = {r1['convergent_logic']/n:.1%}, top3 {t3['convergent_logic']}/{n} = {t3['convergent_logic']/n:.1%}")
        if st: print(f"       steals from: {dict(st.most_common())}")
