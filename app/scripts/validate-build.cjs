// Read-only checks of build outputs; never executes an application or installer.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const R=require('resedit');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const version=pkg.version;
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const ico=fs.readFileSync(path.join(root,pkg.build.win.icon));
const originals=new Map();
for(let i=0;i<ico.readUInt16LE(4);i++){
 const at=6+i*16,size=ico[at]||256,start=ico.readUInt32LE(at+12),length=ico.readUInt32LE(at+8);
 originals.set(size,ico.subarray(start,start+length));
}
function inspect(relative){
 const file=path.join(root,relative),bytes=fs.readFileSync(file);
 const entries=R.NtExecutableResource.from(R.NtExecutable.from(bytes,{ignoreCert:true})).entries;
 const groups=R.Resource.IconGroupEntry.fromEntries(entries);
 const group=groups.find(g=>g.icons.length===originals.size&&g.icons.every(icon=>{
  const entry=entries.find(e=>e.type===3&&e.id===icon.iconID&&e.lang===g.lang);
  return entry&&Buffer.from(entry.bin).equals(originals.get(icon.width||256));
 }));
 assert.ok(group,relative+' must embed the exact approved purple ICO images at all nine sizes');
 const versions=R.Resource.VersionInfo.fromEntries(entries).flatMap(v=>v.getAvailableLanguages().map(l=>v.getStringValues(l)));
 assert.ok(versions.some(v=>v.FileVersion===version||v.FileVersion===version+'.0'),relative+' file version');
 return {file,size:bytes.length,sha256:hash(bytes),iconSizes:[...originals.keys()],versions};
}
assert.equal(version,'1.9.0');
const lock=require('../package-lock.json');assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);
const exe=inspect('dist/win-unpacked/EverTale Audiobook Player.exe');
const installer=inspect(`dist/EverTale-Audiobook-Player-Setup-${version}.exe`);
const archive=path.join(root,'dist/win-unpacked/resources/app.asar');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
for(const name of ['main.cjs','preload.cjs','renderer.js','index.html','styles.css','themes.js','themes.css','assets/evertale.ico',...require('../themes.js').themes.map(t=>`assets/logo-${t.id}.png`)]){
 assert.ok(asar.extractFile(archive,name).equals(fs.readFileSync(path.join(root,name))),'packaged file matches source: '+name);
}
const main=asar.extractFile(archive,'main.cjs').toString();
assert.ok(main.includes("app.setPath('userData', require('node:path').join(app.getPath('appData'),'Hearth Audiobooks'))"),'existing data path is preserved');
assert.equal(pkg.build.appId,'com.hearth.audiobooks');
assert.ok(fs.existsSync(path.join(root,'dist/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe')));
console.log(JSON.stringify({version,publishing:'disabled by build command --publish never',exe,installer,packagedSources:'match',legacyDataPath:'preserved'},null,2));
