import {readFileSync} from 'fs';
const src=readFileSync('/tmp/psifix/bench.mjs','utf8');
const head=src.slice(0, src.indexOf('const nodes=buildCorpus'));
const mod=await import('data:text/javascript,'+encodeURIComponent(head+'\nexport {buildCorpus,psiFixed,poincare,meanAP,cosDist,relevant,mulberry32};'));
const {buildCorpus,psiFixed,poincare,meanAP,cosDist,relevant,mulberry32}=mod;
const D=256;
function gauss(r){const u1=Math.max(r(),1e-12),u2=r();return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);}
const unit=v=>{const n=Math.sqrt(v.reduce((a,x)=>a+x*x,0))||1;return v.map(x=>x/n);};

for(const drift of [0.55,0.95]){
  const nodes=buildCorpus(7,{branch:4,depth:5,drift});
  const rq=mulberry32(99);
  const queries=nodes.filter(n=>n.depth>=2).filter(()=>rq()<0.25);

  // FIXED psi as proposed
  const fx=new Map(nodes.map(n=>[n.id,psiFixed(n)]));
  // ABLATION 1: same radii, RANDOM directions — content removed entirely.
  const rr=mulberry32(4242);
  const rnd=new Map(nodes.map(n=>{
    const t=Math.tanh((0.9+1.05*n.depth)/2);
    return [n.id,{v:unit(Array.from({length:D},()=>gauss(rr))).map(x=>x*t)}];
  }));
  // ABLATION 2: depth only, no geometry at all.
  const depthOnly=(a,b)=>Math.abs(a.depth-b.depth);

  const A=meanAP(nodes,(a,b)=>cosDist(a,b),queries);
  const F=meanAP(nodes,(a,b)=>poincare(fx.get(a.id).v,fx.get(b.id).v),queries);
  const R=meanAP(nodes,(a,b)=>poincare(rnd.get(a.id).v,rnd.get(b.id).v),queries);
  const Z=meanAP(nodes,depthOnly,queries);
  console.log(`drift=${drift}`);
  console.log(`  Euclidean cosine (content only)      ${A.toFixed(4)}`);
  console.log(`  FIXED psi (content + depth radius)   ${F.toFixed(4)}`);
  console.log(`  ABLATION random dirs + depth radius  ${R.toFixed(4)}   <-- content removed`);
  console.log(`  ABLATION depth difference only       ${Z.toFixed(4)}   <-- no geometry at all`);
  console.log(`  => content contributes: ${(F-R).toFixed(4)} mAP over the depth-only geometry\n`);
}
