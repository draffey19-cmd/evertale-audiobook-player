const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {themes,normalize,createController}=require('../themes.js');
const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('six themes default missing and unrecognized preferences to Original Purple',()=>{
 assert.equal(themes.length,6);assert.equal(new Set(themes.map(t=>t.id)).size,6);
 for(const value of [null,undefined,'old-gold','<invalid>'])assert.equal(normalize(value),'original-purple');
});
test('theme switching applies immediately and restores the saved theme after restart',()=>{
 const values=new Map(),applied=[];
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const controller=createController({storage,apply:id=>applied.push(id)});
 assert.equal(controller.current,'original-purple');
 for(const theme of themes){
  controller.select(theme.id);assert.equal(applied.at(-1),theme.id);
  const restarted=createController({storage,apply:id=>applied.push(id)});
  assert.equal(restarted.current,theme.id);assert.equal(applied.at(-1),theme.id);
 }
});
test('unavailable storage falls back safely and failed writes retain the current theme',()=>{
 const applied=[];const controller=createController({storage:{getItem(){throw Error('denied');},setItem(){throw Error('full');}},apply:id=>applied.push(id)});
 assert.equal(controller.current,'original-purple');assert.throws(()=>controller.select('midnight'),/full/);
 assert.equal(controller.current,'original-purple');assert.deepEqual(applied,['original-purple']);
});
test('theme foregrounds meet WCAG AA contrast on backgrounds and interactive surfaces',()=>{
 for(const t of themes){
  for(const bg of [t.bg,t.surface,t.raised,t.hover]){
   for(const fg of ['#f7f4ff',t.muted,t.accent])assert.ok(contrast(fg,bg)>=4.5,`${t.id}: ${fg} on ${bg}`);
  }
  assert.ok(contrast('#160f20',t.accent)>=4.5,t.id+' primary label');
 }
});
test('branding assets are packaged and Windows icons always use the purple original',()=>{
 const pkg=require('../package.json');assert.equal(pkg.build.win.icon,'assets/evertale.ico');
 assert.equal(pkg.build.nsis.installerIcon,pkg.build.win.icon);
 assert.ok(pkg.build.files.includes('assets/**'));assert.ok(pkg.build.files.includes('themes.js'));
 for(const t of themes)assert.ok(fs.statSync(path.join(__dirname,'../assets',`logo-${t.id}.png`)).size>0);
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(html,/<img class="brand-logo" data-brand-logo/);
 assert.equal((html.match(/data-brand-logo/g)||[]).length,2);
 const icon=fs.readFileSync(path.join(__dirname,'../assets/evertale.ico'));
 assert.equal(icon.readUInt16LE(2),1);assert.ok(icon.readUInt16LE(4)>=9);
});
