# PHASE-EIGHT — does the lemniscate EMERGE, or did someone draw it?
#
# A figure-eight in a phase portrait IS 2:1 phase-locking between a slow and a
# fast mode (Lissajous 1:2). This tests whether that lock is real — present in
# the data and destroyed by a circular-shift null — or a coincidence.
#
# The statistic is the n:m phase-locking value  PLV = |<exp(i(n*phi_s - m*phi_f))>|
# (Tass et al. 1998), with n:m = 2:1. Null: circular-shift the fast phase past
# one period and recompute. p = fraction of null >= real. A PASS means the slow
# mode organizes the fast mode's phase. A NULL is honest — no eight emerged.
#
#   self-test:  python3 phase_eight.py
#   real data:  python3 phase_eight.py --csv vision.csv --slow yaw --fast flow_mag --fps 30
#   with plot:  add  --json out.json   (dumps stats + phase-portrait points)
#
# HONEST LIMIT: a shift-null cannot tell coupling from a perfectly tuned, eternal
# 2:1 coincidence between two independent PURE tones — for two pure sinusoids the
# shift only adds a constant phase and PLV stays 1. It bites precisely because real
# oscillators have their own phase dynamics; when the fast mode drifts on its own,
# shifting decorrelates it. So this asks "does the lock survive the fast mode's own
# wandering," which is the question worth asking of real signal.
import sys, json, csv as csvmod, numpy as np

def analytic(x):
    T=len(x); X=np.fft.fft(x); h=np.zeros(T)
    if T%2==0: h[0]=h[T//2]=1; h[1:T//2]=2
    else: h[0]=1; h[1:(T+1)//2]=2
    return np.fft.ifft(X*h)
def bandpass(x, lo, hi, fs):
    T=len(x); X=np.fft.rfft(x); f=np.fft.rfftfreq(T,1/fs)
    return np.fft.irfft(X*((f>=lo)&(f<hi)).astype(float), n=T)
def iphase(x, band, fs):
    return np.angle(analytic(bandpass(x, band[0], band[1], fs)))

def nm_plv(ps, pf, n=2, m=1):
    return float(abs(np.mean(np.exp(1j*(n*ps - m*pf)))))

def test(slow_sig, fast_sig, fs, slow_band, fast_band, n=2, m=1,
         n_null=1000, seed=0):
    ps = iphase(np.asarray(slow_sig,float), slow_band, fs)
    pf = iphase(np.asarray(fast_sig,float), fast_band, fs)
    real = nm_plv(ps, pf, n, m)
    rng = np.random.default_rng(seed); L=len(pf); lo=int(fs)
    null=np.empty(n_null)
    for i in range(n_null):
        sh=int(rng.integers(lo, L-lo))
        null[i]=nm_plv(ps, np.roll(pf, sh), n, m)
    p=(np.sum(null>=real)+1)/(n_null+1)
    # phase-portrait points: x=sin(phi_s), y=sin(phi_f) -> a stable eight if locked
    step=max(1, L//1400)
    x=np.sin(ps)[::step]; y=np.sin(pf)[::step]
    return {"plv":real, "null_mean":float(null.mean()), "p":float(p),
            "xy":[[round(float(a),4),round(float(b),4)] for a,b in zip(x,y)]}

def verdict(r, alpha=0.01):
    return "PASS (an eight emerged)" if r["p"]<alpha else "NULL (no eight — honest)"

if "--csv" in sys.argv:
    a=sys.argv
    path=a[a.index("--csv")+1]
    slow=a[a.index("--slow")+1] if "--slow" in a else "yaw"
    fast=a[a.index("--fast")+1] if "--fast" in a else "flow_mag"
    fps=float(a[a.index("--fps")+1]) if "--fps" in a else 30.0
    rows=list(csvmod.DictReader(open(path)))
    def col(c): return np.array([float(r[c]) for r in rows if r.get(c) not in (None,"")])
    s=col(slow); f=col(fast); n=min(len(s),len(f)); s,f=s[:n],f[:n]
    # bands: slow around its dominant low frequency; fast = the 2x octave above it
    sb=(0.3, 2.0); fb=(2.0, 6.0)
    r=test(s,f,fps,sb,fb)
    print(f"REAL DATA {path}: slow='{slow}' fast='{fast}' fps={fps} n={n}")
    print("-"*68)
    print(f"  2:1 PLV={r['plv']:.4f}  null={r['null_mean']:.4f}  p={r['p']:.4f}  -> {verdict(r)}")
    if "--json" in a:
        json.dump({"real":{**r,"label":f"{slow} x {fast}","verdict":verdict(r)}},
                  open(a[a.index("--json")+1],"w"))
else:
    fs,T=100.0,40.0; t=np.arange(0,T,1/fs); N=len(t); g=np.random.default_rng(3)
    def wander_phase(base, wstd, gen):
        # an oscillator whose instantaneous frequency slowly random-walks:
        # this is what makes the shift-null valid — a pure tone can't be tested.
        w=gen.standard_normal(N); k=int(fs*3)
        w=np.convolve(w, np.ones(k)/k, mode='same'); w/= (w.std()+1e-9)
        f=np.clip(base + wstd*w, base*0.4, base*1.7)
        return f, 2*np.pi*np.cumsum(f)/fs
    sb=(0.35,1.7); fb=(1.7,3.4)
    # shared slow mode with its OWN wandering frequency (not a tone)
    f_s, phi_s = wander_phase(1.0, 0.12, g)
    slow=np.sin(phi_s)+0.10*g.standard_normal(N)
    # LOCKED: fast rigidly tracks 2*phi_s despite the wander -> a real 2:1 lock
    locked=np.sin(2*phi_s + 0.6)+0.10*g.standard_normal(N)
    # DRIFT: fast is its OWN wandering oscillator near 2x -> ratio not held
    _, phi_d = wander_phase(2.0, 0.24, g)
    drift=np.sin(phi_d)+0.10*g.standard_normal(N)
    # NOISE: both bands are noise
    noise_s=g.standard_normal(N); noise_f=g.standard_normal(N)

    cases=[("locked 2:1 (coupled)", slow, locked),
           ("drift (same octave, own phase)", slow, drift),
           ("noise", noise_s, noise_f)]
    out={}
    print("PHASE-EIGHT — self-test (pre-registered pass: p<0.01)"); print("-"*68)
    for name,ssig,fsig in cases:
        r=test(ssig,fsig,fs,sb,fb)
        r["label"]=name; r["verdict"]=verdict(r); out[name]=r
        print(f"  {name:34s} PLV={r['plv']:.4f}  null={r['null_mean']:.4f}  p={r['p']:.4f}  -> {r['verdict']}")
    ok = out[cases[0][0]]["p"]<0.01 and out[cases[1][0]]["p"]>=0.01 and out[cases[2][0]]["p"]>=0.01
    print("-"*68); print(f"HARNESS VALID: {ok}")
    if "--json" in sys.argv:
        json.dump(out, open(sys.argv[sys.argv.index("--json")+1],"w"))
