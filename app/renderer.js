const $=id=>document.getElementById(id);
let desiredSpeed=1;
let books=[],folders=[],selected=null,active=null,trackIndex=0,sleepTimer=null,sleepEnd=0,mode='all',lastBook=null,profile='Default',settings={},sleepChapter=false,mini=false;
const audio=$('audio');
let transcriptReader=null;

// Electron does not implement the browser's native window.prompt().
// Use an in-app dialog instead, including for optional bookmark notes.
function askFields(title, fields){
  return new Promise(resolve=>{
    const backdrop=document.createElement('div');
    backdrop.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100000;padding:20px';
    const form=document.createElement('form');
    form.style.cssText='background:#202934;color:#fff;padding:24px;border:1px solid #526070;border-radius:16px;width:min(440px,100%);box-shadow:0 18px 70px #0009;display:grid;gap:14px';
    const heading=document.createElement('h2');heading.textContent=title;heading.style.margin='0 0 6px';form.append(heading);
    const inputs=[];
    for(const field of fields){
      const label=document.createElement('label');label.textContent=field.label;label.style.cssText='display:grid;gap:6px;font-size:14px';
      const input=document.createElement('input');input.type='text';input.value=field.value||'';input.maxLength=field.maxLength||300;
      input.style.cssText='width:100%;box-sizing:border-box;padding:10px;background:#111923;color:white;border:1px solid #6b7888;border-radius:8px;font-size:15px';
      label.append(input);form.append(label);inputs.push(input);
    }
    const actions=document.createElement('div');actions.style.cssText='display:flex;justify-content:flex-end;gap:10px;margin-top:8px';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
    const save=document.createElement('button');save.type='submit';save.textContent='Save';save.style.cssText='background:#d6a65c;color:#17191b;padding:9px 18px;border-radius:8px;font-weight:bold';
    actions.append(cancel,save);form.append(actions);backdrop.append(form);document.body.append(backdrop);
    const finish=value=>{backdrop.remove();resolve(value)};
    cancel.onclick=()=>finish(null);
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)finish(null)});
    form.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(null)}});
    form.onsubmit=e=>{e.preventDefault();finish(inputs.map(x=>x.value))};
    inputs[0]?.focus();inputs[0]?.select();
  });
}

