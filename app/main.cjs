const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const { initializeUpdater } = require('./updater.cjs');
const { createTranscription } = require('./ai-transcription.cjs');
const devMode = process.argv.includes('--hearth-dev');
// Keep the existing Hearth data folder when rebranding, preserving library and progress.
app.setName('Hearth Audiobooks');
if (devMode) { try { require('electron-reloader')(module, { watchRenderer: true, ignore: ['library.json', 'library-cache.json', 'dist', 'node_modules'] }); } catch(e) { console.warn('Live reload unavailable:',e.message); } }
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{scheme:'hearth-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
let win;
let store = {folders:[], overrides:{}, progress:{}, lastBook:null, favorites:{},finished:{},bookmarks:{},profiles:["Default"],profile:"Default",settings:{},history:{}};
let books = [];
let tracks = new Map();
let metadataModule;
const ext = new Set(['.m4b','.m4a','.mp3','.mp4','.aac','.flac','.ogg','.opus','.wav','.wma','.aiff','.aif']);
const idOf = s => crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
const statePath = () => path.join(app.getPath('userData'),'library.json');
const cachePath = () => path.join(app.getPath('userData'),'library-cache.json');
let scanRunning = null;
let cachedSignature = null;
let cacheDirty = false;
let saveQueue = Promise.resolve();
const fileExists = async p => {try {await fsp.access(p);return true;}catch{return false;}};
async function loadCache(){try {const data=JSON.parse(await fsp.readFile(cachePath(),'utf8'));if(Array.isArray(data.books)){books=data.books;tracks=new Map(data.trackPaths||[]);cachedSignature=data.signature||null;return true;}}catch{}return false;}
async function saveCache(){const file=cachePath();const temp=file+'.tmp';await fsp.writeFile(temp,JSON.stringify({books,trackPaths:[...tracks],signature:cachedSignature}));await fsp.rename(temp,file);}
function decorateBooks(){return books.map(b=>{const saved=(store.progress[store.profile]||{})[b.id]||{track:0,time:0};return {...b,progress:saved,isLast:store.lastBook===b.id,favorite:!!(store.favorites[store.profile]||{})[b.id],finished:!!(store.finished[store.profile]||{})[b.id],bookmarks:(store.bookmarks[store.profile]||{})[b.id]||[],lastPlayed:(store.history[store.profile]||{})[b.id]||0};});}
const save = () => { const snapshot=JSON.stringify(store,null,2); saveQueue=saveQueue.catch(console.error).then(async()=>{const file=statePath();await fsp.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fsp.writeFile(tmp,snapshot);await fsp.rename(tmp,file);});return saveQueue; };
const safe = x => String(x || '').replace(/\.[^.]+$/,'').replace(/[_]+/g,' ').trim();
const sortName = (a,b) => a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
async function walk(dir, output, depth=0, report=()=>{}) {
  if(depth>16) return;
  let entries; try { entries=await fsp.readdir(dir,{withFileTypes:true}); } catch{return;}
  for(const ent of entries){
    if(ent.name.startsWith('.')) continue;
    const full=path.join(dir,ent.name);
    if(ent.isDirectory()) await walk(full,output,depth+1,report);
    else if(ent.isFile() && ext.has(path.extname(ent.name).toLowerCase())) {output.push(full);report(output.length,full);}
  }
}
async function meta(file){
  try { metadataModule ||= await import('music-metadata'); return await metadataModule.parseFile(file,{duration:true,skipCovers:false}); }
  catch{return {common:{},format:{}};}
}
function imageUri(pic){
  if(!pic?.data || pic.data.length>7_000_000) return null;
  return `data:${pic.format||'image/jpeg'};base64,${Buffer.from(pic.data).toString('base64')}`;
}
async function performScan(){
  const report = (phase, current, total, message) => {
    if(win && !win.isDestroyed()) win.webContents.send('scan-progress',{phase,current,total,message});
  };
  report('discovering',0,0,'Finding audio files…');
  const files=[]; for(const folder of store.folders) await walk(folder,files,0,(count,file)=>report('discovering',count,0,`Found ${count} audio files · ${path.basename(file)}`));
  const signatures=[];
  for(const file of files){try{const stat=await fsp.stat(file);signatures.push([file,stat.size,stat.mtimeMs]);}catch{}}
  const signature=idOf(JSON.stringify({folders:store.folders,signatures}));
  if(signature===cachedSignature && books.length && !cacheDirty){
    report('complete',files.length,files.length,`Library unchanged · ${books.length} audiobooks ready`);
    return decorateBooks();
  }
  // A folder directly inside a library root represents one audiobook.
  // Loose audio files in the root remain separate audiobooks.
  // Nested Disc/Part folders are included in their parent book.
  const grouped=new Map();
  for(const file of files){
    const root=store.folders.filter(f=>{const relative=path.relative(f,file);return relative && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);}).sort((a,b)=>b.length-a.length)[0];
    if(!root)continue;
    const relative=path.relative(root,file);
    const segments=relative.split(path.sep);
    const groupKey=segments.length===1?`file:${file}`:`folder:${path.join(root,segments[0])}`;
    if(!grouped.has(groupKey))grouped.set(groupKey,{files:[],folder:segments.length===1?root:path.join(root,segments[0]),standalone:segments.length===1});
    grouped.get(groupKey).files.push(file);
  }
  const newBooks=[];const newTracks=new Map();let processed=0;
  report('processing',0,files.length,`Reading metadata for ${files.length} files…`);
  for(const [groupKey,group] of grouped){
    const set=group.files.sort((a,b)=>sortName(path.relative(group.folder,a),path.relative(group.folder,b)));
    const first=await meta(set[0]);
    const id=idOf(groupKey);
    const override=store.overrides[id]||{};
    const title=override.title || (group.standalone?first.common.album||first.common.title||safe(path.basename(set[0])):path.basename(group.folder));
    const author=override.author || first.common.albumartist || first.common.artist || 'Unknown author';
    let cover=override.cover||imageUri(first.common.picture?.[0]);
    if(!cover){for(const name of ['cover.jpg','cover.jpeg','cover.png','folder.jpg','folder.png']){try{const image=await fsp.readFile(path.join(group.folder,name));if(image.length<7_000_000){cover=`data:image/${name.endsWith('png')?'png':'jpeg'};base64,${image.toString('base64')}`;break;}}catch{}}}
    let duration=0;const chapters=[];const trackList=[];
    for(let i=0;i<set.length;i++){
      const file=set[i];const m=i===0?first:await meta(file);const seconds=Number(m.format.duration)||0;
      const key=idOf(file);newTracks.set(key,file);
      const track={key,name:m.common.title||safe(path.basename(file)),duration:seconds};trackList.push(track);
      const nativeChapters=m.common.chapters||m.format.chapters||[];
      if(nativeChapters.length){
        for(let j=0;j<nativeChapters.length;j++){
          const c=nativeChapters[j];let start=Number(c.startTime??c.start??0);
          if(c.start===undefined&&c.startTime===undefined&&c.startIndex!=null&&m.format.sampleRate)start=c.startIndex/m.format.sampleRate;
          chapters.push({track:i,time:start,title:c.title||`Chapter ${j+1}`});
        }
      }else{chapters.push({track:i,time:0,title:track.name});}
      duration+=seconds;processed++;
      report('processing',processed,files.length,`Reading ${path.basename(file)}`);
    }
    const saved=(store.progress[store.profile]||{})[id]||{track:0,time:0};
    const progress={track:Math.max(0,Math.min(trackList.length-1,Number(saved.track)||0)),time:Math.max(0,Number(saved.time)||0)};
    newBooks.push({id,title,author,cover,duration,chapters,tracks:trackList,folder:group.folder,progress,isLast:store.lastBook===id,favorite:!!(store.favorites[store.profile]||{})[id],finished:!!(store.finished[store.profile]||{})[id],bookmarks:(store.bookmarks[store.profile]||{})[id]||[],lastPlayed:(store.history[store.profile]||{})[id]||0});
  }
  books=newBooks.sort((a,b)=>sortName(a.title,b.title));tracks=newTracks;cachedSignature=signature;cacheDirty=false;
  try{await saveCache();}catch(error){console.error('Library cache write failed:',error);}
  report('complete',files.length,files.length,`Library ready · ${books.length} audiobooks`);
  return decorateBooks();
}
function scan(){if(scanRunning)return scanRunning;scanRunning=performScan().finally(()=>{scanRunning=null;});return scanRunning;}
function createWindow(){
  win=new BrowserWindow({width:1260,height:820,minWidth:780,minHeight:550,backgroundColor:'#10151c',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
}
app.whenReady().then(async()=>{
  try{store={...store,...JSON.parse(await fsp.readFile(statePath(),'utf8'))};}catch{}
  protocol.handle('hearth-media',async request=>{
    try{
      const u=new URL(request.url);const key=u.hostname;const file=tracks.get(key);
      if(!file) return new Response('Not found',{status:404});
      const stat=await fsp.stat(file);const size=stat.size;
      const range=request.headers.get('range');let start=0,end=size-1,status=200;
      if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416});start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]||0));end=m[2]&&m[1]?Math.min(size-1,Number(m[2])):size-1;if(start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});status=206;}
      const headers={'Content-Type':({'mp3':'audio/mpeg','m4b':'audio/mp4','m4a':'audio/mp4','mp4':'audio/mp4','flac':'audio/flac','ogg':'audio/ogg','opus':'audio/ogg','wav':'audio/wav','aac':'audio/aac','wma':'audio/x-ms-wma','aiff':'audio/aiff','aif':'audio/aiff'})[path.extname(file).slice(1).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Content-Length':String(end-start+1)};
      if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
      return new Response(Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
    }catch{return new Response('Media unavailable',{status:404});}
  });
  await loadCache();
  createWindow();
  initializeUpdater({app,ipcMain,getWindow:()=>win,enabled:!devMode});
  createTranscription({app,ipcMain,getWindow:()=>win,getBooks:()=>books,getTrackPath:key=>tracks.get(key)});
  ipcMain.handle('ai-browse',async(_,kind)=>{if(!['binary','ffmpeg'].includes(kind))throw Error('Invalid file type');const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Windows executables',extensions:['exe']}]});return r.canceled?null:r.filePaths[0];});
  scan().then(()=>win?.webContents.send('library-changed')).catch(console.error);
  setInterval(()=>{if(store.settings.autoScan!==false)scan().then(()=>win?.webContents.send('library-changed')).catch(console.error);},300000);
});
ipcMain.handle('get-library',async()=>({books:decorateBooks(),folders:store.folders,lastBook:store.lastBook,profiles:store.profiles,profile:store.profile,settings:store.settings}));
ipcMain.handle('choose-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','multiSelections']});if(r.canceled)return null;store.folders=[...new Set([...store.folders,...r.filePaths])];await save();cacheDirty=true;return scan();});
ipcMain.handle('remove-folder',async(_,folder)=>{store.folders=store.folders.filter(x=>x!==folder);await save();cacheDirty=true;return scan();});
ipcMain.handle('rescan',scan);
ipcMain.handle('update-book',async(_,id,changes)=>{if(!books.some(x=>x.id===id))return books;const old=store.overrides[id]||{};store.overrides[id]={...old,...Object.fromEntries(Object.entries(changes).filter(([k,v])=>['title','author'].includes(k)&&typeof v==='string').map(([k,v])=>[k,v.slice(0,300)]))};await save();cacheDirty=true;return scan();});
ipcMain.handle('choose-cover',async(_,id)=>{if(!books.some(x=>x.id===id))return books;const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;const buf=await fsp.readFile(r.filePaths[0]);if(buf.length>7_000_000)throw Error('Cover must be smaller than 7 MB');const type=path.extname(r.filePaths[0]).slice(1).toLowerCase();store.overrides[id]={...(store.overrides[id]||{}),cover:`data:image/${type==='jpg'?'jpeg':type};base64,${buf.toString('base64')}`};await save();cacheDirty=true;return scan();});
ipcMain.handle('save-progress',async(_,id,p)=>{if(!books.some(x=>x.id===id))return;store.progress[store.profile] ||= {};store.progress[store.profile][id]={track:Math.max(0,Math.floor(Number(p.track)||0)),time:Math.max(0,Number(p.time)||0)};store.history[store.profile] ||= {};store.history[store.profile][id]=Date.now();store.lastBook=id;await save();});

