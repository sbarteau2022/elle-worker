import json,os,math
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
fe=A['facultyEmb']; mu=A['centreMu']; FN=sorted(fe.keys())
def nrm(v):
    n=math.sqrt(sum(x*x for x in v)) or 1.0; return [x/n for x in v]
def dot(a,b): return sum(a[i]*b[i] for i in range(len(a)))
mun=nrm(mu); munorm=math.sqrt(sum(x*x for x in mu))
# raw top-1 win counts measured earlier (batch-02/03 identical)
wins={'convergent_logic':15,'motor_praxis':19,'metacognitive_regulation':13,'predictive_simulation':9,
      'spatial_topography':6,'episodic_memory':2,'valuation_salience':2,'divergent_synthesis':0,
      'language_semiotics':0,'sensory_perception':0,'social_cognition':0,'somatic_interoception':0}
rows=[]
for k in FN:
    v=fe[k]; vn=nrm(v)
    rows.append((k, dot(vn,mun), math.sqrt(sum(x*x for x in v)), wins.get(k,0)))
rows.sort(key=lambda r:-r[1])
print(f"‖mu‖ = {munorm:.3f}   (centreMu_meta n={A['centreMu_meta']['n']})\n")
print(f"{'faculty':28s} {'cos(f, mu)':>11s} {'‖f‖':>10s} {'raw top-1 wins (b03)':>21s}")
for k,c,n,w in rows:
    mark='  <-- NEVER LABELLED' if k=='convergent_logic' else ''
    print(f"{k:28s} {c:11.4f} {n:10.2f} {w:21d}{mark}")
# rank correlation between cos-to-mu and win count
import statistics
def spearman(xs,ys):
    def rank(a):
        s=sorted(range(len(a)),key=lambda i:a[i]); r=[0]*len(a)
        for pos,i in enumerate(s): r[i]=pos
        return r
    rx,ry=rank(xs),rank(ys); n=len(xs)
    mx,my=statistics.mean(rx),statistics.mean(ry)
    num=sum((rx[i]-mx)*(ry[i]-my) for i in range(n))
    den=math.sqrt(sum((rx[i]-mx)**2 for i in range(n))*sum((ry[i]-my)**2 for i in range(n)))
    return num/den if den else 0
cs=[r[1] for r in rows]; ws=[r[3] for r in rows]
print(f"\nSpearman( cos-to-mean , raw top-1 wins ) = {spearman(cs,ws):+.3f}  over 12 faculties")
print(f"convergent_logic rank by cos-to-mean: {[r[0] for r in rows].index('convergent_logic')+1} of 12")
