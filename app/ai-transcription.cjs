const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const bundledFfmpeg=require('ffmpeg-static');
const bundledFfmpegPath=appPath=>appPath&&appPath.includes('app.asar')?appPath.replace('app.asar','app.asar.unpacked'):appPath;
function createTranscription({app,ipcMain,getWindow,getBooks,getTrackPath}){
 const base=path.join(app.getPath('userData'),'ai-transcripts');
 let job=null;
 const endpoint='http://127.0.0.1:3030';
 ipcMain.handle('ai-engine-status',async()=>{
  try{const response=await fetch(endpoint+'/v1/models',{signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();return {installed:true,ready:!!data.data?.length,engine:'Vibe local server'};}
  catch{return {installed:false,ready:false,engine:'Vibe local server'};}
 });
 const CHUNK=90;
 const emit=s=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('ai-transcription-status',s);};
 const key=(id,track)=>crypto.createHash('sha256').update(id+':'+track).digest('hex').slice(0,32);
 const file=(id,track)=>path.join(base,key(id,track)+'.json');
 const read=async(id,track)=>{try{return JSON.parse(await fs.readFile(file(id,track),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const resolve=(id,track)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');if(!Number.isInteger(track)||track<0||track>=b.tracks.length)throw Error('Invalid track');const source=getTrackPath(b.tracks[track].key);if(!source)throw Error('Audio file unavailable');return {b,source};};
 const save=async(id,track,data)=>{await fs.mkdir(base,{recursive:true});const dest=file(id,track),tmp=dest+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,dest);};
 ipcMain.handle('ai-transcript-get',async(_,id,track)=>{resolve(id,track);return read(id,track);});
 ipcMain.handle('ai-transcript-search',async(_,id,query)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');const q=String(query||'').trim().toLowerCase();if(!q)return [];const found=[];for(let i=0;i<b.tracks.length;i++){const data=await read(id,i);for(const s of data?.segments||[]){if(s.text.toLowerCase().includes(q))found.push({track:i,start:s.start,end:s.end,text:s.text});if(found.length>=100)return found;}}return found;});
 let auto=null;
 const status=()=>job?.status||{state:'idle'};
 ipcMain.handle('ai-transcript-status',status);
 function stop(){if(job){job.cancelled=true;job.child?.kill();job.controller?.abort();job.controller?.abort();job.controller?.abort();}job=null;}
 ipcMain.handle('ai-transcript-cancel',()=>{auto=null;stop();emit({state:'cancelled',message:'Transcription stopped'});return true;});
 const optionsFor=async()=> {
  const response=await fetch(endpoint+'/v1/models',{signal:AbortSignal.timeout(3000)}).catch(()=>null);
  if(!response?.ok)throw Error('Vibe server is not running at 127.0.0.1:3030. Start vibe-server serve --port 3030.');
  const data=await response.json();
  if(!data.data?.length)throw Error('Vibe server is running, but no speech model is loaded. Load a model in Vibe first.');
  return {ffmpeg:bundledFfmpegPath(bundledFfmpeg)||'ffmpeg'};
 };
 function processChild(task,command,args){
  return new Promise((resolve,reject)=>{
   let stderr='';const child=spawn(command,args,{windowsHide:true});task.child=child;
   child.stderr?.on('data',d=>{stderr=(stderr+d).slice(-1800);});
   child.on('error',reject);
   child.on('close',code=>{if(task.cancelled)return reject(Error('Cancelled'));code===0?resolve():reject(Error('Process exited '+code+': '+stderr));});
  });
 }
 async function transcribeChunk(task,id,track,chunk,opts){
  const {source}=resolve(id,track);
  const start=chunk*CHUNK;
  const output=path.join(base,'job-'+crypto.randomUUID());
  const wav=output+'.wav';
  try{
   task.status={state:'running',id,track,chunk,percent:0,message:'Preparing audio '+Math.floor(start/60)+'m–'+Math.floor((start+CHUNK)/60)+'m…'};emit(task.status);
   await processChild(task,opts.ffmpeg,['-nostdin','-y','-ss',String(start),'-i',source,'-t',String(CHUNK),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
   if(task.cancelled)throw Error('Cancelled');
   task.status={...task.status,percent:35,message:'Transcribing '+Math.floor(start/60)+'m–'+Math.floor((start+CHUNK)/60)+'m…'};emit(task.status);
   const args=['-m',opts.model,'-f',wav,'-oj','-of',output,'-np'];
   if(!opts.gpu)args.push('-ng');
   try{await processChild(task,opts.binary,args);}catch(e){if(task.cancelled)throw e;if(!opts.canFallback)throw e;task.status={...task.status,message:'GPU engine failed; retrying with bundled CPU engine…'};emit(task.status);await processChild(task,opts.cpuBinary,[...args,'-ng']);}
   if(task.cancelled)throw Error('Cancelled');
   const raw=JSON.parse(await fs.readFile(output+'.json','utf8'));
   const segments=(raw.transcription||[]).map(s=>({start:start+Number(s.offsets?.from||0)/1000,end:start+Number(s.offsets?.to||0)/1000,text:String(s.text||'').trim()})).filter(s=>s.text);
   const previous=await read(id,track)||{id,track,createdAt:new Date().toISOString(),segments:[],completedChunks:[]};
   const completed=new Set(previous.completedChunks||[]);
   if(!completed.has(chunk)){
    previous.segments=[...previous.segments,...segments].sort((a,b)=>a.start-b.start);
    completed.add(chunk);previous.completedChunks=[...completed].sort((a,b)=>a-b);
    await save(id,track,previous);
   }
   task.status={state:'completed',id,track,chunk,percent:100,message:'Saved transcript section at '+Math.floor(start/60)+'m',segments:segments.length};emit(task.status);
  }finally{await Promise.all([fs.rm(wav,{force:true}),Promise.resolve()]).catch(()=>{});}
 }
 async function runChunk(id,track,chunk,opts){
  if(job)return false;
  await fs.mkdir(base,{recursive:true});
  const task={cancelled:false,child:null,status:{state:'running',id,track,percent:0,message:'Preparing transcription…'}};
  job=task;emit(task.status);
  try{await transcribeChunk(task,id,track,chunk,opts);}
  catch(e){if(!task.cancelled){task.status={state:'error',id,track,message:e.message};emit(task.status);if(auto)auto=null;}}
  finally{if(job===task)job=null;if(task.cancelled&&auto)setImmediate(pump);}
  return !task.cancelled&&task.status.state==='completed';
 }
 async function nextChunk(id,track,position){
  const {b}=resolve(id,track);
  const length=Number(b.tracks[track].duration)||0;
  const max=length>0?Math.ceil(length/CHUNK):1;
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
  try{
   const chunk=await nextChunk(session.id,session.track,session.position);
   if(auto!==session)return;
   if(chunk===null){emit({state:'completed',id:session.id,track:session.track,percent:100,message:'All sections of this track transcribed'});auto=null;return;}
   const ok=await runChunk(session.id,session.track,chunk,session.opts);
   if(auto===session&&ok)setImmediate(pump);
  }catch(e){if(auto===session){auto=null;emit({state:'error',message:e.message});}}
 }
 ipcMain.handle('ai-auto-start',async(_,id,track,position,options={})=>{
  resolve(id,track);const opts=await optionsFor(options);
  auto={id,track,position:Math.max(0,Number(position)||0),opts};
  if(job){job.cancelled=true;job.child?.kill();}else setImmediate(pump);
  return {state:'running',message:'Automatic background transcription enabled'};
 });
 ipcMain.handle('ai-auto-position',(_,id,track,position)=>{
  if(!auto||auto.id!==id)return false;
  resolve(id,track);
  const changed=auto.track!==track||Math.abs(auto.position-(Number(position)||0))>=CHUNK*2;
  auto.track=track;auto.position=Math.max(0,Number(position)||0);
  if(changed&&job&&(job.status.track!==track||Math.abs((job.status.chunk||0)*CHUNK-auto.position)>=CHUNK*3)){job.cancelled=true;job.child?.kill();}
  if(!job)setImmediate(pump);
  return true;
 });
 ipcMain.handle('ai-transcript-start',async(_,id,track,options={})=>{
  resolve(id,track);if(job||auto)throw Error('Another transcription is running');
  const opts=await optionsFor(options);
  const chunk=await nextChunk(id,track,Math.max(0,Number(options.position)||0));
  if(chunk===null)return {state:'completed',percent:100,message:'Track already transcribed'};
  setImmediate(()=>runChunk(id,track,chunk,opts));
  return {state:'running',id,track,percent:0,message:'Transcribing a 90-second section…'};
 });
}
module.exports={createTranscription};