ipcMain.handle('set-property',async(_,type,id,value)=>{
 if(!['favorites','finished','bookmarks'].includes(type)||!books.some(b=>b.id===id))return null;
 store[type][store.profile] ||= {};
 if(type==='bookmarks') {if(!Array.isArray(value))return null;store[type][store.profile][id]=value.slice(0,500).map(x=>({track:Math.max(0,Math.floor(Number(x.track)||0)),time:Math.max(0,Number(x.time)||0),note:String(x.note||'').slice(0,500)}));}
 else store[type][store.profile][id]=!!value;
 await save();return true;
});
ipcMain.handle('profile',async(_,name)=>{
 if(typeof name!=='string'||!name.trim()||name.length>50)return null;
 name=name.trim();if(!store.profiles.includes(name))store.profiles.push(name);
 store.profile=name;await save();return decorateBooks();
});
ipcMain.handle('settings',async(_,values)=>{for(const [k,v] of Object.entries(values||{}))if(['rewind','theme','voiceBoost','autoScan'].includes(k))store.settings[k]=v;await save();return store.settings;});
ipcMain.handle('backup',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'hearth-backup.json',filters:[{name:'JSON',extensions:['json']}]});if(r.canceled)return false;await fsp.writeFile(r.filePath,JSON.stringify(store,null,2));return true;});
ipcMain.handle('restore',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(r.canceled)return false;const data=JSON.parse(await fsp.readFile(r.filePaths[0],'utf8'));if(!Array.isArray(data.folders)||typeof data.overrides!=='object')throw Error('Invalid backup');store={...store,...data};await save();cacheDirty=true;await scan();return true;});

app.on('before-quit',()=>{save().catch(console.error);});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
