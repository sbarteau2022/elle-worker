import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import type {Env} from './index';
import {ingestAnchorObservation,readAnchorIntakeMap,type AnchorIntake} from './anchor-intake';
import {recoverAnchor} from './anchor-ledger';
it('measured residual passes through PFAR/PAMI into gated map and exact-reference recovery',async()=>{
  const sql=new DatabaseSync(':memory:');
  let failIntake=false;
  const db={prepare(query:string){
    const statement=()=>sql.prepare(query);
    function bound(args:any[]=[]):any {return {bind(...next:any[]){return bound(next)},
      async run(){if(failIntake && query.includes('INSERT INTO elle_anchor_intake')) throw new Error('injected persistence failure');statement().run(...args);return {success:true}},
      async first(){return statement().get(...args)??null},async all(){return {results:statement().all(...args)}}};}
    return bound();
  }, async batch(stmts:any[]){
    sql.exec('BEGIN');try {const rows=[];for(const s of stmts) rows.push(await s.run());sql.exec('COMMIT');return rows;}
    catch(e){sql.exec('ROLLBACK');throw e;}
  }};
  const env={DB:db} as unknown as Env;
  try {
    const samples=Array.from({length:64},(_,i)=>Math.sin(i*.2));
    const input:AnchorIntake={source:'lab-0',content:'Measured exception: pressure changes boiling '+ 'detail '.repeat(800),samples,prediction:samples.map(x=>x*.5),
      proposal:{id:'water',sphere:1,expectedVersion:0,statement:'Boiling depends on pressure',kappa:.8,
        exceptions:['Altitude changes the result'], evidence:Array.from({length:8},(_,i)=>({source:`lab-${i}`,reference:`reference-${i}`,supports:true}))}};
    const result=await ingestAnchorObservation(env,input);
    expect(result.accepted).toBe(true);
    expect(result.geometry.residual[10]).toBe(samples[10]*.5);
    expect(result.geometry.index.phases).toHaveLength(8);
    expect(result.geometry.ball).toHaveLength(128);
    expect(Math.hypot(...result.geometry.ball)).toBeLessThan(1);
    expect((await readAnchorIntakeMap(env))).toHaveLength(1);
    const recall=await recoverAnchor(env,'water',.1);
    expect(recall.recovered.some(e=>e.content===input.content && e.complete)).toBe(true);
    expect(input.content.length).toBeGreaterThan(4000); // full source survives the PAMI preview truncation
    expect(recall.unresolved).toHaveLength(7); // never pretend the other references were recovered
    const rejected=await ingestAnchorObservation(env,{...input,proposal:{...input.proposal,expectedVersion:1,kappa:.1}});
    expect(rejected.accepted).toBe(false);
    expect((await readAnchorIntakeMap(env))[0].memory_id).toBe(result.memoryId);
    expect(sql.prepare('SELECT COUNT(*) as n FROM elle_anchor_intake').get()?.n).toBe(2);
    failIntake=true;
    await expect(ingestAnchorObservation(env,{...input,proposal:{...input.proposal,expectedVersion:1}})).rejects.toThrow('injected persistence failure');
    expect(sql.prepare('SELECT COUNT(*) as n FROM elle_anchor_events').get()?.n).toBe(2);
    expect((await readAnchorIntakeMap(env))[0].memory_id).toBe(result.memoryId);
  } finally {sql.close()}
});