const duration=s=>{s=Math.floor(Number(s)||0);return `${Math.floor(s/3600)?Math.floor(s/3600)+':':''}${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
function cover(el,uri){el.replaceChildren();if(uri){const img=document.createElement('img');img.src=uri;img.alt='Book cover';el.append(img);}else el.textContent='♫';}
function button(label,fn,cls=''){const b=document.createElement('button');b.textContent=label;b.className=cls;b.addEventListener('click',fn);return b;}
async function refresh(result){const data=await window.hearth.library();books=data.books;folders=data.folders||folders;lastBook=data.lastBook||lastBook;profile=data.profile||profile;settings=data.settings||settings;if(data.profiles){$('profile').replaceChildren();for(const name of data.profiles){const o=document.createElement('option');o.value=name;o.textContent=name;$('profile').append(o);}$('profile').value=profile;}render();if(active){const updated=books.find(x=>x.id===active.id);if(updated)active={...updated,progress:active.progress};}if(selected){selected=books.find(x=>x.id===selected.id);if(selected)showDetail(selected);else $('detail').hidden=true;}}
function render(){
  const query=$('search').value.trim().toLowerCase();let list=books.filter(b=>(b.title+' '+b.author).toLowerCase().includes(query));
  if(mode==='favorites')list=list.filter(b=>b.favorite);if(mode==='finished')list=list.filter(b=>b.finished);if(mode==='continue')list=list.filter(b=>b.progress.time>0||b.isLast);
  const sort=$('sort').value;if(sort==='author')list.sort((a,b)=>a.author.localeCompare(b.author));else if(sort==='recent')list.sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0));else list.sort((a,b)=>a.title.localeCompare(b.title));
  $('heading').textContent=mode==='continue'?'Continue Listening':mode==='folders'?'Library Folders':mode==='favorites'?'Favorites':mode==='finished'?'Finished Books':mode==='stats'?'Listening Statistics':'My Audiobooks';
  $('subhead').textContent=`${books.length} audiobook${books.length===1?'':'s'} in your collection`;
  $('stats-panel').hidden=mode!=='stats';if(mode==='stats'){$('stats-panel').textContent=`${books.length} books · ${books.filter(b=>b.finished).length} finished · ${books.filter(b=>b.favorite).length} favorites · ${duration(books.reduce((n,b)=>n+b.duration,0))} total library duration`;}$('folders-panel').hidden=mode!=='folders';$('folders-panel').replaceChildren();
  if(mode==='folders')for(const folder of folders){const row=document.createElement('div');row.className='folder-row';const label=document.createElement('span');label.textContent=folder;row.append(label,button('Remove',async()=>{if(confirm(`Remove this folder from your library?\n${folder}\n\nOriginal files will not be deleted.`)){await refresh(await window.hearth.removeFolder(folder));}},'ghost'));$('folders-panel').append(row);}
  $('library').replaceChildren();$('empty').hidden=!!list.length||mode==='folders'||mode==='stats';if(mode==='stats')list=[];
  for(const b of list){const item=document.createElement('article');item.className='book';item.tabIndex=0;const art=document.createElement('div');art.className='cover';cover(art,b.cover);const title=document.createElement('h3');title.textContent=b.title;const author=document.createElement('p');author.textContent=b.author;item.append(art,title,author);if(b.favorite){const star=document.createElement('span');star.textContent='★ Favorite';star.className='book-label';item.append(star);}if(b.finished){const done=document.createElement('span');done.textContent='✓ Finished';done.className='book-label';item.append(done);}const p=document.createElement('div');p.className='progress';const bar=document.createElement('i');let elapsed=b.tracks.slice(0,b.progress.track).reduce((sum,t)=>sum+t.duration,0)+b.progress.time;bar.style.width=`${b.duration?Math.min(100,100*elapsed/b.duration):0}%`;p.append(bar);item.append(p);item.addEventListener('click',()=>showDetail(b));item.addEventListener('keydown',e=>{if(e.key==='Enter')showDetail(b)});$('library').append(item);}
}
function showDetail(b){const priorQuery=selected?.id===b.id?$('chapter-search').value:'';selected=b;$('detail').hidden=false;cover($('detail-cover'),b.cover);$('detail-title').textContent=b.title;$('detail-author').textContent=b.author;$('detail-duration').textContent=`${duration(b.duration)} · ${b.tracks.length} file${b.tracks.length===1?'':'s'}`;$('chapters').replaceChildren();$('favorite').textContent=b.favorite?'★ Unfavorite':'☆ Favorite';$('finished-btn').textContent=b.finished?'↶ Mark unfinished':'✓ Mark finished';$('bookmarks').replaceChildren();for(const [markIndex,mark] of (b.bookmarks||[]).entries()){const row=document.createElement('div');row.className='bookmark-row';const jump=button(`${b.tracks[mark.track]?.name||'Chapter'} · ${duration(mark.time)} · ${mark.note||'Bookmark'}`,()=>playBook(b,mark.track,mark.time),'chapter');jump.title='Play from this bookmark';const remove=button('Remove',async()=>{if(!confirm('Remove this bookmark?'))return;try{const remaining=(selected?.bookmarks||[]).filter((_,i)=>i!==markIndex);await window.hearth.property('bookmarks',b.id,remaining);await refresh();}catch(e){alert('Could not remove bookmark: '+e.message);}},'ghost');remove.title='Remove bookmark';row.append(jump,remove);$('bookmarks').append(row);}
  const chapters=b.chapters.length?b.chapters:b.tracks.map((t,i)=>({track:i,time:0,title:t.name}));
  if(!chapters.length){const p=document.createElement('p');p.textContent='No embedded chapters detected.';$('chapters').append(p);}
  for(const c of chapters){const el=button(c.title,()=>playBook(b,c.track,c.time),'chapter');el.dataset.title=c.title.toLowerCase();$('chapters').append(el);} $('chapter-search').value=priorQuery; $('chapter-search').dispatchEvent(new Event('input'));transcriptReader?.refresh();
}
async function playBook(b,index=null,time=null){if(!b?.tracks.length)return;active=b;trackIndex=index??Math.min(b.progress.track||0,b.tracks.length-1);let start=time??b.progress.time??0;start=Math.max(0,start);$('player').hidden=false;cover($('mini-cover'),b.cover);$('now-title').textContent=b.title;$('now-author').textContent=b.author;loadTrack(start,true);}
function loadTrack(start=0,autoplay=false){if(!active)return;transcriptReader?.refresh();const track=active.tracks[trackIndex];if(!track)return;audio.src=`hearth-media://${track.key}/audio`;audio.load();audio.playbackRate=desiredSpeed;audio.addEventListener('loadedmetadata',function setStart(){audio.removeEventListener('loadedmetadata',setStart);if(Number.isFinite(audio.duration))audio.currentTime=Math.min(start,Math.max(0,audio.duration-0.1));if(autoplay)audio.play().catch(()=>{});},{once:false});updatePlay();}
function updatePlay(){$('toggle').textContent=audio.paused?'▶':'Ⅱ';}
function seekChapter(direction){
  if(!active)return;
  const chapters=active.chapters.slice().sort((a,b)=>a.track-b.track||a.time-b.time);
  const here=audio.currentTime;
  if(direction<0){
    const prev=chapters.filter(c=>c.track<trackIndex||(c.track===trackIndex&&c.time<here-2)).pop();
    if(prev){if(prev.track===trackIndex)audio.currentTime=prev.time;else{trackIndex=prev.track;loadTrack(prev.time,true);}}
    else audio.currentTime=0;
  }else{
    const next=chapters.find(c=>c.track>trackIndex||(c.track===trackIndex&&c.time>here+1));
    if(next){if(next.track===trackIndex)audio.currentTime=next.time;else{trackIndex=next.track;loadTrack(next.time,true);}}
  }
}
let lastSaved=0;function persist(){if(!active)return;active.progress={track:trackIndex,time:audio.currentTime||0};lastBook=active.id;window.hearth.progress(active.id,active.progress).catch(console.error);}
function tick(){const len=Number.isFinite(audio.duration)?audio.duration:active?.tracks[trackIndex]?.duration||0;$('current').textContent=duration(audio.currentTime);$('total').textContent=duration(len);$('seek').value=len?Math.min(100,audio.currentTime/len*100):0;if(Date.now()-lastSaved>5000){persist();lastSaved=Date.now();}if(sleepEnd&&Date.now()>=sleepEnd){audio.pause();sleepEnd=0;$('sleep').value='0';}}
$('add').onclick=$('empty-add').onclick=async()=>{const result=await window.hearth.addFolder();if(result)await refresh(result);};$('scan').onclick=async()=>{ $('scan').textContent='Scanning…';try{await refresh(await window.hearth.rescan());}finally{$('scan').innerHTML=svgIcon('refresh')+'<span>Rescan</span>';}};
$('all').onclick=()=>changeMode('all');$('continue').onclick=()=>changeMode('continue');$('folders').onclick=()=>changeMode('folders');function changeMode(m){mode=m;for(const id of ['all','continue','favorites','finished','stats','folders'])$(id).classList.toggle('active',id===m);render();}
$('favorites').onclick=()=>changeMode('favorites');$('finished').onclick=()=>changeMode('finished');$('stats').onclick=()=>changeMode('stats');$('search').oninput=render;$('sort').onchange=render;$('close-detail').onclick=()=>{$('detail').hidden=true};$('detail-play').onclick=()=>playBook(selected);
$('edit').onclick=async()=>{if(!selected)return;const id=selected.id;const values=await askFields('Edit audiobook details',[{label:'Title',value:selected.title},{label:'Author',value:selected.author}]);if(!values)return;try{await window.hearth.edit(id,{title:values[0].trim()||selected.title,author:values[1].trim()||selected.author});await refresh();}catch(e){alert('Could not save book details: '+e.message);}};
$('cover').onclick=async()=>{if(!selected)return;const result=await window.hearth.cover(selected.id);if(result)await refresh(result);};
$('toggle').onclick=()=>audio.paused?audio.play().catch(console.error):audio.pause();$('back').onclick=()=>audio.currentTime=Math.max(0,audio.currentTime-15);$('forward').onclick=()=>audio.currentTime=Math.min(audio.duration||Infinity,audio.currentTime+30);$('prev').onclick=()=>seekChapter(-1);$('next').onclick=()=>seekChapter(1);
$('seek').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(e.target.value)/100;};$('volume').oninput=e=>audio.volume=Number(e.target.value);
const speeds=[.75,1,1.1,1.25,1.5,1.75,2,2.5,3];$('speed').onclick=()=>{const index=speeds.indexOf(audio.playbackRate);audio.playbackRate=speeds[(index+1)%speeds.length];desiredSpeed=audio.playbackRate;$('speed').textContent=`${audio.playbackRate}×`;};
$('sleep').onchange=e=>{sleepChapter=e.target.value==='chapter';sleepEnd=Number(e.target.value)?Date.now()+Number(e.target.value)*60000:0;};
audio.addEventListener('timeupdate',()=>{if(sleepChapter&&active){const next=active.chapters.filter(c=>c.track===trackIndex&&c.time>0).sort((a,b)=>a.time-b.time).find(c=>c.time>audio.currentTime-0.5);if(next&&next.time-audio.currentTime<=0.5){audio.pause();audio.currentTime=next.time;sleepChapter=false;$('sleep').value='0';}}});audio.addEventListener('timeupdate',tick);audio.addEventListener('play',updatePlay);audio.addEventListener('pause',()=>{updatePlay();persist();render();});audio.addEventListener('ended',()=>{if(sleepChapter){audio.pause();sleepChapter=false;$('sleep').value='0';return;}if(active&&trackIndex<active.tracks.length-1){trackIndex++;loadTrack(0,true);persist();}else{persist();updatePlay();}});audio.addEventListener('error',()=>{if(audio.src){console.warn('Audio decode error:',audio.error?.message);alert('This audio file could not be played. The codec may not be supported or the file may have moved.');}});
window.addEventListener('beforeunload',persist);document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});window.hearth.onScanProgress(({phase,current,total,message})=>{
  const panel=$('scan-status');panel.hidden=false;
  if(window.hearthScanHideTimer){clearTimeout(window.hearthScanHideTimer);window.hearthScanHideTimer=null;}
  $('scan-label').textContent=phase==='complete'?'Library scan complete':phase==='discovering'?'Finding audiobooks…':'Reading audiobook information…';
  $('scan-count').textContent=phase==='discovering'?`${current} files found`:total?`${current} / ${total} files`:'';
  const bar=$('scan-progress');
  if(phase==='discovering'){bar.removeAttribute('value');}
  else {bar.value=total?Math.round(current/total*100):100;}
  $('scan-file').textContent=message||'';
  $('scan').disabled=phase!=='complete';$('add').disabled=phase!=='complete';
  if(phase==='complete'){refresh().catch(console.error);window.hearthScanHideTimer=setTimeout(()=>{panel.hidden=true;},2600);}
});
window.hearth.onChanged(()=>refresh());refresh();

