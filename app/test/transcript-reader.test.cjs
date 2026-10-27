const {test}=require('node:test');
const assert=require('node:assert/strict');
const {currentSegment,createReader}=require('../transcript-reader.js');
const segments=[{start:1,end:3,text:'first'},{start:5,end:7,text:'second'}];
test('reader highlights timestamp ranges and clears gaps, ends and pre-roll',()=>{
 for(const [time,index] of [[0,-1],[1,0],[2.9,0],[3,-1],[4,-1],[5,1],[7,-1]])assert.equal(currentSegment(segments,time),index);
 assert.equal(currentSegment([],1),-1);
 assert.equal(currentSegment([{start:1,end:4},{start:2,end:3}],3.5),0);
});
function element(){
 const handlers={},attributes={},classes=new Set();
 return {children:[],offsetTop:200,offsetHeight:40,scrollTop:0,clientHeight:100,checked:true,
  classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
  setAttribute:(k,v)=>{attributes[k]=v;},removeAttribute:k=>{delete attributes[k];},getAttribute:k=>attributes[k],
  addEventListener:(k,fn)=>{handlers[k]=fn;},fire:k=>handlers[k]?.(),
  replaceChildren(...children){this.children=children;},scrollTo(value){this.lastScroll=value;},
  ownerDocument:{createElement:()=>element()}
 };
}
function setup(load){
 const container=element(),status=element(),scrollToggle=element(),seeks=[];
 let context={id:'a',track:0,name:'Chapter one',time:1,playingTrack:true};
 const reader=createReader({container,status,scrollToggle,getContext:()=>context,load,seek:(...args)=>seeks.push(args),format:String});
 return {container,status,scrollToggle,reader,seeks,setContext:c=>{context=c;},get context(){return context;}};
}
test('saved partial text is clickable, highlights playback and supports manual scrolling',async()=>{
 let calls=0;const h=setup(async()=>{calls++;return {segments,completedChunks:[0]};});
 await h.reader.refresh();assert.equal(calls,1);assert.equal(h.container.children.length,2);
 assert.equal(h.container.children[0].getAttribute('aria-current'),'true');
 h.container.children[1].fire('click');assert.deepEqual(h.seeks,[['a',0,5]]);
 h.scrollToggle.checked=false;h.context.time=5;h.reader.update();
 assert.equal(h.container.lastScroll,undefined);assert.equal(calls,1);
 assert.equal(h.container.children[1].classList.contains('spoken'),true);
 h.context.time=4;h.reader.update();assert.equal(h.container.children[1].getAttribute('aria-current'),undefined);
});
test('out-of-order loads cannot display text for the wrong book/track',async()=>{
 let resolve;const h=setup((id)=>id==='a'?new Promise(r=>{resolve=r;}):Promise.resolve({segments:[{start:0,end:2,text:'book b'}]}));
 const old=h.reader.refresh();h.setContext({id:'b',track:1,name:'Other',time:0,playingTrack:false});
 await h.reader.refresh();resolve({segments});await old;
 assert.equal(h.container.children[0].textContent,'book b');assert.equal(h.container.children[0].getAttribute('aria-current'),undefined);
});
test('new background results refresh saved text without calling transcription',async()=>{
 let data=null;const h=setup(async()=>data);await h.reader.refresh();assert.match(h.status.textContent,/No saved speech/);
 data={segments,completedChunks:[0]};await h.reader.refresh();assert.equal(h.container.children.length,2);
 h.setContext(null);await h.reader.refresh();assert.equal(h.container.children.length,0);
});
