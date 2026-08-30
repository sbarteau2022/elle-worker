// Does depth-in-radius psi beat Euclidean recall on hierarchical memory?
// Fair test: all arms see the SAME content vectors; both Euclidean arms also
// see depth, so a hyperbolic win cannot come from extra information.
const D = 256;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){const u1=Math.max(r(),1e-12),u2=r();return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);}
const norm=v=>Math.sqrt(v.reduce((a,x)=>a+x*x,0));
const unit=v=>{const n=norm(v)||1;return v.map(x=>x/n);};
const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};

// ---- corpus: a derivation hierarchy. Children inherit parent content + drift.
// Models what Elle actually stores: a summary derived from a paper, a v2
// superseding a v1 — the child shares most of the parent's content.
function buildCorpus(seed, {branch=4, depth=5, drift=0.55}={}){
  const r=mulberry32(seed); const nodes=[];
  const mk=(parent,d,path)=>{
    let content;
    if(!parent){ content=unit(Array.from({length:D},()=>gauss(r))); }
    else {
      const noise=Array.from({length:D},()=>gauss(r));
      content=unit(parent.content.map((x,i)=>x*(1-drift)+noise[i]*drift));
    }
    const n={id:path, depth:d, content, parent:parent?parent.id:null, path};
    nodes.push(n);
    if(d<depth) for(let b=0;b<branch;b++) mk(n,d+1,`${path}.${b}`);
    return n;
  };
  mk(null,0,'r');
  return nodes;
}

// ---- the three arms -------------------------------------------------------
const cosDist=(a,b)=>1-dot(a.content,b.content);

// Euclidean + depth: depth appended as an extra weighted coordinate, the
// natural way a flat index would use the same metadata.
function cosDepthDist(a,b,w){
  const dd=(a.depth-b.depth)/8;
  return 1-(dot(a.content,b.content)+w*(1-Math.abs(dd)))/(1+w);
}

// SHIPPED psi: radius from the leaf-count norm cap -> constant, per the spec.
function psiShipped(n){ const r=Math.tanh(0.9); return {v:n.content.map(x=>x*r), rho:2*Math.atanh(r)}; }

// FIXED psi: direction from content, RADIUS FROM DERIVATION DEPTH.
// rho = rho0 + beta*d, so ||psi|| = tanh(rho/2) and radial_depth = rho exactly.
function psiFixed(n,{rho0=0.9,beta=1.05}={}){
  const rho=rho0+beta*n.depth;
  const t=Math.tanh(rho/2);
  return {v:n.content.map(x=>x*t), rho};
}
function poincare(u,v){
  let d2=0,nu=0,nv=0;
  for(let i=0;i<u.length;i++){const t=u[i]-v[i];d2+=t*t;nu+=u[i]*u[i];nv+=v[i]*v[i];}
  const a=1-nu,b=1-nv; if(a<=0||b<=0) return Infinity;
  return Math.acosh(1+2*d2/(a*b));
}

// ---- ground truth: same-subtree relevance, defined by the TREE, never by any
// metric under test.
function relevant(q,n){ return n.id!==q.id && (n.id.startsWith(q.parent+'.') || q.id.startsWith(n.id+'.') || n.id===q.parent); }

function meanAP(nodes, distFn, queries){
  let tot=0;
  for(const q of queries){
    const scored=nodes.filter(n=>n.id!==q.id).map(n=>({n,d:distFn(q,n)})).sort((a,b)=>a.d-b.d);
    let hits=0,ap=0,rel=0;
    for(const n of nodes) if(relevant(q,n)) rel++;
    if(!rel) continue;
    scored.forEach((s,i)=>{ if(relevant(q,s.n)){hits++;ap+=hits/(i+1);} });
    tot+=ap/rel;
  }
  return tot/queries.length;
}

const nodes=buildCorpus(7);
const rq=mulberry32(99);
const queries=nodes.filter(n=>n.depth>=2).filter(()=>rq()<0.25);
console.log(`corpus: ${nodes.length} nodes, depth 0-5, branch 4 · queries: ${queries.length}`);

const shipped=new Map(nodes.map(n=>[n.id,psiShipped(n)]));
const fixed=new Map(nodes.map(n=>[n.id,psiFixed(n)]));

const arms={
 'A  Euclidean cosine (incumbent)':            (a,b)=>cosDist(a,b),
 'B  Euclidean cosine + depth feature':        (a,b)=>cosDepthDist(a,b,0.5),
 'C  Hyperbolic, SHIPPED psi (const radius)':  (a,b)=>poincare(shipped.get(a.id).v, shipped.get(b.id).v),
 'D  Hyperbolic, FIXED psi (depth radius)':    (a,b)=>poincare(fixed.get(a.id).v, fixed.get(b.id).v),
};
console.log('\nmAP on same-subtree retrieval (higher is better)');
const res={};
for(const [k,f] of Object.entries(arms)){ const m=meanAP(nodes,f,queries); res[k]=m; console.log(`  ${k.padEnd(44)} ${m.toFixed(4)}`); }
const A=res['A  Euclidean cosine (incumbent)'], Dh=res['D  Hyperbolic, FIXED psi (depth radius)'];
console.log(`\n  fixed psi vs incumbent: ${(100*(Dh-A)/A).toFixed(1)}% relative mAP`);
console.log(`  radial depth spread (fixed): rho ${Math.min(...nodes.map(n=>fixed.get(n.id).rho)).toFixed(2)} .. ${Math.max(...nodes.map(n=>fixed.get(n.id).rho)).toFixed(2)}`);
console.log(`  radial depth spread (shipped): rho ${shipped.get(nodes[0].id).rho.toFixed(6)} (constant)`);
