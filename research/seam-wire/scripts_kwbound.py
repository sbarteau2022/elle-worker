import json,os,math,collections,itertools
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
m=json.load(open(H+'/.elle/hyper-map/map.json'))
PAIRS=[["sensory_perception","motor_praxis"],["somatic_interoception","language_semiotics"],
       ["episodic_memory","predictive_simulation"],["convergent_logic","divergent_synthesis"],
       ["valuation_salience","social_cognition"],["spatial_topography","metacognitive_regulation"]]
LEVEL={'sensory_perception':1,'motor_praxis':2,'somatic_interoception':3,'language_semiotics':4,
       'episodic_memory':5,'predictive_simulation':6,'convergent_logic':7,'divergent_synthesis':8,
       'valuation_salience':9,'social_cognition':10,'spatial_topography':11,'metacognitive_regulation':12}
COLLAPSE,MARGIN,RATIO,KW=0.06,0.02,1.3,0.12
FD=A['facultyDirs']; D=len(FD['sensory_perception'])
nodes=[v for v in m['nodes'].values() if v.get('kind')=='task' and isinstance(v.get('dir'),list) and len(v['dir'])==D]
n=len(nodes)
nm=lambda v:(math.sqrt(sum(x*x for x in v)) or 1.0); u=lambda v:[x/nm(v) for x in v]
dot=lambda a,b:sum(a[i]*b[i] for i in range(D))
F={k:u(FD[k]) for k in FD}
def outcome(coords):
    mags=sorted(((abs(c),i,c) for i,c in enumerate(coords)),reverse=True)
    (tm,ti,tc),(nx,_,_)=mags[0],mags[1]
    held=not(tm>=COLLAPSE and tm-nx>=MARGIN and tm>=RATIO*nx)
    return 0 if held else LEVEL[PAIRS[ti][0 if tc>=0 else 1]]
# a node is keyword-decidable if ANY single pair perturbed by +/-KW changes the slot
dec=0; margins=[]
for t in nodes:
    q=u(t['dir'])
    co=[dot(q,F[a])-dot(q,F[b]) for a,b in PAIRS]
    base=outcome(co)
    reach={base}
    for i in range(6):
        for d in (KW,-KW):
            c2=list(co); c2[i]=co[i]+d
            reach.add(outcome(c2))
    if len(reach)>1: dec+=1
    mags=sorted((abs(c) for c in co),reverse=True)
    margins.append(mags[0]-mags[1])
print(f"nodes: {n}")
print(f"KEYWORD-DECIDABLE (a single +/-{KW} vote changes the slot): {dec}/{n} = {dec/n:.1%}")
import statistics
print(f"\ngeometric top-vs-next margin: median {statistics.median(margins):.4f}  mean {statistics.mean(margins):.4f}")
print(f"  fraction with margin < KW ({KW}):        {sum(1 for x in margins if x<KW)/n:.1%}")
print(f"  fraction with margin < COLLAPSE (0.06):  {sum(1 for x in margins if x<COLLAPSE)/n:.1%}")
tops=[max(abs(c) for c in [dot(u(t['dir']),F[a])-dot(u(t['dir']),F[b]) for a,b in PAIRS]) for t in nodes]
print(f"\nleading |coord| (the quantity COLLAPSE=0.06 gates): median {statistics.median(tops):.4f}")
print(f"  fraction below the 0.06 gate on geometry alone: {sum(1 for x in tops if x<COLLAPSE)/n:.1%}")
print(f"  ...of which a {KW} keyword vote could lift over it: {sum(1 for x in tops if x<COLLAPSE<=x+KW)/n:.1%} of all nodes")
