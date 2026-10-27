const fs=require('node:fs/promises');
const path=require('node:path');

function createBookQueue({app,ipcMain,getBooks,read,prepare,run,isBusy,canStart,cancelWorker,emit,retryDelay=2000}){
 const file=path.join(app.getPath('userData'),'ai-book-queue.json');
 let state={state:'idle',mode:'book'},generation=0,pumping=false,ownsWorker=false,writes=Promise.resolve();
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const persist=()=>{
  state.updatedAt=new Date().toISOString();const snapshot=JSON.stringify(state,null,2);
  const write=writes.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});writes=write;return write;
 };
 const notify=()=>{emit({...state});return {...state};};
 const recovery=(async()=>{
  try{
   const saved=JSON.parse(await fs.readFile(file,'utf8'));
   if(!saved||typeof saved.id!=='string'||!['running','paused','error','completed','cancelled'].includes(saved.state))throw Error('Invalid saved queue');
   state={...saved,mode:'book'};
   if(state.state==='running'){state.state='paused';state.message='Interrupted session recovered. Resume to continue saved work.';await persist();}
  }catch(e){if(e.code!=='ENOENT')state={state:'error',mode:'book',message:'Cannot recover queue: '+e.message};}
 })();
 function book(id){const b=getBooks().find(b=>b.id===id);if(!b)throw Error('Audiobook not found');return b;}
 async function scan(id){
  const b=book(id);let done=0,total=0,next=null;
  for(let track=0;track<b.tracks.length;track++){
   const duration=Number(b.tracks[track].duration);
   if(!Number.isFinite(duration)||duration<=0)throw Error('Track '+(track+1)+' has no known duration. Rescan the audiobook before whole-book transcription.');
   const count=Math.ceil(duration/90),data=await read(id,track),completed=new Set(data?.completedChunks||[]);
   total+=count;
   for(let chunk=0;chunk<count;chunk++){if(completed.has(chunk))done++;else if(!next)next={track,chunk};}
  }
  if(!b.tracks.length)throw Error('Audiobook has no tracks');
  return {done,total,next,title:b.title||id};
 }
 async function checkpoint(){await persist();notify();}
 async function pump(){
  if(pumping||state.state!=='running')return;
  pumping=true;const token=generation;
  try{
   // A cancelled older worker still owns its slot until its cleanup completes.
   while(isBusy()&&token===generation&&state.state==='running')await delay(50);
   if(token!==generation||state.state!=='running')return;
   let progress=await scan(state.id);
   if(token!==generation||state.state!=='running')return;
   if(progress.next)await prepare();
   let retries=0;
   while(token===generation&&state.state==='running'){
    progress=await scan(state.id);
    if(token!==generation||state.state!=='running')return;
    state={...state,done:progress.done,total:progress.total,title:progress.title,percent:Math.floor(100*progress.done/progress.total)};
    if(!progress.next){state.state='completed';state.message='Entire audiobook transcribed';await checkpoint();return;}
    const {track,chunk}=progress.next;
    state.track=track;state.chunk=chunk;state.message=`Track ${track+1} of ${book(state.id).tracks.length} | ${progress.done}/${progress.total} sections saved`;
    await checkpoint();
    if(token!==generation||state.state!=='running')return;
    let result;ownsWorker=true;
    try{result=await run(state.id,track,chunk);}finally{ownsWorker=false;}
    if(token!==generation||state.state!=='running')return;
    if(!result.ok){
     if(/HTTP (429|503)\b/.test(result.message)&&retries++<3){state.message='Vibe is busy. Retrying the unsaved section...';await checkpoint();await delay(retryDelay);continue;}
     throw Error(result.message||'Section failed; saved sections are preserved. Resume to retry.');
    }
    retries=0;
   }
  }catch(e){if(token===generation&&state.state==='running'){state.state='error';state.message=e.message;try{await checkpoint();}catch(writeError){state.message+=' | Cannot save queue: '+writeError.message;notify();}}}
  finally{pumping=false;if(state.state==='running')setImmediate(pump);}
 }
 async function start(id){
  await recovery;
  if(state.state==='running')throw Error('A whole-book queue is already running');
  if(!canStart())throw Error('Stop the current transcription mode before starting a whole book');
  book(id);generation++;
  // Reserve before the first disk await so a competing start cannot enter.
  state={state:'running',mode:'book',id,done:0,total:0,percent:0,message:'Preparing whole-book queue'};
  try{await checkpoint();}catch(e){state.state='error';state.message=e.message;notify();throw e;}
  setImmediate(pump);return {...state};
 }
 async function pause(){
  await recovery;generation++;
  if(state.state==='running'){state.state='paused';state.message='Paused. Any current section will finish and be saved.';await checkpoint();}
  return {...state};
 }
 async function cancel(){
  await recovery;generation++;
  if(state.id){state.state='cancelled';state.message='Queue cancelled. Saved sections are kept for resume.';if(ownsWorker)cancelWorker();await checkpoint();}
  return {...state};
 }
 ipcMain.handle('ai-book-status',async()=>{await recovery;await writes;return {...state};});
 ipcMain.handle('ai-book-start',(_,id)=>start(id));
 ipcMain.handle('ai-book-pause',pause);
 ipcMain.handle('ai-book-cancel',cancel);
 ipcMain.handle('ai-book-resume',async()=>{await recovery;if(!state.id)throw Error('No saved queue to resume');return start(state.id);});
 return {isActive:()=>state.state==='running',pause,cancel};
}
module.exports={createBookQueue};
