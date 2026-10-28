const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../renderer.js'),'utf8');
function setup(){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,open:false,classList:{toggle(){}},replaceChildren(){},append(){}});return nodes.get(id);};
 const book={id:'a',title:'Original',author:'Author',duration:100,tracks:[{}],bookmarks:[],progress:{track:0,time:12}};
 const context=vm.createContext({$:node,window:{hearth:{library:async()=>({books:[{...book,title:'Updated',progress:{track:0,time:0}}]})}},render(){},cover(){},duration(){},renderChapters(){},transcriptReader:null});
 vm.runInContext(source.split('\n')[2]+source.slice(source.indexOf('async function refresh('),source.indexOf('function render(){'))+source.slice(source.indexOf('function closeDetail('),source.indexOf('async function playBook('))+source.slice(source.indexOf('function changeMode('),source.indexOf("\n$('favorites').onclick")),context);
 context.book=book;
 vm.runInContext('showDetail(book);active=book;trackIndex=1;',context);
 return {context,node,run:code=>vm.runInContext(code,context)};
}
test('every sidebar destination closes details without changing playback or saved progress',async()=>{
 for(const mode of ['all','favorites','stats','continue','finished','folders','settings']){
  const {context,node,run}=setup();
  run(`changeMode('${mode}')`);
  assert.equal(node('detail').hidden,true,mode);
  assert.equal(run('detailVisible'),false);
  assert.equal(run('active'),context.book);
  assert.equal(run('trackIndex'),1);
  assert.equal(run('active.progress.time'),12);
  await run('refresh()');
  assert.equal(node('detail').hidden,true,'refresh after '+mode);
  assert.equal(run('selected.title'),'Updated');
  assert.equal(run('active.progress.time'),12);
 }
});
test('manual close survives refresh, and explicitly opening details enables later refreshes',async()=>{
 const {node,run}=setup();
 run('closeDetail()');await run('refresh()');
 assert.equal(node('detail').hidden,true);
 run('showDetail(selected)');await run('refresh()');
 assert.equal(node('detail').hidden,false);
 assert.equal(node('detail-title').textContent,'Updated');
});
test('refresh closes details when the selected book disappears',async()=>{
 const {context,node,run}=setup();
 context.window.hearth.library=async()=>({books:[]});
 await run('refresh()');
 assert.equal(node('detail').hidden,true);
 assert.equal(run('detailVisible'),false);
 assert.equal(run('active'),context.book);
});
test('navigation during an outstanding refresh cannot reopen details',async()=>{
 const {context,node,run}=setup();let resolve;
 context.window.hearth.library=()=>new Promise(r=>{resolve=r;});
 const refreshing=run('refresh()');run("changeMode('favorites')");
 resolve({books:[context.book]});await refreshing;
 assert.equal(node('detail').hidden,true);
 assert.equal(run('detailVisible'),false);
});
