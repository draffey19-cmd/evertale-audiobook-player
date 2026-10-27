(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EverTaleReader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function currentSegment(segments,time){
  // End timestamps are exclusive: a gap must not highlight the preceding sentence.
  let low=0,high=segments.length-1,index=-1;
  while(low<=high){const mid=(low+high)>>1;if(segments[mid].start<=time){index=mid;low=mid+1;}else high=mid-1;}
  for(let i=index;i>=0;i--)if(time>=segments[i].start&&time<segments[i].end)return i;
  return -1;
 }
 function createReader({container,status,scrollToggle,getContext,load,seek,format}){
  let contextKey='',generation=0,segments=[],nodes=[],highlight=-1,loaded=false;
  const key=c=>c?JSON.stringify([c.id,c.track]):'';
  function update(){
   const context=getContext();
   if(key(context)!==contextKey){void refresh();return;}
   const index=context?.playingTrack?currentSegment(segments,context.time):-1;
   if(index===highlight)return;
   if(nodes[highlight]){nodes[highlight].classList.remove('spoken');nodes[highlight].removeAttribute('aria-current');}
   highlight=index;
   if(nodes[index]){
    nodes[index].classList.add('spoken');nodes[index].setAttribute('aria-current','true');
    if(scrollToggle.checked){
     const item=nodes[index],top=item.offsetTop-container.offsetTop;
     if(top<container.scrollTop||top+item.offsetHeight>container.scrollTop+container.clientHeight)container.scrollTo({top:Math.max(0,top-container.clientHeight/3),behavior:'smooth'});
    }
   }
  }
  async function refresh(){
   const context=getContext(),nextKey=key(context),token=++generation;
   const changed=nextKey!==contextKey;contextKey=nextKey;
   if(changed){segments=[];nodes=[];highlight=-1;loaded=false;container.replaceChildren();}
   if(!context){status.textContent='Select an audiobook to read its saved transcript.';return;}
   if(!loaded)status.textContent='Loading saved transcript...';
   try{
    const data=await load(context.id,context.track);
    if(token!==generation||key(getContext())!==nextKey)return;
    segments=(data?.segments||[]).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>=s.start&&typeof s.text==='string').slice().sort((a,b)=>a.start-b.start);
    nodes=segments.map(s=>{
     const button=container.ownerDocument.createElement('button');button.type='button';button.className='transcript-passage';
     button.textContent=s.text;button.title='Listen from '+format(s.start);button.setAttribute('aria-label',format(s.start)+': '+s.text);
     button.addEventListener('click',()=>seek(context.id,context.track,s.start));return button;
    });
    container.replaceChildren(...nodes);highlight=-1;loaded=true;
    const sections=data?.completedChunks?.length||0;
    status.textContent=context.name+' | '+(segments.length?`${sections} saved section(s). Gaps may not be transcribed yet.`:'No saved speech here yet. Transcribe a section or enable background transcription.');
    update();
   }catch(e){if(token===generation)status.textContent='Cannot load transcript: '+e.message;}
  }
  scrollToggle.addEventListener('change',()=>{highlight=-1;for(const n of nodes){n.classList.remove('spoken');n.removeAttribute('aria-current');}update();});
  return {refresh,update};
 }
 return {currentSegment,createReader};
});
