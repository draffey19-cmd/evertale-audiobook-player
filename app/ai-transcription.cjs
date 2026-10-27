const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const https=require('node:https');
function createTranscription({app,ipcMain,getWindow,getBooks,getTrackPath}){
 const base=path.join(app.getPath('userData'),'ai-transcripts');
 let job=null;
 let modelDownload=null;
 const modelDirectory=path.join(app.getPath('userData'),'ai-models');
 const modelPath=path.join(modelDirectory,'ggml-base.en.bin');
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
 ipcMain.handle('ai-transcript-get',async(_,id,track)=>{resolve(id,track);return read(id,track);});
 ipcMain.handle('ai-transcript-search',async(_,id,query)=>{const b=getBooks().find(x=>x.id===id);if(!b)throw Error('Audiobook not found');const q=String(query||'').trim().toLowerCase();if(!q)return [];const found=[];for(let i=0;i<b.tracks.length;i++){const data=await read(id,i);for(const s of data?.segments||[]){if(s.text.toLowerCase().includes(q))found.push({track:i,start:s.start,end:s.end,text:s.text});if(found.length>=100)return found;}}return found;});
 ipcMain.handle('ai-transcript-status',()=>job?.status||{state:'idle'});
 ipcMain.handle('ai-transcript-cancel',()=>{if(!job)return false;job.cancelled=true;job.status={...job.status,state:'cancelling',message:'Stopping transcription…'};emit(job.status);job.child?.kill();return true;});
 ipcMain.handle('ai-transcript-start',async(_,id,track,options={})=>{
  if(job)throw Error('Another transcription is running');
  const {source}=resolve(id,track);
  const binary=String(options.binary||'').trim();
  const model=String(options.model||'').trim();
  if(!binary||!model)throw Error('Configure a local whisper.cpp executable and model first');
  for(const p of [binary,model])await fs.access(p);
  const out=path.join(base,'job-'+crypto.randomUUID());await fs.mkdir(base,{recursive:true});
  const task={cancelled:false,child:null,status:{state:'running',id,track,percent:0,message:'Starting local transcription…'}};job=task;emit(task.status);
  (async()=>{try{
   // whisper.cpp's CLI accepts audio WAV; ffmpeg converts compressed audiobook formats.
   const ffmpeg=String(options.ffmpeg||'ffmpeg').trim();
   const wav=out+'.wav';
   await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-nostdin','-y','-i',source,'-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{windowsHide:true});task.child=p;p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Audio conversion failed ('+code+')')));});
   if(task.cancelled)return;
   task.status={...task.status,percent:35,message:'Running Whisper speech recognition…'};emit(task.status);
   const args=['-m',model,'-f',wav,'-oj','-of',out,'-np'];
   if(options.gpu===false)args.push('-ng');
   const run=async a=>new Promise((resolve,reject)=>{let stderr='';const p=spawn(binary,a,{windowsHide:true});task.child=p;p.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000)});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Whisper exited '+code+': '+stderr)));});
   try{await run(args);}catch(e){if(task.cancelled)return;if(options.gpu!==false){task.status={...task.status,message:'GPU unavailable; retrying on CPU…'};emit(task.status);await run([...args,'-ng']);}else throw e;}
   if(task.cancelled)return;
   const raw=JSON.parse(await fs.readFile(out+'.json','utf8'));
   const segments=(raw.transcription||[]).map(s=>({start:Number(s.offsets?.from||0)/1000,end:Number(s.offsets?.to||0)/1000,text:String(s.text||'').trim()})).filter(s=>s.text);
   const data={id,track,createdAt:new Date().toISOString(),segments};
   const destination=file(id,track),tmp=destination+'.tmp';await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,destination);
   task.status={state:'completed',id,track,percent:100,message:'Transcript saved locally',segments:segments.length};emit(task.status);
  }catch(e){task.status={state:task.cancelled?'cancelled':'error',id,track,message:task.cancelled?'Transcription cancelled':e.message};emit(task.status);}
  finally{await Promise.all([fs.rm(out+'.wav',{force:true}),fs.rm(out+'.json',{force:true})]).catch(()=>{});if(task.cancelled)emit({state:'cancelled',id,track,message:'Transcription cancelled'});job=null;}
  })();
  return task.status;
 });
}
module.exports={createTranscription};
