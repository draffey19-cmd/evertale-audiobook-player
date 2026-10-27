const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const bundledFfmpeg=require('ffmpeg-static');
const {createBookQueue}=require('./book-transcription.cjs');
const bundledFfmpegPath=appPath=>appPath&&appPath.includes('app.asar')?appPath.replace('app.asar','app.asar.unpacked'):appPath;
function createTranscription({app,ipcMain,getWindow,getBooks,getTrackPath},dependencies={}){
 const spawn=dependencies.spawn||require('node:child_process').spawn;
 const fetch=dependencies.fetch||globalThis.fetch;
 const base=path.join(app.getPath('userData'),'ai-transcripts');
 let job=null;
 let bookQueue=null;
 const endpoint='http://127.0.0.1:3030';
 const configPath=path.join(app.getPath('userData'),'vibe-config.json');
 let server=null;
 let starting=null;
 let loading=null;
 let loadedSettings=null;
 let request=0,pending=null,lastStatus={state:'idle'},quitting=false;
 const config=async()=>{try{return JSON.parse(await fs.readFile(configPath,'utf8'));}catch{return {};}};
 const probe=async()=>{try{const r=await fetch(endpoint+'/v1/models',{signal:AbortSignal.timeout(1500)});if(!r.ok)return null;const data=await r.json();return Array.isArray(data?.data)?data:null;}catch{return null;}};
 async function ensureServer(){
  if(quitting)throw Error('Application is closing');
  const current=await probe();if(current)return current;
  if(starting)return starting;
  starting=(async()=>{
   const {binary}=await config();
   if(!binary)throw Error('Choose the vibe-server.exe file in EverTale first.');
   await fs.access(binary);
   if(quitting)throw Error('Application is closing');
   const child=spawn(binary,['serve','--host','127.0.0.1','--port','3030'],{windowsHide:true,stdio:'ignore'});
   server=child;
   let failure=null;
   child.on('error',e=>{failure=e;if(server===child)server=null;});
   child.on('exit',()=>{if(server===child)server=null;});
   for(let i=0;i<40&&!quitting;i++){
    await new Promise(resolve=>setTimeout(resolve,250));
    const state=await probe();if(state)return state;
    if(server!==child)break;
   }
   if(server===child){child.kill();server=null;}
   throw Error('Vibe server did not start. '+(failure?.message||'Check the selected vibe-server.exe.'));
  })();
  try{return await starting;}finally{starting=null;}
 }
 async function ensureModel(){
  if(loading)return loading;
  loading=loadModel();
  try{return await loading;}finally{loading=null;}
 }
 async function loadModel(){
  const state=await ensureServer();
  const {model,noGpu=false,gpuDevice=-1}=await config();
  const signature=JSON.stringify({model,noGpu,gpuDevice});
  if(state.data.length&&(!model||state.data.some(m=>m.id===path.basename(model)))&&(loadedSettings===signature||loadedSettings===null&&!noGpu&&gpuDevice===-1))return state;
  if(!model)throw Error('Choose a downloaded speech model in EverTale first.');
  await fs.access(model);
  const response=await fetch(endpoint+'/v1/models/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:model,gpu_device:gpuDevice,no_gpu:noGpu}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('Vibe model loading failed: '+(await response.text()).slice(0,400));
  const ready=await probe();
  if(!ready?.data?.length)throw Error('Vibe did not report a loaded model after setup.');
  loadedSettings=signature;
  return ready;
 }
 ipcMain.handle('ai-vibe-config',async(_,changes)=>{
  if(changes){
   if(job||pending!==null||bookQueue?.isActive()||loading)throw Error('Pause or stop transcription and wait for the current section before changing Vibe settings');
   const old=await config(),next={...old};
   for(const field of ['binary','model','fallbackModel'])if(typeof changes[field]==='string')next[field]=changes[field];
   if(typeof changes.noGpu==='boolean')next.noGpu=changes.noGpu;
   if(Number.isInteger(changes.gpuDevice)&&changes.gpuDevice>=-1&&changes.gpuDevice<=31)next.gpuDevice=changes.gpuDevice;
   await fs.writeFile(configPath,JSON.stringify(next,null,2));
  }
  return config();
 });
 ipcMain.handle('ai-vibe-ready',async()=>{await ensureModel();return {ready:true};});
 ipcMain.handle('ai-vibe-devices',async()=>{
  const {binary}=await config();if(!binary)throw Error('Choose a Vibe executable first');
  return new Promise((resolve,reject)=>{
   const child=spawn(binary,['devices'],{windowsHide:true}),timer=setTimeout(()=>{child.kill();reject(Error('Device detection timed out'));},10000);
   let output='';child.stdout?.on('data',d=>{output=(output+d).slice(-32000);});child.stderr?.on('data',()=>{});
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('Vibe device detection failed');const devices=JSON.parse(output);if(!Array.isArray(devices))throw Error('Invalid device response');resolve(devices);}catch(e){reject(e);}});
  });
 });
 app.on('before-quit',()=>{quitting=true;request++;pending=null;auto=null;stop();if(server){server.kill();server=null;}});

 ipcMain.handle('ai-engine-status',async()=>{
  const data=await probe();const settings=await config();
  return {installed:!!data,ready:!!data?.data?.length,configured:!!settings.binary&&!!settings.model,engine:'Vibe local server'};
 });
 const CHUNK=90;
 const seconds=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
 const emit=s=>{lastStatus=s;const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('ai-transcription-status',s);};
 const key=(id,track)=>crypto.createHash('sha256').update(id+':'+track).digest('hex').slice(0,32);
 const file=(id,track)=>path.join(base,key(id,track)+'.json');
 const read=async(id,track)=>{try{return JSON.parse(await fs.readFile(file(id,track),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const resolve=(id,track)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');if(!Number.isInteger(track)||track<0||track>=b.tracks.length)throw Error('Invalid track');const source=getTrackPath(b.tracks[track].key);if(!source)throw Error('Audio file unavailable');return {b,source};};
 const save=async(id,track,data)=>{await fs.mkdir(base,{recursive:true});const dest=file(id,track),tmp=dest+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,dest);};
 ipcMain.handle('ai-transcript-get',async(_,id,track)=>{resolve(id,track);return read(id,track);});
 ipcMain.handle('ai-transcript-search',async(_,id,query)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');const q=String(query||'').trim().toLowerCase();if(!q)return [];const found=[];for(let i=0;i<b.tracks.length;i++){const data=await read(id,i);for(const s of data?.segments||[]){if(s.text.toLowerCase().includes(q))found.push({track:i,start:s.start,end:s.end,text:s.text});if(found.length>=100)return found;}}return found;});
 let auto=null;
 const status=()=>lastStatus;
 ipcMain.handle('ai-transcript-status',status);
 function stop(){if(job){job.cancelled=true;job.child?.kill();job.controller?.abort();}}
 ipcMain.handle('ai-transcript-cancel',async()=>{request++;pending=null;auto=null;stop();if(bookQueue?.isActive())await bookQueue.cancel();emit({state:'cancelled',message:'Transcription stopped'});return true;});
 const optionsFor=async()=> {
  await ensureModel();
  return {ffmpeg:dependencies.ffmpeg||bundledFfmpegPath(bundledFfmpeg)||'ffmpeg'};
 };
 function processChild(task,command,args){
  return new Promise((resolve,reject)=>{
   if(task.cancelled)return reject(Error('Cancelled'));
   let stderr='';const child=spawn(command,args,{windowsHide:true});task.child=child;
   child.stderr?.on('data',d=>{stderr=(stderr+d).slice(-1800);});
   child.on('error',reject);
   child.on('close',code=>{if(task.cancelled)return reject(Error('Cancelled'));code===0?resolve():reject(Error('Process exited '+code+': '+stderr));});
  });
 }
 async function transcribeChunk(task,id,track,chunk,opts){
  const {source}=resolve(id,track);
  const start=chunk*CHUNK;
  const wav=path.join(base,'job-'+crypto.randomUUID()+'.wav');
  try{
   task.status={state:'running',id,track,chunk,percent:0,message:'Preparing audio '+Math.floor(start/60)+'m-'+Math.floor((start+CHUNK)/60)+'m...'};emit(task.status);
   await processChild(task,opts.ffmpeg,['-nostdin','-y','-ss',String(start),'-i',source,'-t',String(CHUNK),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
   if(task.cancelled)throw Error('Cancelled');
   task.status={...task.status,percent:35,message:'Transcribing '+Math.floor(start/60)+'m-'+Math.floor((start+CHUNK)/60)+'m...'};emit(task.status);
   const form=new FormData();
   form.append('file',new Blob([await fs.readFile(wav)],{type:'audio/wav'}),'section.wav');
   form.append('response_format','verbose_json');
   if(task.cancelled)throw Error('Cancelled');
   const controller=new AbortController();task.controller=controller;
   const response=await fetch(endpoint+'/v1/audio/transcriptions',{method:'POST',body:form,signal:controller.signal});
   if(!response.ok)throw Error('Vibe transcription failed: HTTP '+response.status+' '+(await response.text()).slice(0,300));
   if(task.cancelled)throw Error('Cancelled');
   const raw=await response.json();
   if(task.cancelled)throw Error('Cancelled');
   if(!Array.isArray(raw.segments))throw Error('Vibe returned no timestamped segments; section was not saved.');
   const segments=raw.segments.map(s=>{
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<s.start||s.end>CHUNK+1||typeof s.text!=='string')throw Error('Vibe returned invalid transcript segments; section was not saved.');
    return {start:start+s.start,end:start+s.end,text:s.text.trim()};
   }).filter(s=>s.text);
   const previous=await read(id,track)||{id,track,createdAt:new Date().toISOString(),segments:[],completedChunks:[]};
   const completed=new Set(previous.completedChunks||[]);
   if(task.cancelled)throw Error('Cancelled');
   if(!completed.has(chunk)){
    previous.segments=[...previous.segments,...segments].sort((a,b)=>a.start-b.start);
    completed.add(chunk);previous.completedChunks=[...completed].sort((a,b)=>a-b);
    await save(id,track,previous);
   }
   if(task.cancelled)throw Error('Cancelled');
   task.status={state:'completed',id,track,chunk,percent:100,message:'Saved transcript section at '+Math.floor(start/60)+'m',segments:segments.length};emit(task.status);
  }finally{await fs.rm(wav,{force:true}).catch(()=>{});}
 }
 async function runChunk(id,track,chunk,opts){
  if(job)return false;
  const task={cancelled:false,child:null,status:{state:'running',id,track,percent:0,message:'Preparing transcription...'}};
  const session=auto;
  job=task;emit(task.status);
  try{await fs.mkdir(base,{recursive:true});if(task.cancelled)throw Error('Cancelled');await ensureModel();if(task.cancelled)throw Error('Cancelled');await transcribeChunk(task,id,track,chunk,opts);}
  catch(e){if(!task.cancelled){task.status={state:'error',id,track,message:e.message};emit(task.status);if(auto===session)auto=null;}}
  finally{if(job===task)job=null;if(auto)setImmediate(pump);}
  return !task.cancelled&&task.status.state==='completed';
 }
 async function nextChunk(id,track,position){
  const {b}=resolve(id,track);
  position=seconds(position);
  const length=seconds(b.tracks[track].duration);
  const max=length>0?Math.ceil(length/CHUNK):Math.max(1,Math.ceil((Number(position)||0)/CHUNK)+1);
  const data=await read(id,track);
  const completed=new Set(data?.completedChunks||[]);
  const focus=Math.min(max-1,Math.max(0,Math.floor(position/CHUNK)));
  // Current section first, then nearby sections, then the rest of the track.
  for(let distance=0;distance<max;distance++){
   const forward=focus+distance,backward=focus-distance;
   if(forward<max&&!completed.has(forward))return forward;
   if(backward>=0&&!completed.has(backward))return backward;
  }
  return null;
 }
 async function pump(){
  if(!auto||job)return;
  const session=auto;
  const {id,track,position}=session;
  try{
   const chunk=await nextChunk(id,track,position);
   if(auto!==session)return;
   if(session.track!==track||session.position!==position){setImmediate(pump);return;}
   if(chunk===null){emit({state:'completed',id:session.id,track:session.track,percent:100,message:'All sections of this track transcribed'});auto=null;return;}
   await runChunk(session.id,session.track,chunk,session.opts);
  }catch(e){if(auto===session){auto=null;emit({state:'error',message:e.message});}}
 }
 ipcMain.handle('ai-auto-start',async(_,id,track,position,options={})=>{
  if(bookQueue?.isActive())throw Error('Pause the whole-book queue before enabling automatic listening');
  resolve(id,track);const token=++request;pending=token;auto=null;stop();
  emit({state:'running',id,track,percent:0,message:'Preparing Vibe...'});
  let opts;
  try{opts=await optionsFor(options);}catch(e){if(token===request){pending=null;emit({state:'error',id,track,message:e.message});}throw e;}
  if(token!==request)return {state:'cancelled',message:'Transcription stopped'};
  pending=null;
  auto={id,track,position:seconds(position),opts};
  if(job){job.cancelled=true;job.child?.kill();job.controller?.abort();}else setImmediate(pump);
  return {state:'running',message:'Automatic background transcription enabled'};
 });
 ipcMain.handle('ai-auto-position',(_,id,track,position)=>{
  if(!auto||auto.id!==id)return false;
  resolve(id,track);
  const changed=auto.track!==track||Math.abs(auto.position-seconds(position))>=CHUNK*2;
  auto.track=track;auto.position=seconds(position);
  if(changed&&job&&(job.status.track!==track||Math.abs((job.status.chunk||0)*CHUNK-auto.position)>=CHUNK*3)){job.cancelled=true;job.child?.kill();job.controller?.abort();}
  if(!job)setImmediate(pump);
  return true;
 });
 ipcMain.handle('ai-transcript-start',async(_,id,track,options={})=>{
  resolve(id,track);if(job||auto||pending!==null||bookQueue?.isActive())throw Error('Another transcription is running');
  const token=++request;pending=token;
  emit({state:'running',id,track,percent:0,message:'Preparing Vibe...'});
  try{
  const opts=await optionsFor(options);
  const chunk=await nextChunk(id,track,seconds(options.position));
  if(token!==request)return {state:'cancelled',message:'Transcription stopped'};
  if(chunk===null){const done={state:'completed',id,track,percent:100,message:'Track already transcribed'};emit(done);return done;}
  void runChunk(id,track,chunk,opts);
  return {state:'running',id,track,percent:0,message:'Transcribing a 90-second section...'};
  }catch(e){if(token===request)emit({state:'error',id,track,message:e.message});throw e;}
  finally{if(pending===token)pending=null;}
 });
 bookQueue=createBookQueue({app,ipcMain,getBooks,read,prepare:optionsFor,
  isBusy:()=>!!job,canStart:()=>!auto&&pending===null,
  cancelWorker:stop,
  run:async(id,track,chunk)=>({ok:await runChunk(id,track,chunk,{ffmpeg:dependencies.ffmpeg||bundledFfmpegPath(bundledFfmpeg)||'ffmpeg'}),message:lastStatus.message}),
  emit:s=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('ai-book-status',s);}
 });
 app.on('before-quit',()=>{void bookQueue.pause().catch(console.error);});
}
module.exports={createTranscription};