$('chapter-search').oninput=e=>{for(const el of $('chapters').children)el.hidden=!el.dataset.title?.includes(e.target.value.toLowerCase());};
$('favorite').onclick=async()=>{if(!selected)return;await window.hearth.property('favorites',selected.id,!selected.favorite);await refresh();};
$('finished-btn').onclick=async()=>{if(!selected)return;await window.hearth.property('finished',selected.id,!selected.finished);await refresh();};
$('bookmark').onclick=async()=>{if(!selected)return;const isCurrent=active?.id===selected.id;const track=isCurrent?trackIndex:selected.progress.track;const time=isCurrent?audio.currentTime:selected.progress.time;const values=await askFields('Add bookmark',[{label:'Note (optional)',value:''}]);if(!values)return;const marks=[...(selected.bookmarks||[]),{track:Math.max(0,Number(track)||0),time:Math.max(0,Number(time)||0),note:values[0]}];try{await window.hearth.property('bookmarks',selected.id,marks);await refresh();}catch(e){alert('Could not save bookmark: '+e.message);}};
$('profile').onchange=async e=>{audio.pause();active=null;$('player').hidden=true;await refresh(await window.hearth.profile(e.target.value));};
$('new-profile').onclick=async()=>{const values=await askFields('New listener',[{label:'Listener name',value:'',maxLength:50}]);const name=values?.[0];if(name?.trim()){audio.pause();active=null;$('player').hidden=true;await refresh(await window.hearth.profile(name));}};
$('backup').onclick=()=>window.hearth.backup().catch(e=>alert(e.message));
$('restore').onclick=async()=>{if(!confirm('Restore saved library settings from backup?'))return;try{if(await window.hearth.restore())await refresh();}catch(e){alert(e.message);}};
$('mini').onclick=()=>{mini=!mini;document.body.classList.toggle('mini-mode',mini);};
const ctx=new (window.AudioContext||window.webkitAudioContext)();const source=ctx.createMediaElementSource(audio);const eq=ctx.createBiquadFilter();eq.type='peaking';eq.frequency.value=1800;eq.Q.value=.8;eq.gain.value=0;source.connect(eq);eq.connect(ctx.destination);
$('voice').onclick=()=>{eq.gain.value=eq.gain.value?0:5;$('voice').classList.toggle('active',!!eq.gain.value);ctx.resume().catch(()=>{});};
audio.addEventListener('play',()=>ctx.resume().catch(()=>{}));
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||e.ctrlKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();if(active)$('toggle').click();}else if(e.code==='ArrowLeft'&&active)audio.currentTime=Math.max(0,audio.currentTime-15);else if(e.code==='ArrowRight'&&active)audio.currentTime+=30;});

