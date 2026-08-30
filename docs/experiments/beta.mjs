import {readFileSync} from 'fs';
const src=readFileSync('/tmp/psifix/bench.mjs','utf8');
const head=src.slice(0, src.indexOf('const nodes=buildCorpus'));
const mod=await import('data:text/javascript,'+encodeURIComponent(head+'\nexport {buildCorpus,poincare,meanAP,cosDist,mulberry32};'));
const {buildCorpus,poincare,meanAP,cosDist,mulberry32}=mod;
const D=256;
function gauss(r){const u1=Math.max(r(),1e-12),u2=r();return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);}
const unit=v=>{const n=Math.sqrt(v.reduce((a,x)=>a+x*x,0))||1;return v.map(x=>x/n);};

const nodes=buildCorpus(7,{branch:4,depth:5,drift:0.55});
const rq=mulberry32(99);
const queries=nodes.filter(n=>n.depth>=2).filter(()=>rq()<0.25);
const A=meanAP(nodes,(a,b)=>cosDist(a,b),queries);
console.log(`Euclidean cosine baseline: ${A.toFixed(4)}\n`);
console.log('rho0  beta |  psi mAP  ablated  content-share | vs Euclid');
console.log('-----------+--------------------------------+----------');
for(const rho0 of [0.5,1.0]){
 for(const beta of [0.0,0.05,0.15,0.35,0.7,1.05]){
  const emb=new Map(nodes.map(n=>{const t=Math.tanh((rho0+beta*n.depth)/2);return [n.id,n.content.map(x=>x*t)];}));
  const rr=mulberry32(4242);
  const abl=new Map(nodes.map(n=>{const t=Math.tanh((rho0+beta*n.depth)/2);return [n.id,unit(Array.from({length:D},()=>gauss(rr))).map(x=>x*t)];}));
  const F=meanAP(nodes,(a,b)=>poincare(emb.get(a.id),emb.get(b.id)),queries);
  const R=meanAP(nodes,(a,b)=>poincare(abl.get(a.id),abl.get(b.id)),queries);
  const share=F>0?100*(F-R)/F:0;
  console.log(` ${rho0.toFixed(1)}  ${beta.toFixed(2)} |  ${F.toFixed(4)}  ${R.toFixed(4)}   ${share.toFixed(0).padStart(3)}%          | ${F>A?'+':''}${(100*(F-A)/A).toFixed(0)}%`);
 }
}
