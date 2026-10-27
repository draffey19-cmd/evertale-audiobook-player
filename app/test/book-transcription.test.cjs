const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createTestDirectory}=require('./helpers.cjs');
const {createBookQueue}=require('../book-transcription.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(fn){const end=Date.now()+4000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Queue timeout');}
async function setup(t,options={}){
 const dir=await createTestDirectory('evertale-book-test-');
 if(options.saved)await fs.writeFile(path.join(dir,'ai-book-queue.json'),JSON.stringify(options.saved));
 const handlers=new Map(),events=[],calls=[],completed=new Map([[0,new Set(options.completed||[])],[1,new Set()]]);
 let active=0,maxActive=0,cancelled=0;
 const queue=createBookQueue({app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)},
  getBooks:()=>[{id:'b',title:'Fixture book',tracks:options.tracks||[{duration:181},{duration:89}]}],
  read:async(id,track)=>({completedChunks:[...completed.get(track)||[]]}),
  prepare:options.prepare||(()=>Promise.resolve()),isBusy:()=>active>0,canStart:()=>options.canStart!==false,cancelWorker:()=>{cancelled++;options.cancel?.();},retryDelay:1,
  run:async(id,track,chunk)=>{active++;maxActive=Math.max(active,maxActive);calls.push([track,chunk]);try{const result=options.run?await options.run(track,chunk,calls.length):{ok:true};if(result.ok)completed.get(track).add(chunk);return result;}finally{active--;}},
  emit:s=>events.push(s)
 });
 const call=(name,...args)=>handlers.get('ai-book-'+name)(null,...args);
 t.after(async()=>{await queue.pause();await new Promise(r=>setTimeout(r,30));await fs.rm(dir,{recursive:true,force:true});});
 return {dir,call,events,calls,completed,get maxActive(){return maxActive;},get cancelled(){return cancelled;}};
}
test('whole book traverses sections and tracks, skips saved gaps, and persists completion',async t=>{
 const h=await setup(t,{completed:[1]});await h.call('start','b');
 await until(async()=>(await h.call('status')).state==='completed');
 assert.deepEqual(h.calls,[[0,0],[0,2],[1,0]]);assert.equal(h.maxActive,1);
 const state=JSON.parse(await fs.readFile(path.join(h.dir,'ai-book-queue.json')));
 assert.equal(state.done,4);assert.equal(state.total,4);assert.equal(state.percent,100);
 await h.call('start','b');await until(async()=>(await h.call('status')).state==='completed');assert.equal(h.calls.length,3);
});
test('pause saves current section, resume continues, and competing starts are rejected',async t=>{
 const gate=deferred();const h=await setup(t,{run:async()=>{if(!h.calls.length||h.calls.length===1)await gate.promise;return {ok:true};}});
 await h.call('start','b');await until(()=>h.calls.length===1);
 await assert.rejects(h.call('start','b'),/already running/);
 assert.equal((await h.call('pause')).state,'paused');gate.resolve();await new Promise(r=>setTimeout(r,30));
 assert.equal(h.calls.length,1);assert.equal(h.cancelled,0);
 await h.call('resume');await until(async()=>(await h.call('status')).state==='completed');
 assert.deepEqual(h.calls,[[0,0],[0,1],[0,2],[1,0]]);assert.equal(h.maxActive,1);
});
test('cancellation interrupts only owned work and leaves unsaved section retryable',async t=>{
 const gate=deferred();const h=await setup(t,{run:async()=>{await gate.promise;return {ok:false,message:'Cancelled'};},cancel:()=>gate.resolve()});
 await h.call('start','b');await until(()=>h.calls.length===1);await h.call('cancel');
 await new Promise(r=>setTimeout(r,30));assert.equal(h.cancelled,1);assert.equal(h.completed.get(0).size,0);
 assert.equal((await h.call('status')).state,'cancelled');
});
test('cancel during setup prevents section processing',async t=>{
 const gate=deferred(),entered=deferred();const h=await setup(t,{prepare:async()=>{entered.resolve();await gate.promise;}});
 await h.call('start','b');await entered.promise;await h.call('cancel');gate.resolve();await new Promise(r=>setTimeout(r,30));
 assert.equal(h.calls.length,0);assert.equal((await h.call('status')).state,'cancelled');
});
test('interrupted persisted sessions recover paused, never silently restart',async t=>{
 const h=await setup(t,{saved:{id:'b',state:'running',done:1},completed:[0]});
 assert.equal((await h.call('status')).state,'paused');assert.equal(h.calls.length,0);
 await h.call('resume');await until(async()=>(await h.call('status')).state==='completed');assert.deepEqual(h.calls,[[0,1],[0,2],[1,0]]);
});
test('busy responses retry within a bound and permanent errors stop with recovery state',async t=>{
 const h=await setup(t,{run:async()=>({ok:false,message:'Vibe transcription failed: HTTP 429 busy'})});
 await h.call('start','b');await until(async()=>(await h.call('status')).state==='error');
 assert.equal(h.calls.length,4);assert.equal(h.completed.get(0).size,0);
 assert.equal(JSON.parse(await fs.readFile(path.join(h.dir,'ai-book-queue.json'))).state,'error');
});
test('unknown durations and unavailable books fail without skipping tracks or starting inference',async t=>{
 const h=await setup(t,{tracks:[{duration:0}]});await assert.rejects(h.call('start','missing'),/not found/);
 await h.call('start','b');await until(async()=>(await h.call('status')).state==='error');
 assert.match((await h.call('status')).message,/no known duration/);assert.equal(h.calls.length,0);
});
