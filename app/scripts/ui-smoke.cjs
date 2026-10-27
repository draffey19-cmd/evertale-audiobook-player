// Run with Electron, never with main.cjs. Only synthetic IPC/library data is exposed.
const {app,BrowserWindow,ipcMain,protocol}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.env.EVERTALE_UI_ROOT||path.resolve(__dirname,'..');
const testRoot=path.resolve(__dirname,'../dist/ui-smoke',require('node:crypto').randomUUID());
require('node:fs').mkdirSync(testRoot,{recursive:true});
app.setPath('userData',testRoot);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{scheme:'hearth-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
const timeout=setTimeout(()=>{console.error('UI smoke timed out');app.exit(1);},30000);
app.whenReady().then(async()=>{
 await fs.mkdir(testRoot,{recursive:true});
 const wav=await fs.readFile(path.resolve(__dirname,'../dist/ai-smoke/speech.wav'));
 protocol.handle('hearth-media',()=>new Response(wav,{headers:{'Content-Type':'audio/wav'}}));
 const fixture=id=>({id,title:'Synthetic '+id,author:'Test narrator',duration:18,cover:null,progress:{track:0,time:0},tracks:[{key:id+'a',name:'Track one',duration:9},{key:id+'b',name:'Track two',duration:9}],chapters:[{track:0,time:0,title:'One'},{track:1,time:0,title:'Two'}],bookmarks:[]});
 const books=[fixture('book-a'),fixture('book-b')];let extra=false,config={},queue={state:'idle'};
 const handlers={
  'get-library':()=>({books,folders:[],profile:'Default',profiles:['Default'],settings:{}}),
  'ai-engine-status':()=>({installed:true,ready:true}),
  'ai-vibe-config':(_,changes)=>{if(changes)config={...config,...changes};return config;},
  'ai-vibe-devices':()=>[{index:1,description:'Synthetic NVIDIA device'}],
  'ai-transcript-status':()=>({state:'idle'}),'ai-book-status':()=>queue,
  'ai-transcript-get':(_,id,track)=>({segments:track===0?[{start:0.1,end:1,text:id+' opening'},{start:3,end:5,text:id+' second passage'}]:[{start:0,end:2,text:id+' track two'},...(extra?[{start:4,end:6,text:'New background result'}]:[])],completedChunks:[0]}),
  'ai-transcript-search':()=>[],'save-progress':()=>true,'updater-status':()=>({state:'disabled'}),
  'ai-book-start':(_,id)=>queue={state:'running',id,title:id,total:2,done:0,percent:0,message:'Synthetic queue running'},
  'ai-book-pause':()=>queue={...queue,state:'paused'},'ai-book-resume':()=>queue={...queue,state:'running'},'ai-book-cancel':()=>queue={...queue,state:'cancelled'}
 };
 for(const [name,fn] of Object.entries(handlers))ipcMain.handle(name,fn);
 const win=new BrowserWindow({show:false,width:1300,height:950,webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
 const errors=[];win.webContents.on('console-message',(_,level,message)=>{if(level===3)errors.push(message);});
 await win.loadFile(path.join(root,'index.html'));
 const js=code=>win.webContents.executeJavaScript(code,true);
 async function until(code){const end=Date.now()+5000;while(Date.now()<end){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait failed: '+code);}
 await until("document.querySelectorAll('.book').length===2");await js("document.querySelector('.book').click()");
 await until("document.querySelectorAll('.transcript-passage').length===2");
 assert.match(await js("document.getElementById('reader-status').textContent"),/saved section/);
 await js("document.querySelector('.transcript-passage').click()");await until("audio.readyState>=1");
 await js("audio.pause();audio.currentTime=3.5;audio.dispatchEvent(new Event('timeupdate'))");
 assert.match(await js("document.querySelector('.transcript-passage.spoken')?.textContent"),/second passage/);
 await js("audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'))");assert.equal(await js("document.querySelector('.transcript-passage.spoken')===null"),true);
 await js("document.getElementById('reader-scroll').click()");assert.equal(await js("localStorage.getItem('reader-follow')"),'false');
 await js("document.querySelectorAll('#chapters button')[1].click()");await until("document.querySelector('.transcript-passage')?.textContent==='book-a track two'");
 extra=true;win.webContents.send('ai-transcription-status',{state:'completed',id:'book-a',track:1,sectionSaved:true});await until("document.querySelectorAll('.transcript-passage').length===2");
 await js("document.querySelectorAll('.book')[1].click()");await until("document.querySelector('.transcript-passage')?.textContent==='book-b opening'");
 assert.equal(await js("document.querySelector('.transcript-passage.spoken')===null"),true);
 await js("document.getElementById('ai-book-start').click()");await until("!document.getElementById('ai-book-pause').disabled");
 await js("document.getElementById('ai-book-pause').click()");await until("!document.getElementById('ai-book-resume').disabled");
 await js("document.getElementById('ai-book-resume').click()");await until("!document.getElementById('ai-book-pause').disabled");
 await js("document.getElementById('ai-book-cancel').click()");await until("document.getElementById('ai-book-cancel').disabled");
 await js("document.getElementById('vibe-devices').click()");await until("document.getElementById('vibe-compute').options.length===3");
 await js("document.getElementById('vibe-compute').value='1';document.getElementById('vibe-compute').dispatchEvent(new Event('change'))");await until("document.getElementById('ai-engine-status').textContent.includes('saved')");
 assert.equal(config.gpuDevice,1);assert.equal(config.noGpu,false);
 await fs.writeFile(path.join(testRoot,'reader.png'),(await win.webContents.capturePage()).toPNG());
 assert.deepEqual(errors,[]);
 console.log('PASS: reader saved text, highlight/gaps, seek, follow toggle, track/book switches, background refresh, queue controls, GPU selector. Assets: '+root);
 clearTimeout(timeout);win.destroy();app.exit(0);
}).catch(e=>{console.error(e.stack);clearTimeout(timeout);app.exit(1);});
