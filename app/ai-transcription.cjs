const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const https=require('node:https');
const bundledFfmpeg=require('ffmpeg-static');
const bundledFfmpegPath=appPath=>appPath&&appPath.includes('app.asar')?appPath.replace('app.asar','app.asar.unpacked'):appPath;
function createTranscription({app,ipcMain,getWindow,getBooks,getTrackPath}){
 const base=path.join(app.getPath('userData'),'ai-transcripts');
 let job=null;
 let modelDownload=null;
 const modelDirectory=path.join(app.getPath('userData'),'ai-models');
 const modelPath=path.join(modelDirectory,'ggml-base.en.bin');
 const bundledWhisper=path.join(process.resourcesPath,'ai-bin','whisper-cli.exe');
 ipcMain.handle('ai-engine-status',async()=>({installed:await fs.access(bundledWhisper).then(()=>true).catch(()=>false),path:bundledWhisper}));
 const modelURL='https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
 const downloadStatus=s=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('ai-model-status',s);};
 ipcMain.handle('ai-model-path',async()=>({path:modelPath,installed:await fs.stat(modelPath).then(s=>s.size>10000000).catch(()=>false)}));
 ipcMain.handle('ai-model-download',async()=>{
  if(modelDownload)throw Error('Model download already running');
  await fs.mkdir(modelDirectory,{recursive:true});
  const temp=modelPath+'.partial';let stopped=false;let request=null;
  const status={state:'downloading',percent:0,message:'Downloading Whisper base.en model…'};downloadStatus(status);
  const promise=new Promise((resolve,reject)=>{
   const get=(url,redirects=0)=>{if(redirects>5)return reject(Error('Too many redirects'));if(!/^https:\/\//.test(url))return reject(Error('Insecure download redirect'));
    request=https.get(url,response=>{
     if([301,302,303,307,308].includes(response.statusCode)){const next=new URL(response.headers.location,url);response.resume();return get(next.href,redirects+1);}
     if(response.statusCode!==200){response.resume();return reject(Error('Model download failed: HTTP '+response.statusCode));}
     const total=Number(response.headers['content-length'])||0;let bytes=0;
     const stream=require('node:fs').createWriteStream(temp);
     response.on('data',chunk=>{bytes+=chunk.length;if(total){status.percent=Math.min(99,Math.round(bytes/total*100));downloadStatus({...status});}});
     response.on('error',reject);stream.on('error',reject);stream.on('finish',()=>resolve(bytes));response.pipe(stream);
    });request.on('error',reject);
   };get(modelURL);
  });
  modelDownload={cancel:()=>{stopped=true;request?.destroy(Error('Download cancelled'));}};
  try{const size=await promise;if(size<10000000)throw Error('Downloaded model is unexpectedly small');await fs.rename(temp,modelPath);downloadStatus({state:'ready',percent:100,message:'Whisper model downloaded'});return {path:modelPath,installed:true};}
  catch(e){await fs.rm(temp,{force:true}).catch(()=>{});downloadStatus({state:stopped?'cancelled':'error',message:e.message});throw e;}
  finally{modelDownload=null;}
 });
 ipcMain.handle('ai-model-cancel',()=>{if(!modelDownload)return false;modelDownload.cancel();return true;});

 const emit=s=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('ai-transcription-status',s);};
 const key=(id,track)=>crypto.createHash('sha256').update(id+':'+track).digest('hex').slice(0,32);
 const file=(id,track)=>path.join(base,key(id,track)+'.json');
 const read=async(id,track)=>{try{return JSON.parse(await fs.readFile(file(id,track),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const resolve=(id,track)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');if(!Number.isInteger(track)||track<0||track>=b.tracks.length)throw Error('Invalid track');const source=getTrackPath(b.tracks[track].key);if(!source)throw Error('Audio file unavailable');return {b,source};};
 const CHUNK=30;
 const chunkIndex=time=>Math.max(0,Math.floor(Math.max(0,Number(time)||0)/CHUNK));
 const covered=(data,index)=>Array.isArray(data?.completedChunks)&&data.completedChunks.includes(index);
 ipcMain.handle('ai-transcript-get',async(_,id,track)=>{resolve(id,track);return read(id,track);});
 ipcMain.handle('ai-transcript-search',async(_,id,query)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');const q=String(query||'').trim().toLowerCase();if(!q)return [];const found=[];for(let i=0;i<b.tracks.length;i++){const data=await read(id,i);for(const s of data?.segments||[]){if(s.text.toLowerCase().includes(q))found.push({track:i,start:s.start,end:s.end,text:s.text});if(found.length>=100)return found;}}return found;});
 ipcMain.handle('ai-transcript-status',()=>job?.status||{state:'idle'});
 const stop=()=>{if(!job)return false;job.cancelled=true;job.status={...job.status,state:'cancelling',message:'Stopping background transcription…'};emit(job.status);job.child?.kill();return true;};
 ipcMain.handle('ai-transcript-cancel',stop);
 ipcMain.handle('ai-transcript-position',(_,id,track,time,playing)=>{
  if(!job||job.id!==id||job.cancelled)return false;
  resolve(id,track);
  job.track=track;job.position=chunkIndex(time);job.playing=Boolean(playing);
  // Interrupt a distant chunk so that the new listening position takes priority.
  if(job.activeTrack!==undefined&&(job.activeTrack!==track||Math.abs(job.activeIndex-job.position)>2)){job.interrupted=true;job.child?.kill();}
  return true;
 });
 ipcMain.handle('ai-transcript-start',async(_,id,track,options={})=>{
  if(job)throw Error('Another transcription is running');
  const {b}=resolve(id,track);
  const binary=String(options.binary||bundledWhisper).trim();
  const model=String(options.model||modelPath).trim();
  if(!path.isAbsolute(binary)||!path.isAbsolute(model))throw Error('Select valid local Whisper executable and model paths');
  await Promise.all([fs.access(binary),fs.access(model)]);
  const ffmpeg=String(options.ffmpeg||bundledFfmpegPath(bundledFfmpeg)||'ffmpeg').trim();
  const task={id,track,position:chunkIndex(options.time),playing:true,cancelled:false,interrupted:false,child:null,status:{state:'running',id,track,percent:0,message:'Preparing progressive transcription…'}};
  job=task;emit(task.status);await fs.mkdir(base,{recursive:true});
  const execute=(command,args)=>new Promise((resolve,reject)=>{
   const p=spawn(command,args,{windowsHide:true});task.child=p;let stderr='';
   p.stderr?.on('data',d=>{stderr=(stderr+d).slice(-3000);});
   p.on('error',reject);
   p.on('close',code=>code===0?resolve():reject(Error('Process exited '+code+': '+stderr)));
  });
  const processChunk=async(t,index)=>{
   const {source}=resolve(id,t);
   const prefix=path.join(base,'job-'+crypto.randomUUID());
   const wav=prefix+'.wav';
   task.activeTrack=t;task.activeIndex=index;task.interrupted=false;
   try{
    await execute(ffmpeg,['-nostdin','-y','-ss',String(index*CHUNK),'-i',source,'-t',String(CHUNK),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
    if(task.cancelled||task.interrupted)return;
    await execute(binary,['-m',model,'-f',wav,'-oj','-of',prefix,'-np','-ng']);
    if(task.cancelled||task.interrupted)return;
    const raw=JSON.parse(await fs.readFile(prefix+'.json','utf8'));
    const segments=(raw.transcription||[]).map(x=>({start:index*CHUNK+Number(x.offsets?.from||0)/1000,end:index*CHUNK+Number(x.offsets?.to||0)/1000,text:String(x.text||'').trim()})).filter(x=>x.text);
    const previous=await read(id,t)||{id,track:t,createdAt:new Date().toISOString(),completedChunks:[],segments:[]};
    if(covered(previous,index))return;
    previous.completedChunks.push(index);
    previous.segments.push(...segments);
    previous.segments.sort((a,b)=>a.start-b.start);
    const dest=file(id,t),temp=dest+'.tmp';
    await fs.writeFile(temp,JSON.stringify(previous));await fs.rename(temp,dest);
   }finally{
    task.child=null;task.activeTrack=undefined;
    await Promise.all([fs.rm(wav,{force:true}),fs.rm(prefix+'.json',{force:true})]).catch(()=>{});
   }
  };
  (async()=>{try{
   // Favor the listening position, then nearby chunks, then fill the rest of the book.
   while(!task.cancelled){
    const tracks=getBooks().find(x=>x.id===id)?.tracks||b.tracks;
    const pending=[];
    for(let t=0;t<tracks.length;t++){
     const duration=Number(tracks[t].duration)||0;
     if(duration<=0)continue;
     const data=await read(id,t);
     for(let i=0;i<Math.ceil(duration/CHUNK);i++)if(!covered(data,i))pending.push({track:t,index:i});
    }
    if(!pending.length){task.status={state:'completed',id,percent:100,message:'All available audiobook tracks transcribed'};emit(task.status);break;}
    const focus=task.track,position=task.position;
    pending.sort((a,b)=>{
     const score=x=>x.track===focus?Math.abs(x.index-position):100000+Math.abs(x.track-focus)*10000+x.index;
     return score(a)-score(b);
    });
    const next=pending[0];
    const total=pending.length;
    task.status={state:'running',id,track:next.track,percent:0,message:'Transcribing '+tracks[next.track].name+' at '+Math.floor(next.index*CHUNK/60)+'m '+(next.index*CHUNK%60)+'s ('+total+' sections remaining)'};
    emit(task.status);
    try{await processChunk(next.track,next.index);}
    catch(e){if(task.cancelled)break;if(task.interrupted){task.interrupted=false;continue;}throw e;}
    if(task.interrupted){task.interrupted=false;continue;}
    emit({...task.status,message:'Section saved. '+(total-1)+' sections remaining',sectionSaved:true,track:next.track});
   }
  }catch(e){task.status={state:task.cancelled?'cancelled':'error',id,message:task.cancelled?'Transcription stopped':e.message};emit(task.status);}
  finally{if(task.cancelled)emit({state:'cancelled',id,message:'Background transcription stopped'});job=null;}
  })();
  return task.status;
 });

}
module.exports={createTranscription};
