import json,os,math,collections
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
m=json.load(open(H+'/.elle/hyper-map/map.json'))
PAIRS=[["sensory_perception","motor_praxis"],["somatic_interoception","language_semiotics"],
       ["episodic_memory","predictive_simulation"],["convergent_logic","divergent_synthesis"],
       ["valuation_salience","social_cognition"],["spatial_topography","metacognitive_regulation"]]
LEVEL={'sensory_perception':1,'motor_praxis':2,'somatic_interoception':3,'language_semiotics':4,
       'episodic_memory':5,'predictive_simulation':6,'convergent_logic':7,'divergent_synthesis':8,
       'valuation_salience':9,'social_cognition':10,'spatial_topography':11,'metacognitive_regulation':12}
COLLAPSE,MARGIN,RATIO=0.06,0.02,1.3
FD=A['facultyDirs']; D=len(FD['sensory_perception'])
nodes=[v for v in m['nodes'].values() if v.get('kind')=='task' and isinstance(v.get('dir'),list) and len(v['dir'])==D]
n=len(nodes)
nm=lambda v:(math.sqrt(sum(x*x for x in v)) or 1.0)
u=lambda v:[x/nm(v) for x in v]
dot=lambda a,b:sum(a[i]*b[i] for i in range(D))
mu=[sum(t['dir'][i] for t in nodes)/n for i in range(D)]
sub=lambda v:[v[i]-mu[i] for i in range(D)]
def slots(ctr):
    F={k:u(sub(FD[k]) if ctr else FD[k]) for k in FD}
    out=[]
    for t in nodes:
        q=u(sub(t['dir']) if ctr else t['dir'])
        coords=[dot(q,F[a])-dot(q,F[b]) for a,b in PAIRS]
        mags=sorted(((abs(c),i,c) for i,c in enumerate(coords)),reverse=True)
        (tm,ti,tc),(nx,_,_)=mags[0],mags[1]
        held = not (tm>=COLLAPSE and tm-nx>=MARGIN and tm>=RATIO*nx)
        out.append(0 if held else LEVEL[PAIRS[ti][0 if tc>=0 else 1]])
    return out
dep={l['level']:l.get('n',0) for l in A['levels'] if l.get('level',0)>0}
for arm,ctr in (('RAW (no keyword vote)',False),('CENTRED-16 (no keyword vote)',True)):
    s=slots(ctr); c=collections.Counter(s)
    central=c[0]; insph=n-central
    print(f"\n=== {arm} ===")
    print(f"  central(held) {central}   in spheres {insph}   (DEPLOYED: 604 / 623)")
    print(f"  {'lvl':>3s} {'sphere':26s} {'mine':>6s} {'deployed':>9s}")
    for k,v in sorted(LEVEL.items(),key=lambda x:x[1]):
        print(f"  {v:3d} {k:26s} {c.get(v,0):6d} {dep.get(v,0):9d}")
    globals()['s_'+('c' if ctr else 'r')]=s
chg=sum(1 for a,b in zip(s_r,s_c) if a!=b)
print(f"\n>>> slot CHANGES raw -> centred-16: {chg}/{n} = {chg/n:.1%}")
mv=collections.Counter((a,b) for a,b in zip(s_r,s_c) if a!=b)
print("    largest movements (from -> to, count):",[(f"{a}->{b}",v) for (a,b),v in mv.most_common(6)])