// Custom vector icons: independent of operating-system fonts and emoji rendering.
const glyphs={play:'<path d="m8 5 12 7-12 7z"/>',pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',previous:'<path d="M6 5v14M19 6l-10 6 10 6z"/>',next:'<path d="M18 5v14M5 6l10 6-10 6z"/>',back:'<path d="M4 11a8 8 0 1 1 2 6M4 5v6h6"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">15</text>',forward:'<path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">30</text>',library:'<rect x="4" y="3" width="5" height="18" rx="1"/><rect x="11" y="3" width="5" height="18" rx="1"/><path d="m18 5 3 15"/>',heart:'<path d="M20.8 8.6c0 4.2-8.8 10.4-8.8 10.4S3.2 12.8 3.2 8.6a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8z"/>',check:'<path d="m4 12 5 5L20 6"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',chart:'<path d="M4 20V11m6 9V5m6 15v-7m4 7V8"/>',refresh:'<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="M5 5 19 19M19 5 5 19"/>',edit:'<path d="m4 20 4-.8L20 7l-3-3L5 16z"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',mini:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 13h6v5h-6z"/>',volume:'<path d="M4 9h4l5-4v14l-5-4H4zM17 9a5 5 0 0 1 0 6"/>',headphones:'<path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h4v7H6a2 2 0 0 1-2-2zm12 0h4v5a2 2 0 0 1-2 2h-2z"/>'};
function svgIcon(name){return `<svg class="hearth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;}
const iconButtons={all:['library','Library'],continue:['play','Continue listening'],favorites:['heart','Favorites'],finished:['check','Finished'],stats:['chart','Statistics'],folders:['folder','Library folders'],scan:['refresh','Rescan'],add:['plus','Add folder'], 'empty-add':['folder','Choose audiobook folder'],'close-detail':['close','Close'], 'detail-play':['play','Listen'],edit:['edit','Edit details'],cover:['image','Change cover'],bookmark:['bookmark','Bookmark current position'],prev:['previous','Previous chapter'],back:['back','Back 15 seconds'],forward:['forward','Forward 30 seconds'],next:['next','Next chapter'],mini:['mini','Mini player']};
function applyIcons(){for(const [id,[name,label]] of Object.entries(iconButtons)){const el=$(id);if(!el)continue;el.innerHTML=svgIcon(name)+((label==='Close'||['prev','back','forward','next','mini'].includes(id))?'':`<span>${label}</span>`);el.setAttribute('aria-label',label);}}
applyIcons();
const oldUpdatePlay=updatePlay;
updatePlay=function(){const playing=!audio.paused;$('toggle').innerHTML=svgIcon(playing?'pause':'play');$('toggle').setAttribute('aria-label',playing?'Pause':'Play');};
updatePlay();

// Explicit, opt-in update workflow; never silently installs releases.
(async function setupUpdates(){
 const msg=document.getElementById('update-message'),btn=document.getElementById('update-action'),bar=document.getElementById('update-progress');
 const render=(s)=>{if(!s)return;msg.textContent=s.message||s.state;bar.hidden=s.state!=='downloading';if(!bar.hidden)bar.value=s.percent||0;btn.disabled=['checking','downloading','unavailable'].includes(s.state);btn.textContent=s.state==='available'?'Download update':s.state==='downloaded'?'Restart to install':'Check for updates';};
 let status=await window.hearth.updaterStatus();render(status);
 window.hearth.onUpdateStatus(s=>{status=s;render(s)});
 btn.addEventListener('click',async()=>{if(status.state==='available')status=await window.hearth.downloadUpdate();else if(status.state==='downloaded'){if(confirm('Restart EverTale and install the downloaded update?'))await window.hearth.installUpdate();return;}else status=await window.hearth.checkUpdates();render(status);});
})();

let aiSearchTimer=null;
async function showAiResults(){
 const b=selected;if(!b)return;const q=$('ai-search').value.trim();$('ai-results').replaceChildren();if(!q)return;
 try{const hits=await window.hearth.aiSearch(b.id,q);if(selected?.id!==b.id||$('ai-search').value.trim()!==q)return;
 if(!hits.length){$('ai-results').textContent='No matches in saved transcripts.';return;}
 for(const hit of hits)$('ai-results').append(button(duration(hit.start)+' · '+hit.text,()=>playBook(b,hit.track,hit.start),'chapter'));
 }catch(e){$('ai-results').textContent=e.message;}
}
$('ai-search').addEventListener('input',()=>{clearTimeout(aiSearchTimer);aiSearchTimer=setTimeout(showAiResults,250)});
$('ai-start').onclick=async()=>{
 if(!selected)return;const id=selected.id,track=active?.id===id?trackIndex:selected.progress.track||0;
 const options={position:active?.id===id?audio.currentTime:(selected.progress.time||0)};
 try{renderAi(await window.hearth.aiStart(id,track,options));}catch(e){$('ai-status').textContent=e.message;}
};
$('ai-cancel').onclick=async()=>{aiSyncVersion++;$('ai-auto').checked=false;await window.hearth.aiCancel();};
let aiPositionSent=0,aiSyncing=false,aiSyncVersion=0;
function aiOptions(){return {};}
async function syncAiPosition(force=false){
 if(aiSyncing||!$('ai-auto').checked||!active||audio.paused)return;
 if(!force&&Date.now()-aiPositionSent<5000)return;
 aiPositionSent=Date.now();
 const version=aiSyncVersion,id=active.id;aiSyncing=true;
 try{const ok=await window.hearth.aiAutoPosition(id,trackIndex,audio.currentTime);if(!ok&&version===aiSyncVersion&&$('ai-auto').checked&&!audio.paused&&active?.id===id)await window.hearth.aiAutoStart(id,trackIndex,audio.currentTime,aiOptions());}
 catch(e){if(version===aiSyncVersion){$('ai-status').textContent=e.message;$('ai-auto').checked=false;}}
 finally{aiSyncing=false;}
}
$('ai-auto').addEventListener('change',async()=>{
 aiSyncVersion++;
 if(!$('ai-auto').checked){await window.hearth.aiCancel();return;}
 if(!active){$('ai-status').textContent='Play an audiobook to start automatic transcription.';return;}
 try{await window.hearth.aiAutoStart(active.id,trackIndex,audio.currentTime,aiOptions());}catch(e){$('ai-status').textContent=e.message;$('ai-auto').checked=false;}
});
audio.addEventListener('timeupdate',()=>syncAiPosition());
audio.addEventListener('seeked',()=>syncAiPosition(true));
audio.addEventListener('play',()=>syncAiPosition(true));
function renderAi(s){if(!s)return;if(s.state==='error'){$('ai-auto').checked=false;aiSyncVersion++;}$('ai-status').textContent=s.message||s.state;$('ai-progress').value=s.percent||0;$('ai-start').disabled=['running','cancelling'].includes(s.state);$('ai-cancel').disabled=!['running','cancelling'].includes(s.state);if(s.sectionSaved||s.state==='completed')showAiResults();}
window.hearth.onAiStatus(renderAi);window.hearth.aiStatus().then(renderAi).catch(console.error);

window.hearth.aiVibeConfig().then(c=>{$('vibe-binary').value=c.binary||'';$('vibe-model').value=c.model||'';}).catch(console.error);
for(const kind of ['binary','model']){
 $('vibe-browse-'+kind).onclick=async()=>{
  try{const file=await window.hearth.aiVibeBrowse(kind);if(!file)return;const changes={[kind]:file};await window.hearth.aiVibeConfig(changes);$('vibe-'+kind).value=file;}
  catch(e){$('ai-engine-status').textContent=e.message;}
 };
}
$('vibe-test').onclick=async()=>{$('vibe-test').disabled=true;$('ai-engine-status').textContent='Starting Vibe and loading model…';try{await window.hearth.aiVibeReady();$('ai-engine-status').textContent='Vibe ready for transcription';}catch(e){$('ai-engine-status').textContent=e.message;}finally{$('vibe-test').disabled=false;}};
window.hearth.aiEngineStatus().then(s=>{$('ai-engine-status').textContent=!s.installed?'Vibe server not detected at 127.0.0.1:3030':s.ready?'Vibe server ready with model loaded':'Vibe server detected; load a speech model';}).catch(e=>{$('ai-engine-status').textContent=e.message;});


transcriptReader=window.EverTaleReader.createReader({
 container:$('reader-passages'),status:$('reader-status'),scrollToggle:$('reader-scroll'),
 getContext:()=>{if(!selected)return null;const playingTrack=active?.id===selected.id;const track=playingTrack?trackIndex:selected.progress.track||0;return {id:selected.id,track,name:selected.tracks[track]?.name||'Track',playingTrack,time:playingTrack?audio.currentTime:0};},
 load:(id,track)=>window.hearth.aiGet(id,track),format:duration,
 seek:(id,track,time)=>{const b=books.find(b=>b.id===id);if(b)playBook(b,track,time);}
});
$('reader-refresh').onclick=()=>transcriptReader.refresh();
try{$('reader-scroll').checked=localStorage.getItem('reader-follow')!=='false';}catch{}
$('reader-scroll').addEventListener('change',()=>{try{localStorage.setItem('reader-follow',String($('reader-scroll').checked));}catch{}});
for(const event of ['timeupdate','seeked','loadedmetadata'])audio.addEventListener(event,()=>transcriptReader.update());
window.hearth.onAiStatus(s=>{if(s.sectionSaved||s.state==='completed')transcriptReader.refresh();});


let bookQueueState={state:'idle'};
function renderBookQueue(s){
 bookQueueState=s;const running=s.state==='running';
 $('ai-book-status').textContent=(s.title?s.title+' | ':'')+(s.message||s.state)+(s.total?' | '+s.done+'/'+s.total+' sections ('+s.percent+'%)':'');
 $('ai-book-progress').value=s.percent||0;
 $('ai-book-start').disabled=running;$('ai-book-pause').disabled=!running;
 $('ai-book-resume').disabled=!s.id||!['paused','error','cancelled'].includes(s.state);
 $('ai-book-cancel').disabled=!s.id||['idle','cancelled','completed'].includes(s.state);
 if(running){$('ai-auto').checked=false;aiSyncVersion++;}
}
async function queueAction(action){try{renderBookQueue(await action());}catch(e){$('ai-book-status').textContent=e.message;}}
$('ai-book-start').onclick=()=>{if(selected)queueAction(()=>window.hearth.aiBookStart(selected.id));};
$('ai-book-pause').onclick=()=>queueAction(()=>window.hearth.aiBookPause());
$('ai-book-resume').onclick=()=>queueAction(()=>window.hearth.aiBookResume());
$('ai-book-cancel').onclick=()=>queueAction(()=>window.hearth.aiBookCancel());
window.hearth.onAiBookStatus(renderBookQueue);
window.hearth.aiBookStatus().then(renderBookQueue).catch(e=>{$('ai-book-status').textContent=e.message;});
