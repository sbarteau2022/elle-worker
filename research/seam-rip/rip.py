# BIMODAL RIP — validated falsifiable seam-detector.
# Self-test:   python3 rip.py
# Real data:   python3 rip.py --csv vision.csv --col flow_mag --fps 30
import sys, csv as csvmod, numpy as np

def analytic(x):
    T=len(x); X=np.fft.fft(x); h=np.zeros(T)
    if T%2==0: h[0]=h[T//2]=1; h[1:T//2]=2
    else: h[0]=1; h[1:(T+1)//2]=2
    return np.fft.ifft(X*h)
def bandpass(x, lo, hi, fs):
    T=len(x); X=np.fft.rfft(x); f=np.fft.rfftfreq(T,1/fs)
    return np.fft.irfft(X*((f>=lo)&(f<hi)).astype(float), n=T)
def kappa(s, fs, slow=(0.5,2.0), fast=(8.0,20.0)):
    a=bandpass(s,*slow,fs); b=np.abs(analytic(bandpass(s,*fast,fs)))
    a=a-a.mean(); b=b-b.mean()
    return a,b,float(np.sum(a*b)/np.sqrt(np.sum(a*a)*np.sum(b*b)))
def rip(s, fs, n_null=1000, seed=0, label="", alpha=0.01):
    rng=np.random.default_rng(seed); a,b,r=kappa(s,fs); real=abs(r)
    null=np.empty(n_null)
    for i in range(n_null):
        bs=np.roll(b,int(rng.integers(fs,len(b)-fs)))
        null[i]=abs(np.sum(a*bs)/np.sqrt(np.sum(a*a)*np.sum(bs*bs)))
    p=(np.sum(null>=real)+1)/(n_null+1)
    v="PASS (real seam)" if p<alpha else "FAIL (null - no seam)"
    print(f"  {label:24s} kappa={real:.4f}  null_mean={null.mean():.4f}  p={p:.4f}  -> {v}")
    return p<alpha

if "--csv" in sys.argv:
    path=sys.argv[sys.argv.index("--csv")+1]
    col=sys.argv[sys.argv.index("--col")+1] if "--col" in sys.argv else "flow_mag"
    fps=float(sys.argv[sys.argv.index("--fps")+1]) if "--fps" in sys.argv else 30.0
    rows=list(csvmod.DictReader(open(path)))
    s=np.array([float(r[col]) for r in rows if r.get(col) not in (None,"")])
    print(f"REAL DATA: {path} col='{col}' fps={fps} n={len(s)}  (pass: p<0.01)"); print("-"*76)
    rip(s, fps, label=f"{col}")
    print("-"*76); print("A PASS means the slow structure organizes the fast motion. A NULL is honest.")
else:
    fs,T=100.0,30.0; t=np.arange(0,T,1/fs); g=np.random.default_rng(1)
    slow=np.sin(2*np.pi*1.0*t)
    coupled=slow+(1+0.9*slow)*np.sin(2*np.pi*12.0*t)+0.3*g.standard_normal(len(t))
    noise=g.standard_normal(len(t)); unc=np.sin(2*np.pi*1.0*t)+np.sin(2*np.pi*12.0*t)+0.3*g.standard_normal(len(t))
    print("BIMODAL RIP - self-test (pre-registered pass: p<0.01)"); print("-"*76)
    A=rip(coupled,fs,label="coupled (real seam)"); B=rip(noise,fs,label="pure noise"); C=rip(unc,fs,label="uncoupled tones")
    print("-"*76); print(f"HARNESS VALID: {A and (not B) and (not C)}")
