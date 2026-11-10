import json,os,math,collections
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
fe=A['facultyEmb']; mu=A['centreMu']; FN=sorted(fe.keys())
def sub(v): return [v[i]-mu[i] for i in range(len(v))]
def nrm(v):
    n=math.sqrt(sum(x*x for x in v)) or 1.0; return [x/n for x in v]
cen={k:nrm(sub(fe[k])) for k in FN}
def dot(a,b): return sum(a[i]*b[i] for i in range(len(a)))
print(f"{'batch':9s} {'spheres w/ all 6 rows to ONE faculty':38s} {'mean distinct dests per sphere':30s} {'hist':s}")
for batch in ['01','02','03']:
    ep=B+f'gemini-batch-{batch}.jsonl.posted.emb.json'
    if not os.path.exists(ep): continue
    E=json.load(open(ep))
    rows=[json.loads(l) for l in open(B+f'gemini-batch-{batch}.jsonl') if l.strip()]
    bysph=collections.defaultdict(list)
    for r in rows:
        v=E.get(r['title'])
        if v is None: continue
        q=nrm(sub(v))
        best=max(((dot(q,cen[k]),k) for k in FN))[1]
        bysph[r['sphere']].append(best)
    lock=sum(1 for s,d in bysph.items() if len(set(d))==1)
    dis=[len(set(d)) for d in bysph.values()]
    hist=collections.Counter()
    for d in bysph.values():
        for x in d: hist[x]+=1
    counts=sorted(hist.values(),reverse=True)
    print(f"batch-{batch}  {lock:>3d}/{len(bysph):<34d} {sum(dis)/len(dis):<30.2f} {counts}")
    if batch=='01':
        for s in sorted(bysph): print(f"      {s:26s} -> {len(set(bysph[s]))} distinct: {sorted(set(bysph[s]))}")
