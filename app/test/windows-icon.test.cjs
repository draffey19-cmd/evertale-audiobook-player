const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const project=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const iconPath=path.join(project,pkg.build.win.icon);

test('Windows ICO has valid PNG entries for all shell sizes, including alpha',()=>{
 const ico=fs.readFileSync(iconPath);
 assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
 const count=ico.readUInt16LE(4),sizes=new Set();
 assert.ok(count>=4);let end=6+count*16;
 for(let i=0;i<count;i++){
  const offset=6+i*16,width=ico[offset]||256,height=ico[offset+1]||256;
  const length=ico.readUInt32LE(offset+8),start=ico.readUInt32LE(offset+12);
  assert.equal(width,height);assert.ok(start>=end);assert.ok(length>0);assert.ok(start+length<=ico.length);
  const png=ico.subarray(start,start+length);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.toString('ascii',12,16),'IHDR');
  assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
  assert.equal(png[24],8);assert.equal(png[25],6,'RGBA alpha is retained');
  sizes.add(width);end=start+length;
 }
 for(const size of [16,32,48,256])assert.ok(sizes.has(size),'required size '+size);
 assert.equal(end,ico.length);
});
test('icon is derived from the approved original, which remains unchanged',()=>{
 const source=fs.readFileSync(path.join(project,'assets/evertale-original.png'));
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'0bad31f93c8525e26c1a0ebb6b8dba8389eaa8e98b856419a01d4c70b6635515');
});
test('runtime, EXE, installer and uninstaller share the original purple icon',()=>{
 assert.equal(pkg.build.win.icon,'assets/evertale.ico');
 assert.equal(pkg.build.win.signAndEditExecutable,true,'resource editing embeds the icon into the packaged EXE');
 assert.equal(pkg.build.nsis.installerIcon,pkg.build.win.icon);
 assert.equal(pkg.build.nsis.uninstallerIcon,pkg.build.win.icon);
 assert.ok(pkg.build.files.includes('assets/**'));
 const main=fs.readFileSync(path.join(project,'main.cjs'),'utf8');
 assert.match(main,/icon:path\.join\(__dirname,'assets\/evertale\.ico'\)/);
 assert.equal(pkg.build.appId,'com.hearth.audiobooks','retain installed app identity');
});
test('electron-builder accepts the Windows icon configuration without building',async()=>{
 const {validateConfiguration}=require('app-builder-lib/out/util/config/config');
 await validateConfiguration(pkg.build,{isEnabled:false});
});
