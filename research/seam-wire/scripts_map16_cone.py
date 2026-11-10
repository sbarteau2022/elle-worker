import json,os,math,statistics,collections
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
m=json.load(open(H+'/.elle/hyper-map/map.json'))
FD=A['facultyDirs']; FN=sorted(FD); D=len(FD[FN[0]])
nodes=[v for v in m['nodes'].values() if v.get('kind')=='task' and isinstance(v.get('dir'),list) and len(v['dir'])==D]
n=len(nodes); print(f"{n} task nodes, D={D}")
nm=lambda v: math.sqrt(sum(x*x for x in v)) or 1.0
u=lambda v:[x/nm(v) for x in v]
dot=lambda a,b: sum(a[i]*b[i] for i in range(D))
# the 16-d mean of the node cloud — the analogue of centreMu, which exists only in 35840-d
mu=[sum(t['dir'][i] for t in nodes)/n for i in range(D)]
print(f"‖mu16‖ = {nm(mu):.4f}   (node dirs are unit vectors)")
sub=lambda v:[v[i]-mu[i] for i in range(D)]
res={}
for arm,ctr in (('RAW',False),('CENTRED16',True)):
    F={k:u(sub(FD[k]) if ctr else FD[k]) for k in FN}
    tops=[];spreads=[];offd=[]
    for t in nodes:
        q=u(sub(t['dir']) if ctr else t['dir'])
        cs=[(dot(q,F[k]),k) for k in FN]
        cs.sort(reverse=True)
        tops.append(cs[0][1]); spreads.append(cs[0][0]-cs[-1][0])
    import itertools
    offd=[dot(F[a],F[b]) for a,b in itertools.combinations(FN,2)]
    res[arm]=tops
    print(f"\n{arm}: mean 12-cosine spread per node = {statistics.mean(spreads):.4f}")
    print(f"      mean off-diagonal cosine among the 12 faculty dirs = {statistics.mean(offd):+.4f}")
    c=collections.Counter(tops)
    print("      top-1 distribution:", {k:v for k,v in c.most_common()})
    print(f"      faculties never winning: {[k for k in FN if k not in c]}")
chg=sum(1 for a,b in zip(res['RAW'],res['CENTRED16']) if a!=b)
print(f"\n>>> top-1 faculty CHANGES under 16-d centring: {chg}/{n} = {chg/n:.1%}")
