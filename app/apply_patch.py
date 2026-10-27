import hashlib,json,os,pathlib,shutil,sys,tempfile,zipfile,datetime
ROOT=pathlib.Path(__file__).resolve().parent
ALLOWED={'index.html','styles.css','renderer.js','main.cjs','preload.cjs','updater.cjs','package.json'}
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
    patches=ROOT/'updates';patches.mkdir(exist_ok=True)
    candidates=sorted(patches.glob('*.zip'))
    if not candidates:print('No patch ZIP found in updates folder.');return 1
    if len(candidates)>1:print('Please keep only ONE patch ZIP in updates folder.');return 1
    with zipfile.ZipFile(candidates[0]) as z:
        names=z.namelist()
        if len(names)!=len(set(names)) or 'manifest.json' not in names:raise ValueError('Invalid patch manifest')
        manifest=json.loads(z.read('manifest.json'))
        files=manifest.get('files',{})
        if not files or set(files)-ALLOWED or set(names)!=(set(files)|{'manifest.json'}):raise ValueError('Unexpected files in patch')
        current=json.loads((ROOT/'package.json').read_text())['version']
        if manifest.get('from_version')!=current:raise ValueError(f'Patch requires version {manifest.get("from_version")}; installed {current}')
        for name,expected in files.items():
            if not isinstance(expected,dict) or sha(z.read(name))!=expected.get('sha256'):raise ValueError('Patch hash mismatch: '+name)
            if 'previous_sha256' in expected and (not (ROOT/name).exists() or sha((ROOT/name).read_bytes())!=expected['previous_sha256']):raise ValueError('Local file differs from patch base: '+name)
        if 'package.json' in files:
            newver=json.loads(z.read('package.json'))['version']
            if newver!=manifest.get('to_version'):raise ValueError('Patch version mismatch')
        stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup=ROOT/'patch-backups'/stamp;backup.mkdir(parents=True)
        replaced=[]
        try:
            for name in files:
                target=ROOT/name
                if target.exists():shutil.copy2(target,backup/name)
                temp=target.with_suffix(target.suffix+'.patchtmp');temp.write_bytes(z.read(name));os.replace(temp,target);replaced.append(name)
        except Exception:
            for name in replaced:
                if (backup/name).exists():shutil.copy2(backup/name,ROOT/name)
                else:(ROOT/name).unlink(missing_ok=True)
            raise
        (backup/'patch-info.json').write_text(json.dumps({'patch':candidates[0].name,'files':replaced,'from_version':current},indent=2))
        print('Applied:',candidates[0].name,'\nBackup:',backup)
        if 'package.json' in files:print('If dependencies changed, run npm install before launching.')
        candidates[0].rename(candidates[0].with_suffix('.applied'))
        return 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print('PATCH NOT APPLIED:',e);sys.exit(1)
