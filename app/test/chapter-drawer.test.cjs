const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../renderer.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.match(/const duration=.*;/)[0]+source.slice(source.indexOf('function chapterTimeLabel('),source.indexOf('function renderChapters(')),context);
const label=(chapter,chapters,tracks)=>context.chapterTimeLabel(chapter,chapters,tracks);
test('separate files use their own metadata durations, including hours and fractions',()=>{
 const chapters=[{track:0,time:0},{track:1,time:0}];
 const tracks=[{duration:89.9},{duration:3723}];
 assert.equal(label(chapters[0],chapters,tracks).text,'01:29');
 assert.equal(label(chapters[1],chapters,tracks).text,'1:02:03');
});
test('unknown or invalid metadata never becomes a zero duration',()=>{
 const c={track:0,time:0};
 for(const duration of [undefined,null,0,-1,NaN,Infinity,'90',0.5])assert.equal(label(c,[c],[{duration}]).text,'Duration unavailable');
 assert.equal(label(c,[c],[]).text,'Duration unavailable');
});
test('embedded chapters preserve starts, including zero and the final chapter',()=>{
 const chapters=[{track:0,time:0},{track:0,time:60},{track:0,time:120}];
 for(const [i,c] of chapters.entries()){
  assert.equal(label(c,chapters,[{duration:180}]).text,['00:00','01:00','02:00'][i]);
  assert.equal(label(c,chapters,[]).kind,'Starts at');
 }
 const c={track:1,time:35};assert.equal(label(c,[c],[{}, {duration:90}]).text,'00:35');
});
