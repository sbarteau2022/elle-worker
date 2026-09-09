import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessAnchor, supportBound, proposeAnchor, readAnchor, anchorHistory, recallAnchor, type AnchorProposal } from './anchor-ledger';
function proposal(overrides: Partial<AnchorProposal> = {}): AnchorProposal {
  return {id:'boiling',sphere:1,expectedVersion:0,statement:'Water boils near 100 C at one atmosphere', kappa:.8,
    evidence:Array.from({length:8},(_,i)=>({source:`lab-${i}`,reference:`measurement-${i}`,supports:true})),
    exceptions:['Pressure changes the boiling temperature'],...overrides};
}
function database(path = ':memory:') {
  const sql = new DatabaseSync(path);
  const db = {prepare(query:string) {
    const stmt = sql.prepare(query);
    function bound(args:any[] = []) { return {bind(...next:any[]) {return bound(next)},
      async run() {stmt.run(...args);return {success:true}},
      async first() {return stmt.get(...args) ?? null},
      async all() {return {results:stmt.all(...args)}}}; }
    return bound();
  }};
  return {DB:db as unknown as D1Database, close:()=>sql.close()};
}
describe('evidence-gated persistent anchors',()=>{
  it('no evidence is zero support, duplicates cannot inflate support, contradictions reduce it',()=>{
    expect(supportBound([])).toBe(0);
    const e=proposal().evidence;
    expect(supportBound([...e,...e,...e])).toBe(supportBound(e));
    expect(supportBound([...e,{...e[0],supports:false}])).toBeLessThan(supportBound(e));
    expect(assessAnchor(proposal({evidence:[]}),null).accepted).toBe(false);
  });
  it('low kappa requests recovery even with sufficient support',()=>{
    expect(assessAnchor(proposal({kappa:.1}),null).reason).toBe('recover-evidence');
    expect(()=>assessAnchor(proposal({kappa:NaN}),null)).toThrow();
  });
  it('persists accepted revisions, preserves exceptions, retains rejected observations',async()=>{
    const env=database();try {
      expect((await proposeAnchor(env,proposal())).accepted).toBe(true);
      const changed=proposal({expectedVersion:1,statement:'Pressure-dependent boiling relation',exceptions:[]});
      expect((await proposeAnchor(env,changed)).accepted).toBe(true);
      expect((await readAnchor(env,'boiling'))?.exceptions).toEqual(proposal().exceptions);
      const weak=proposal({expectedVersion:2,statement:'Boiling is always 100 C', evidence:[], exceptions:['High-altitude counterexample']});
      expect((await proposeAnchor(env,weak)).accepted).toBe(false);
      expect((await readAnchor(env,'boiling'))?.version).toBe(2);
      expect((await anchorHistory(env,'boiling')).length).toBe(3);
      expect(JSON.stringify(await anchorHistory(env,'boiling'))).toContain('High-altitude counterexample');
      expect((await proposeAnchor(env,changed)).reason).toBe('stale-version');
    } finally {env.close()}
  });
  it('changed statements cannot inherit support for different statements',()=>{
    const initial=assessAnchor(proposal(),null).state!;
    expect(assessAnchor(proposal({expectedVersion:1,statement:'An unrelated claim',evidence:[]}),initial).accepted).toBe(false);
  });
});

it('survives a database reopen and concurrent writers cannot both revise the same version', async()=>{
  mkdirSync('.anchor-test', {recursive:true});
  const folder=mkdtempSync('.anchor-test/reopen-'); const path=join(folder,'anchors.sqlite');
  let env=database(path);
  try {
    await proposeAnchor(env,proposal()); env.close(); env=database(path);
    expect((await readAnchor(env,'boiling'))?.version).toBe(1);
    const results=await Promise.all([proposeAnchor(env,proposal({expectedVersion:1})),proposeAnchor(env,proposal({expectedVersion:1}))]);
    expect(results.filter(r=>r.accepted)).toHaveLength(1);
    expect((await readAnchor(env,'boiling'))?.version).toBe(2);
  } finally {env.close();rmSync(folder,{recursive:true});}
});
it('pressure: twelve spheres retain exceptions through 240 accepted and rejected proposals', async()=>{
  const env=database(); const observations: unknown[] = [];
  try {
    for(let sphere=1;sphere<=12;sphere++) {
      const id=`sphere-${sphere}`;
      for(let step=0;step<20;step++) {
        const before=await readAnchor(env,id), version=before?.version ?? 0;
        const good=step%2===0;
        const result=await proposeAnchor(env,proposal({id,sphere,expectedVersion:version,
          kappa:good?.8:.1, exceptions:[`exception-${sphere}-${step}`]}));
        expect(result.accepted).toBe(good);
        observations.push({sphere,step,expectedAcceptance:good,...result});
      }
      expect((await readAnchor(env,id))?.version).toBe(10);
      const history=await anchorHistory(env,id);
      expect(history).toHaveLength(20);
      for(let step=0;step<20;step++) expect(JSON.stringify(history)).toContain(`exception-${sphere}-${step}`);
    }
    if(process.env.ATLAS_PRESSURE_REPORT) writeFileSync(process.env.ATLAS_PRESSURE_REPORT, JSON.stringify({
      protocol:'synthetic ledger pressure; not learned semantic accuracy',spheres:12,proposals:240,
      accepted:observations.filter((x:any)=>x.accepted).length,observations},null,2));
  } finally {env.close()}
});

it('recall surfaces rejected exceptions and lowers support after counterevidence without rewriting the claim',async()=>{
  const env=database();try {
    await proposeAnchor(env,proposal());
    const before=await recallAnchor(env,'boiling',.8);
    expect(before.action).toBe('retrieve');
    await proposeAnchor(env,proposal({expectedVersion:1,kappa:.1,
      evidence:proposal().evidence.map(e=>({...e,supports:false})), exceptions:['New conflicting measurement']}));
    const after=await recallAnchor(env,'boiling',.8);
    expect(after.action).toBe('recover-evidence');
    expect(after.supportLowerBound).toBeLessThan(before.supportLowerBound);
    expect(after.anchor?.version).toBe(1);
    expect(after.exceptions).toContain('New conflicting measurement');
  } finally {env.close()}
});
