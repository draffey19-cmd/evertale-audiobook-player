const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createTranscription}=require('../ai-transcription.cjs');

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function until(check){
 const end=Date.now()+5000;
 while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,10));}
 assert.fail('Timed out waiting for transcription');
}
async function harness(t,overrides={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'evertale-ai-test-'));
 const handlers=new Map(),events=[],children=[],app=new EventEmitter();
 app.getPath=()=>dir;
 let loaded=true,loads=0,requests=0;
 const model=path.join(dir,'speech.bin');await fs.writeFile(model,'fixture');
 await fs.writeFile(path.join(dir,'vibe-config.json'),JSON.stringify({model}));
 const books=[{id:'book',tracks:[{key:'a',duration:270},{key:'b',duration:90}]}];
 const spawn=(command,args)=>{
  const child=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;
  child.kill=()=>{child.killed=true;if(!overrides.holdClose)setImmediate(()=>child.emit('close',null));};
  children.push(child);
  if(overrides.spawn)return overrides.spawn(child,command,args);
  setImmediate(async()=>{try{await fs.writeFile(args.at(-1),'wave fixture');child.emit('close',0);}catch(e){child.emit('error',e);}});
  return child;
 };
 const fetch=async(url,opts={})=>{
  if(url.endsWith('/v1/models/load')){loads++;if(overrides.load)await overrides.load(opts);loaded=!overrides.loadNotReady;return json({status:'loaded'});}
  if(url.endsWith('/v1/models')){
   if(overrides.probe)return overrides.probe();
   return json({data:loaded?[{id:overrides.modelName||'speech.bin'}]:[]});
  }
  assert.ok(url.endsWith('/v1/audio/transcriptions'));requests++;
  assert.equal(opts.body.get('response_format'),'verbose_json');
  assert.equal(opts.body.get('file').type,'audio/wav');
  if(overrides.transcribe)return overrides.transcribe(opts,requests);
  return json({segments:[{start:1.25,end:3.5,text:'  A searchable phrase  '}]});
 };
 createTranscription({app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getWindow:()=>({isDestroyed:()=>false,webContents:{send:(_,s)=>events.push(s)}}),getBooks:()=>books,getTrackPath:()=>path.join(dir,'audio.mp3')},{fetch,spawn});
 const call=(name,...args)=>handlers.get(name)(null,...args);
 t.after(async()=>{app.emit('before-quit');for(const child of children)child.emit('close',null);await new Promise(r=>setTimeout(r,30));await fs.rm(dir,{recursive:true,force:true});});
 return {dir,app,call,events,children,books,setLoaded:value=>{loaded=value;},get loads(){return loads;},get requests(){return requests;}};
}

test('manual sections prioritize playback, persist absolute seconds, search and resume without duplicates',async t=>{
 const h=await harness(t);
 await h.call('ai-transcript-start','book',0,{position:100});
 await until(()=>h.events.some(e=>e.state==='completed'));
 let data=await h.call('ai-transcript-get','book',0);
 assert.deepEqual(data.completedChunks,[1]);
 assert.deepEqual(data.segments,[{start:91.25,end:93.5,text:'A searchable phrase'}]);
 assert.deepEqual(await h.call('ai-transcript-search','book','SEARCHABLE'),[{track:0,...data.segments[0]}]);
 await h.call('ai-transcript-start','book',0,{position:100});
 await until(()=>h.events.filter(e=>e.state==='completed').length===2);
 data=await h.call('ai-transcript-get','book',0);
 assert.deepEqual(data.completedChunks,[1,2]);
 assert.equal(data.segments.length,2);
 assert.equal((await h.call('ai-transcript-status')).state,'completed');
 assert.equal((await fs.readdir(path.join(h.dir,'ai-transcripts'))).filter(n=>n.endsWith('.wav')).length,0);
});

test('automatic mode processes each section once and finishes',async t=>{
 const h=await harness(t);
 await h.call('ai-auto-start','book',0,100);
 await until(()=>h.events.some(e=>e.message==='All sections of this track transcribed'));
 assert.deepEqual((await h.call('ai-transcript-get','book',0)).completedChunks,[0,1,2]);
 assert.equal(h.requests,3);
});

for(const mode of ['ai-transcript-start','ai-auto-start'])test(`${mode}: cancel during setup prevents later audio work`,async t=>{
 const gate=deferred(),entered=deferred();
 const h=await harness(t,{load:async()=>{entered.resolve();await gate.promise;}});h.setLoaded(false);
 const starting=h.call(mode,'book',0,mode==='ai-auto-start'?0:{});
 await entered.promise;
 if(mode==='ai-transcript-start')await assert.rejects(h.call(mode,'book',0,{}),/Another transcription/);
 await h.call('ai-transcript-cancel');gate.resolve();
 assert.equal((await starting).state,'cancelled');
 await new Promise(r=>setTimeout(r,30));
 assert.equal(h.children.length,0);assert.equal(h.requests,0);
 assert.equal((await h.call('ai-transcript-status')).state,'cancelled');
});

test('stop retains worker ownership until ffmpeg closes',async t=>{
 const h=await harness(t,{holdClose:true,spawn:child=>child});
 await h.call('ai-transcript-start','book',0,{});await until(()=>h.children.length===1);
 await h.call('ai-transcript-cancel');
 await assert.rejects(h.call('ai-transcript-start','book',0,{}),/Another transcription/);
 assert.equal(h.children[0].killed,true);
 h.children[0].emit('close',null);
 await new Promise(r=>setTimeout(r,30));
 await h.call('ai-transcript-start','book',0,{});await until(()=>h.children.length===2);
 assert.equal(await h.call('ai-transcript-get','book',0),null);
});

