// Opt-in smoke test: uses a real, locally supplied Vibe server, model and speech WAV.
// VIBE_TEST_BINARY, VIBE_TEST_MODEL and VIBE_TEST_AUDIO must be absolute paths.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createTestDirectory}=require('./helpers.cjs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createTranscription}=require(process.env.VIBE_TEST_MODULE||'../ai-transcription.cjs');
const enabled=['VIBE_TEST_BINARY','VIBE_TEST_MODEL','VIBE_TEST_AUDIO'].every(k=>process.env[k]);

test('real Vibe: start, load, bundled FFmpeg, timestamped transcription, search and resume',{
 skip:!enabled,timeout:180000,
},async t=>{
 const dir=await createTestDirectory('evertale-vibe-smoke-');
 const app=new EventEmitter();app.getPath=()=>dir;
 const handlers=new Map(),statuses=[];
 // Teardown owns only the server started by this integration, never an external server.
 t.after(async()=>{app.emit('before-quit');await new Promise(r=>setTimeout(r,300));await fs.rm(dir,{recursive:true,force:true});});
 await fs.writeFile(path.join(dir,'vibe-config.json'),JSON.stringify({binary:process.env.VIBE_TEST_BINARY,model:process.env.VIBE_TEST_MODEL}));
 createTranscription({app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getWindow:()=>({isDestroyed:()=>false,webContents:{send:(_,s)=>statuses.push(s)}}),getBooks:()=>[{id:'smoke',tracks:[{key:'speech',duration:15},{key:'speech-two',duration:15}]}],getTrackPath:()=>process.env.VIBE_TEST_AUDIO});
 const call=(name,...args)=>handlers.get(name)(null,...args);
 assert.deepEqual(await call('ai-vibe-ready'),{ready:true});
 assert.equal((await call('ai-engine-status')).ready,true);
 await call('ai-transcript-start','smoke',0,{});
 const deadline=Date.now()+120000;
 while(Date.now()<deadline&&!statuses.some(s=>['completed','error'].includes(s.state)))await new Promise(r=>setTimeout(r,100));
 const status=await call('ai-transcript-status');assert.equal(status.state,'completed',JSON.stringify(status));
 const data=await call('ai-transcript-get','smoke',0);
 assert.deepEqual(data.completedChunks,[0]);assert.ok(data.segments.length>0);
 assert.ok(data.segments.every(s=>Number.isFinite(s.start)&&s.end>=s.start&&s.text));
 const word=data.segments[0].text.trim().split(/\s+/)[0];
 assert.ok((await call('ai-transcript-search','smoke',word)).length>0);
 assert.equal((await call('ai-transcript-start','smoke',0,{})).message,'Track already transcribed');
 await call('ai-book-start','smoke');
 const bookDeadline=Date.now()+120000;
 while(Date.now()<bookDeadline&&(await call('ai-book-status')).state==='running')await new Promise(r=>setTimeout(r,100));
 const bookStatus=await call('ai-book-status');assert.equal(bookStatus.state,'completed',JSON.stringify(bookStatus));assert.equal(bookStatus.done,2);
 assert.deepEqual((await call('ai-transcript-get','smoke',1)).completedChunks,[0]);
 assert.equal((await fs.readdir(path.join(dir,'ai-transcripts'))).filter(f=>f.endsWith('.wav')).length,0);
 t.diagnostic(data.segments.map(s=>s.text).join(' '));
});
