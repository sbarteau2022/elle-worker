import math,random
F,C=1024,4096
def wts(items,tau):
    t=max(1e-6,tau or 0.25)
    return [math.exp((a*(k if k is not None else 0.5))/t) for a,k in items]
def fixed(items,pool=None,tau=0.25):
    """Floor is guaranteed to everyone; the SURPLUS above n*FLOOR is what gets
    allocated by affinity. Conserving and always feasible for F*n <= pool <= C*n."""
    n=len(items)
    if not n: return []
    total=max(F*n,pool or F*n); total=min(total,C*n)
    surplus=total-F*n
    w=wts(items,tau); free=set(range(n)); extra=[0.0]*n
    while free and surplus>1e-9:
        z=sum(w[i] for i in free) or 1
        over=[i for i in free if F+surplus*w[i]/z>C]
        if not over:
            for i in free: extra[i]=surplus*w[i]/z
            break
        for i in over: extra[i]=C-F; free.discard(i); surplus-=(C-F)
    out=[F+extra[i] for i in range(n)]
    fl=[math.floor(x) for x in out]; short=int(round(total-sum(fl)))
    for i in sorted(range(n),key=lambda i:-(out[i]-fl[i]))[:max(0,short)]: fl[i]+=1
    return fl
random.seed(11); fails=0
for _ in range(6000):
    n=random.randint(1,12)
    items=[(random.uniform(-1,3),random.choice([None,0.2,0.5,1.0])) for _ in range(n)]
    pool=random.choice([None,F*n,int(F*n*random.uniform(1,4)),C*n,int(C*n*2)])
    f=fixed(items,pool)
    exp=min(max(F*n,pool or F*n),C*n)
    if sum(f)!=exp or any(x<F or x>C for x in f): fails+=1
print(f"randomised: 6000 cases, conservation+bounds failures = {fails}\n")
AFF={'RAW near-uniform (deployed)':[0.7110,0.7900,0.8200,0.8400,0.8500,0.8628],
     'CENTRED':[-0.1187,0.0200,0.1100,0.2000,0.2800,0.3529]}
print(f"{'affinities':30s} {'pool =':>8s} {'alloc':>44s} {'max/min':>8s}")
for name,affs in AFF.items():
    items=[(a,0.5) for a in affs]
    for mult in (1,1.5,2,3,4):
        pool=int(F*len(affs)*mult); f=fixed(items,pool)
        print(f"{name if mult==1 else '':30s} {str(mult)+'x FLOOR*n':>12s} {str(f):>40s} {max(f)/min(f):8.2f}")
    print()