test('cancel during response parsing does not mark a section completed',async t=>{
 const gate=deferred(),entered=deferred();
 const h=await harness(t,{transcribe:async()=>({ok:true,json:async()=>{entered.resolve();return gate.promise;}})});
 await h.call('ai-transcript-start','book',0,{});await entered.promise;
 await h.call('ai-transcript-cancel');gate.resolve({segments:[{start:0,end:1,text:'late'}]});
 await new Promise(r=>setTimeout(r,30));
 assert.equal(await h.call('ai-transcript-get','book',0),null);
 assert.equal((await h.call('ai-transcript-status')).state,'cancelled');
});

test('model loading is shared by concurrent setup requests',async t=>{
 const gate=deferred(),entered=deferred();
 const h=await harness(t,{load:async()=>{entered.resolve();await gate.promise;}});h.setLoaded(false);
 const a=h.call('ai-vibe-ready');await entered.promise;const b=h.call('ai-vibe-ready');gate.resolve();
 assert.deepEqual(await Promise.all([a,b]),[{ready:true},{ready:true}]);assert.equal(h.loads,1);
});

test('selected model replaces a different loaded model',async t=>{
 const h=await harness(t,{modelName:'old.bin'});
 await h.call('ai-vibe-ready');assert.equal(h.loads,1);
});

test('successful load without a reported model is an error',async t=>{
 const h=await harness(t,{loadNotReady:true});h.setLoaded(false);
 await assert.rejects(h.call('ai-vibe-ready'),/did not report a loaded model/);
});

for(const payload of [{text:'missing timestamps'},{segments:[{start:-1,end:2,text:'invalid'}]},{segments:[{start:2,end:1,text:'invalid'}]}])test(`invalid response ${JSON.stringify(payload)} remains retryable`,async t=>{
 const h=await harness(t,{transcribe:()=>json(payload)});
 await h.call('ai-transcript-start','book',0,{});await until(()=>h.events.some(e=>e.state==='error'));
 assert.equal(await h.call('ai-transcript-get','book',0),null);
 assert.equal((await fs.readdir(path.join(h.dir,'ai-transcripts'))).length,0);
});

test('HTTP errors leave no completed section and stop automatic work',async t=>{
 const h=await harness(t,{transcribe:()=>json({error:'busy'},429)});
 await h.call('ai-auto-start','book',0,0);await until(()=>h.events.some(e=>e.state==='error'));
 assert.match((await h.call('ai-transcript-status')).message,/HTTP 429/);
 assert.equal(await h.call('ai-transcript-get','book',0),null);assert.equal(h.requests,1);
});

test('quit kills an active conversion and prevents its result being saved',async t=>{
 const h=await harness(t,{spawn:child=>child});
 await h.call('ai-transcript-start','book',0,{});await until(()=>h.children.length===1);
 h.app.emit('before-quit');assert.equal(h.children[0].killed,true);
 await new Promise(r=>setTimeout(r,30));assert.equal(h.requests,0);
});

test('invalid book and track inputs fail before engine work',async t=>{
 const h=await harness(t);
 await assert.rejects(h.call('ai-transcript-start','missing',0,{}),/Audiobook not found/);
 await assert.rejects(h.call('ai-transcript-start','book',-1,{}),/Invalid track/);
 assert.equal(h.requests,0);assert.equal(h.children.length,0);
});

test('automatic replacement waits for aborted work and transcribes the new track',async t=>{
 const entered=deferred();
 const h=await harness(t,{transcribe:(opts,count)=>{
  if(count>1)return json({segments:[{start:0,end:1,text:'New track'}]});
  entered.resolve();return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}));
 }});
 await h.call('ai-auto-start','book',0,0);await entered.promise;
 await h.call('ai-auto-start','book',1,0);
 await until(()=>h.events.some(e=>e.message==='All sections of this track transcribed'&&e.track===1));
 assert.equal(await h.call('ai-transcript-get','book',0),null);
 assert.deepEqual((await h.call('ai-transcript-get','book',1)).completedChunks,[0]);
 assert.equal(h.requests,2);
});

test('server spawn errors are reported and a malformed model listing is rejected',async t=>{
 const h=await harness(t,{probe:()=>json({data:'not a model list'}),spawn:child=>{setImmediate(()=>child.emit('error',Error('Executable cannot start')));return child;}});
 await h.call('ai-vibe-config',{binary:path.join(h.dir,'speech.bin')});
 await assert.rejects(h.call('ai-vibe-ready'),/Executable cannot start/);
 assert.equal(h.children.length,1);
});

test('nonfinite playback position is normalized before selecting a section',async t=>{
 const h=await harness(t);
 await h.call('ai-transcript-start','book',0,{position:Infinity});
 await until(()=>h.events.some(e=>e.state==='completed'));
 assert.deepEqual((await h.call('ai-transcript-get','book',0)).completedChunks,[0]);
});

test('whole-book queue shares worker ownership and preserves automatic-listening exclusion',async t=>{
 const h=await harness(t);await h.call('ai-book-start','book');
 await assert.rejects(h.call('ai-auto-start','book',0,0),/Pause the whole-book/);
 await assert.rejects(h.call('ai-transcript-start','book',0,{}),/Another transcription/);
 await until(async()=>(await h.call('ai-book-status')).state==='completed');
 assert.deepEqual((await h.call('ai-transcript-get','book',0)).completedChunks,[0,1,2]);
 assert.deepEqual((await h.call('ai-transcript-get','book',1)).completedChunks,[0]);
 assert.equal(h.requests,4);
});
