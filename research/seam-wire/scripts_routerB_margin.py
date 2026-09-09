import json,os,numpy as np
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
PAIRS=[["sensory_perception","motor_praxis"],["somatic_interoception","language_semiotics"],
       ["episodic_memory","predictive_simulation"],["convergent_logic","divergent_synthesis"],
       ["valuation_salience","social_cognition"],["spatial_topography","metacognitive_regulation"]]
KW,COL=0.12,0.06
mu=np.array(A['centreMu'],dtype=np.float32)
FN=sorted(A['facultyEmb']); FE=np.array([A['facultyEmb'][k] for k in FN],dtype=np.float32)
idx={k:i for i,k in enumerate(FN)}
E=json.load(open(B+'gemini-batch-01.jsonl.posted.emb.json'))
rows=[json.loads(l) for l in open(B+'gemini-batch-01.jsonl') if l.strip()]
V=np.array([E[r['title']] for r in rows if r['title'] in E],dtype=np.float32)
def unit(M): return M/np.linalg.norm(M,axis=-1,keepdims=True)
print(f"{'arm':9s} {'median margin':>14s} {'median |lead|':>14s} {'margin<0.12':>12s} {'margin<0.06':>12s} {'kw-decidable':>13s}")
out={}
for arm,ctr in (('RAW',False),('CENTRED',True)):
    F=unit(FE-mu if ctr else FE); Q=unit(V-mu if ctr else V)
    S=Q@F.T                                   # (n,12) cosines
    co=np.stack([S[:,idx[a]]-S[:,idx[b]] for a,b in PAIRS],axis=1)   # (n,6)
    mg=np.sort(np.abs(co),axis=1)[:,::-1]
    margin=mg[:,0]-mg[:,1]; lead=mg[:,0]
    # keyword-decidable: does +/-KW on any single pair change the collapse outcome?
    def outcome(c):
        m=np.abs(c); order=np.argsort(-m,axis=1)
        top=m[np.arange(len(c)),order[:,0]]; nxt=m[np.arange(len(c)),order[:,1]]
        held=~((top>=COL)&(top-nxt>=0.02)&(top>=1.3*nxt))
        sgn=c[np.arange(len(c)),order[:,0]]>=0
        return np.where(held,-1,order[:,0]*2+(~sgn))
    base=outcome(co); dec=np.zeros(len(co),dtype=bool)
    for i in range(6):
        for d in (KW,-KW):
            c2=co.copy(); c2[:,i]+=d
            dec |= (outcome(c2)!=base)
    n=len(co)
    print(f"{arm:9s} {np.median(margin):14.4f} {np.median(lead):14.4f} "
          f"{(margin<KW).mean():11.1%} {(margin<COL).mean():11.1%} {dec.mean():12.1%}")
    out[arm]=(float(np.median(margin)),float(dec.mean()))
print(f"\nRouter A (16-d, stored map, n=1227): median margin 0.0282, kw-decidable 100.0%")
print(f"Router B (35840-d, batch-01, n={len(V)}): median margin {out['CENTRED'][0]:.4f} centred, kw-decidable {out['CENTRED'][1]:.1%}")
