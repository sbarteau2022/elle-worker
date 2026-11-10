import json,os,numpy as np
H=os.path.expanduser('~')
A=json.load(open(H+'/.elle/hyper-map/atlas13.json'))
B=H+'/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/briefs/'
PAIRS=[["sensory_perception","motor_praxis"],["somatic_interoception","language_semiotics"],
       ["episodic_memory","predictive_simulation"],["convergent_logic","divergent_synthesis"],
       ["valuation_salience","social_cognition"],["spatial_topography","metacognitive_regulation"]]
COL,MAR,RAT=0.06,0.02,1.3
mu=np.array(A['centreMu'],dtype=np.float32)
FN=sorted(A['facultyEmb']); FE=np.array([A['facultyEmb'][k] for k in FN],dtype=np.float32)
idx={k:i for i,k in enumerate(FN)}
unit=lambda M: M/np.linalg.norm(M,axis=-1,keepdims=True)
for batch in ('01','02','03'):
    p=B+f'gemini-batch-{batch}.jsonl'; e=p+'.posted.emb.json'
    if not (os.path.exists(p) and os.path.exists(e)):
        print(f"batch-{batch}: unreadable/absent"); continue
    try:
        E=json.load(open(e)); rows=[json.loads(l) for l in open(p) if l.strip()]
    except Exception as ex:
        print(f"batch-{batch}: {type(ex).__name__}"); continue
    keep=[r for r in rows if r['title'] in E]
    V=np.array([E[r['title']] for r in keep],dtype=np.float32)
    gold=[r['sphere'] for r in keep]
    print(f"\n=== batch-{batch}  n={len(keep)}  (KW_WEIGHT = 0, pure geometry) ===")
    for arm,ctr in (('RAW',False),('CENTRED',True)):
        F=unit(FE-mu if ctr else FE); Q=unit(V-mu if ctr else V)
        S=Q@F.T
        co=np.stack([S[:,idx[a]]-S[:,idx[b]] for a,b in PAIRS],axis=1)
        m=np.abs(co); order=np.argsort(-m,axis=1); ar=np.arange(len(co))
        top=m[ar,order[:,0]]; nxt=m[ar,order[:,1]]
        held=~((top>=COL)&(top-nxt>=MAR)&(top>=RAT*nxt))
        pole=[PAIRS[order[i,0]][0 if co[i,order[i,0]]>=0 else 1] for i in ar]
        hit=sum(1 for i in ar if not held[i] and pole[i]==gold[i])
        wrong=sum(1 for i in ar if not held[i] and pole[i]!=gold[i])
        ceil=sum(1 for i in ar if pole[i]==gold[i])
        n=len(co)
        print(f"  {arm:8s} hit {hit:3d}  held {int(held.sum()):3d}  wrong {wrong:3d}   top-1 acc(ceiling) {ceil/n:.3f}   released-acc {hit/max(1,n-held.sum()):.3f}")
print("\nRECORDED with keywords (routing-diagnose, batch-01): RAW top-1 0.227 -> CENTRED 0.621")
