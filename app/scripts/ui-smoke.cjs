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
const timeout=setTimeout(()=>{console.error('UI smoke timed out');app.exit(1);},60000);
app.whenReady().then(async()=>{
 await fs.mkdir(testRoot,{recursive:true});
 // Self-contained silent PCM fixture: no audiobook files or generated speech assets needed.
 const sampleRate=16000,samples=sampleRate*9;
 const wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
 wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
 wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 protocol.handle('hearth-media',()=>new Response(wav,{headers:{'Content-Type':'audio/wav'}}));
 const fixture=id=>({id,title:'Synthetic '+id,author:'Test narrator',duration:18,cover:null,progress:{track:0,time:0},tracks:[{key:id+'a',name:'Track one',duration:9},{key:id+'b',name:'Track two',duration:9}],chapters:[{track:0,time:0,title:'One'},{track:1,time:0,title:'Two'}],bookmarks:[]});
 const books=[fixture('book-a'),fixture('book-b')];let extra=false,config={},queue={state:'idle'},win,fullBounds,failSetup=false;
 const handlers={
  'get-library':()=>({books,folders:[],profile:'Default',profiles:['Default'],settings:{}}),
  'ai-engine-status':()=>({installed:true,ready:true}),
  'ai-vibe-ready':()=>{if(failSetup)throw Error('Synthetic setup failure');return {ready:true};},
  'ai-auto-start':()=>({state:'running',message:'Synthetic live transcript'}),
  'ai-auto-position':()=>true,'ai-transcript-cancel':()=>({state:'idle'}),
  'compact-player':(_,enabled)=>{if(enabled){fullBounds=win.getBounds();win.setSize(560,330);}else win.setBounds(fullBounds);return enabled;},
  'ai-vibe-config':(_,changes)=>{if(changes)config={...config,...changes};return config;},
  'ai-vibe-devices':()=>[{index:1,description:'Synthetic NVIDIA device'}],
  'ai-transcript-status':()=>({state:'idle'}),'ai-book-status':()=>queue,
  'ai-transcript-get':(_,id,track)=>({segments:track===0?[{start:0.1,end:1,text:id+' opening'},{start:3,end:5,text:id+' second passage'}]:[{start:0,end:2,text:id+' track two'},...(extra?[{start:4,end:6,text:'New background result'}]:[])],completedChunks:[0]}),
  'ai-transcript-search':()=>[],'save-progress':()=>true,'updater-status':()=>({state:'disabled'}),
  'ai-book-start':(_,id)=>queue={state:'running',id,title:id,total:2,done:0,percent:0,message:'Synthetic queue running'},
  'ai-book-pause':()=>queue={...queue,state:'paused'},'ai-book-resume':()=>queue={...queue,state:'running'},'ai-book-cancel':()=>queue={...queue,state:'cancelled'}
 };
 for(const [name,fn] of Object.entries(handlers))ipcMain.handle(name,fn);
 win=new BrowserWindow({show:false,width:1300,height:950,webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false,offscreen:true}});
 const errors=[];win.webContents.on('console-message',(_,level,message)=>{if(level===3)errors.push(message);});
 await win.loadFile(path.join(root,'index.html'));
 const js=code=>win.webContents.executeJavaScript(code,true);
 const capture=async()=>{await new Promise(r=>setTimeout(r,120));return (await win.webContents.capturePage()).toPNG();};
 async function until(code){const end=Date.now()+5000;while(Date.now()<end){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait failed: '+code);}
 await until("document.querySelectorAll('.book').length===2");await js("document.querySelector('.book').click()");
 await until("document.querySelectorAll('.transcript-passage').length===2");
 assert.match(await js("document.getElementById('reader-status').textContent"),/saved section/);
 await js("document.querySelector('.transcript-passage').click()");await until("audio.readyState>=1");
 await js("audio.pause();audio.currentTime=3.5;audio.dispatchEvent(new Event('timeupdate'))");
 assert.match(await js("document.querySelector('.transcript-passage.spoken')?.textContent"),/second passage/);
 await js("audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'))");assert.equal(await js("document.querySelector('.transcript-passage.spoken')===null"),true);
 await js("document.getElementById('reader-scroll').click()");assert.equal(await js("localStorage.getItem('reader-follow')"),'false');
 await js("document.getElementById('detail-chapters').click()");
 assert.equal(await js("document.getElementById('chapter-drawer').open"),true);
 assert.deepEqual(await js("[...document.querySelectorAll('#chapters .chapter-time')].map(el=>el.textContent)"),['00:09','00:09']);
 assert.equal(await js("document.querySelector('#chapters button').textContent.includes('?')"),false);
 assert.equal(await js("(()=>{const row=document.querySelector('#chapters button');const title=row.querySelector('.chapter-title').getBoundingClientRect();const time=row.querySelector('.chapter-time').getBoundingClientRect();return title.right<=time.left&&getComputedStyle(row.querySelector('.chapter-time')).textAlign==='right'})()"),true);

 await js("renderChapters({...selected,tracks:[{duration:180}],chapters:[{track:0,time:0,title:'Opening'},{track:0,time:60,title:'Middle'},{track:0,time:120,title:'End'}]})");
 assert.deepEqual(await js("[...document.querySelectorAll('#chapters .chapter-time')].map(el=>el.textContent)"),['Starts at 00:00','Starts at 01:00','Starts at 02:00']);
 await js("renderChapters({...selected,tracks:[{name:'Unknown'}],chapters:[]})");
 assert.equal(await js("document.querySelector('#chapters .chapter-time').textContent"),'Duration unavailable');
 await js("renderChapters(selected)");
 await js("document.getElementById('chapter-search').value='missing';document.getElementById('chapter-search').dispatchEvent(new Event('input'))");
 assert.equal(await js("document.getElementById('chapter-empty').hidden"),false);
 await js("document.getElementById('chapter-search').value='';document.getElementById('chapter-search').dispatchEvent(new Event('input'));document.querySelectorAll('#chapters button')[1].click()");await until("document.querySelector('.transcript-passage')?.textContent==='book-a track two'");
 await until("document.querySelector('#chapters [aria-current]')?.dataset.track==='1'");
 await js("document.getElementById('close-chapters').click()");
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
 await js("document.getElementById('ai-live').click()");await until("document.getElementById('ai-live-status').textContent.includes('Live transcript started')");
 assert.equal(await js("document.getElementById('ai-auto').checked"),true);
 await js("document.getElementById('ai-cancel').click()");
 failSetup=true;await js("document.getElementById('ai-live').click()");await until("document.getElementById('ai-live-status').textContent.includes('Synthetic setup failure')");
 assert.equal(await js("document.getElementById('ai-advanced').open"),true);
 const fits=()=>js(`(()=>{const viewport=innerWidth;const elements=[...document.querySelectorAll('#player button,#player select,.detail-actions button,#ai-advanced select')];return elements.filter(el=>el.getClientRects().length).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=viewport+1})&&document.documentElement.scrollWidth<=viewport})()`);
 for(const width of [1300,1000,780,560,420]){
  win.setSize(width,950);await new Promise(r=>setTimeout(r,100));assert.equal(await fits(),true,'controls fit at '+width);
  await js("document.getElementById('detail-chapters').click()");
  assert.equal(await js("document.getElementById('chapter-drawer').getBoundingClientRect().right<=innerWidth+1"),true);
  win.webContents.send('library-changed');await new Promise(r=>setTimeout(r,100));
  assert.equal(await js("document.querySelectorAll('#chapters button').length"),2,'library refresh preserves open drawer');
  await js("document.getElementById('close-chapters').click()");
  await until("document.activeElement.id==='detail-chapters'");
  await fs.writeFile(path.join(testRoot,'responsive-'+width+'.png'),await capture());
 }
 // Sidebar navigation must not reset playback or resurrect the detail overlay on refresh.
 await js("showDetail(books[0]);playBook(books[0],0,2)");
 await until("audio.readyState>=1&&!audio.paused&&audio.currentTime>=2");
 for(const destination of ['favorites','stats','all','continue','finished','folders']){
  await js("showDetail(books[1]);persist()");
  const before=await js("({id:active.id,track:trackIndex,time:audio.currentTime,src:audio.src,progress:JSON.stringify(active.progress)})");
  await js(`document.getElementById('${destination}').click();refresh()`);
  assert.equal(await js("document.getElementById('detail').hidden"),true,destination+' closes detail');
  assert.equal(await js("audio.paused"),false,destination+' preserves playback');
  assert.deepEqual(await js("({id:active.id,track:trackIndex,src:audio.src,progress:JSON.stringify(active.progress)})"),{id:before.id,track:before.track,src:before.src,progress:before.progress});
  assert.ok(await js("audio.currentTime")>=before.time,destination+' preserves position');
  await js("document.getElementById('player-chapters').click()");
  assert.equal(await js("chapterBook.id===active.id&&document.getElementById('chapter-drawer').open"),true);
  await js("document.getElementById('close-chapters').click()");
 }
 await js("showDetail(books[0]);document.getElementById('close-detail').click();refresh()");
 assert.equal(await js("document.getElementById('detail').hidden"),true,'Close stays closed after refresh');
 await js("document.getElementById('mini').click()");await until("document.body.classList.contains('mini-mode')");
 for(const size of [[560,330],[420,300]]){win.setSize(...size);await new Promise(r=>setTimeout(r,100));assert.equal(await fits(),true,'compact controls fit '+size);assert.equal(await js("document.getElementById('player').scrollHeight<=innerHeight"),true);await fs.writeFile(path.join(testRoot,'compact-'+size[0]+'.png'),await capture());}
 await js("document.getElementById('mini').click()");await until("!document.body.classList.contains('mini-mode')");
 assert.equal(await js("document.getElementById('detail').hidden"),true,'compact round trip preserves closed details');
 await js("document.getElementById('player-chapters').click();document.querySelectorAll('#chapters button')[1].click()");
 await until("trackIndex===1&&audio.readyState>=1&&!audio.paused");
 await js("audio.pause();persist();document.getElementById('close-chapters').click()");
 assert.equal(await js("active.progress.track"),1,'drawer selection still saves progress');
 // Real DOM switching and saved preferences across a renderer restart.
 win.setSize(1300,950);
 assert.equal(await js("document.documentElement.dataset.theme"),'original-purple');
 for(const theme of require('../themes.js').themes){
  await js("document.getElementById('settings').click()");
  assert.equal(await js("!document.getElementById('settings-panel').hidden&&document.getElementById('detail').hidden"),true);
  assert.equal(await js("document.querySelectorAll('nav .active').length===1&&document.getElementById('settings').classList.contains('active')"),true);
  assert.equal(await js("document.querySelectorAll('[data-brand-logo]').length"),2);
  await js(`document.querySelector('[name=appearance-theme][value="${theme.id}"]').click()`);
  assert.equal(await js("document.documentElement.dataset.theme"),theme.id);
  assert.equal(await js("EverTaleThemes.normalize(localStorage.getItem(EverTaleThemes.storageKey))"),theme.id);
  await until("[...document.querySelectorAll('[data-brand-logo]')].every(img=>img.complete&&img.naturalWidth>0)");
  assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"),theme.bg);
  await js("void(window.smokeDialog=askFields('Bookmark note',[{label:'Note',value:''}]))");
  assert.equal(await js("getComputedStyle(document.querySelector('.field-dialog')).backgroundColor===getComputedStyle(document.getElementById('settings-panel')).backgroundColor"),true,'bookmark/edit dialogs follow theme');
  await js("document.querySelector('.field-dialog .ghost').click()");
  assert.equal(await js("window.smokeDialog"),null);
  assert.equal(await fits(),true,theme.id+' normal controls fit');
  await fs.writeFile(path.join(testRoot,theme.id+'-appearance.png'),await capture());
  for(const destination of ['favorites','stats','all']){
   await js(`showDetail(books[0]);document.getElementById('${destination}').click();refresh()`);
   assert.equal(await js("document.getElementById('detail').hidden"),true,theme.id+' '+destination+' keeps details closed');
   assert.equal(await js("document.documentElement.dataset.theme"),theme.id);
  }
  await js("showDetail(books[0]);document.getElementById('detail-chapters').click()");
  assert.equal(await js("getComputedStyle(document.getElementById('chapter-drawer')).backgroundColor===getComputedStyle(document.querySelector('.ai-panel')).backgroundColor"),true,'drawer and transcript share themed surface');
  await fs.writeFile(path.join(testRoot,theme.id+'-chapters.png'),await capture());
  await js("document.getElementById('close-chapters').click();document.getElementById('close-detail').click();document.getElementById('mini').click()");
  await until("document.body.classList.contains('mini-mode')");
  for(const size of [[560,330],[420,300]]){
   win.setSize(...size);await new Promise(r=>setTimeout(r,60));
   assert.equal(await fits(),true,theme.id+' compact '+size);
   assert.equal(await js("document.getElementById('player').scrollHeight<=innerHeight"),true);
   await fs.writeFile(path.join(testRoot,theme.id+'-compact-'+size[0]+'.png'),await capture());
  }
  await js("document.getElementById('mini').click()");await until("!document.body.classList.contains('mini-mode')");
  win.setSize(1300,950);
 }
 await win.reload();await until("document.querySelectorAll('.book').length===2");
 assert.equal(await js("document.documentElement.dataset.theme"),'midnight','theme persists through renderer restart');
 await js("document.getElementById('settings').click()");
 assert.equal(await js("document.querySelector('[name=appearance-theme]:checked').value"),'midnight');
 await fs.writeFile(path.join(testRoot,'reader.png'),await capture());
 assert.deepEqual(errors,[]);
 console.log('PASS: all six themes/normal/compact/restart persistence, sidebar navigation/refresh/playback preservation, reader, chapter drawer/filter/highlight, live transcript success/failure, Advanced, queue controls, GPU selector, responsive layouts and compact player. Screenshots: '+testRoot);
 clearTimeout(timeout);win.destroy();app.exit(0);
}).catch(e=>{console.error(e.stack);clearTimeout(timeout);app.exit(1);});
