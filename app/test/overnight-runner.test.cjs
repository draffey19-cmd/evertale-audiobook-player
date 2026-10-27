const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
// Nested MXC cannot perform the process-tree control exercised by these tests.
// They still run in ordinary Windows CI/development; product tests run in MXC.
const windows=process.platform==='win32'&&process.env.EVERTALE_SANDBOX_VALIDATION!=='1';
async function fixture(t){
 const parent=path.join(root,'.overnight');await fs.mkdir(parent,{recursive:true});
 const dir=await fs.mkdtemp(path.join(parent,'runner-test-'));
 await fs.mkdir(path.join(dir,'automation'));await fs.mkdir(path.join(dir,'app'));
 for(const name of ['Run-Overnight.ps1','session.cjs','result-schema.json'])await fs.copyFile(path.join(root,'automation',name),path.join(dir,'automation',name));
 await fs.writeFile(path.join(dir,'app/package.json'),'{}');
 await fs.writeFile(path.join(dir,'automation/backlog.json'),JSON.stringify([{id:'TEST',priority:1,status:'pending',safe:true,allowedPaths:['app/*'],instruction:'Test only',build:false}]));
 await fs.writeFile(path.join(dir,'.gitignore'),'.overnight/\n');
 assert.equal(spawnSync('git.exe',['init','-b','feature/local-ai-transcription-beta',dir],{windowsHide:true}).status,0);
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
function run(dir,extra='',environment={}){
 // Invoke the trusted script as a command block; no execution-policy or sandbox changes.
 const code=`& ([scriptblock]::Create([IO.File]::ReadAllText($env:EVERTALE_TEST_RUNNER))) -Workspace $env:EVERTALE_TEST_WORKSPACE ${extra}`;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,env:{...process.env,...environment,EVERTALE_TEST_RUNNER:path.join(dir,'automation/Run-Overnight.ps1'),EVERTALE_TEST_WORKSPACE:dir}});
 let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
 return {child,result:new Promise(resolve=>child.on('close',code=>resolve({code,output})))};
}
async function until(fn){const end=Date.now()+8000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,40));}assert.fail('Runner timeout');}
test('runner dry run selects one pending task without edits, model calls or commits',{skip:!windows},async t=>{
 const dir=await fixture(t),before=spawnSync('git.exe',['-C',dir,'status','--porcelain'],{encoding:'utf8'}).stdout;
 const result=await run(dir,'-DryRun -MaxIterations 1 -MaxRuntimeMinutes 1').result;
 assert.equal(result.code,0,result.output);assert.match(result.output,/Next task: TEST/);
 assert.equal(spawnSync('git.exe',['-C',dir,'status','--porcelain'],{encoding:'utf8'}).stdout,before);
});
test('runner exclusive lock rejects overlap and STOP terminates its dry-run wait',{skip:!windows},async t=>{
 const dir=await fixture(t),first=run(dir,'-DryRun -DryRunHoldSeconds 10');
 await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(dir,'.overnight/status.json'))).state==='dry-run';}catch{return false;}});
 const second=await run(dir,'-DryRun').result;assert.notEqual(second.code,0);assert.match(second.output,/exclusive lock/);
 await fs.writeFile(path.join(dir,'.overnight/STOP'),'test stop');
 assert.match((await first.result).output,/STOP flag observed/);
 assert.equal((await run(dir,'-DryRun').result).code,0);
});
test('runner refuses dirty work and persists PAUSE on serious errors',{skip:!windows},async t=>{
 const dir=await fixture(t),result=await run(dir,'-MaxIterations 1').result;
 assert.notEqual(result.code,0);assert.match(result.output,/Working tree is dirty/);
 assert.match(await fs.readFile(path.join(dir,'.overnight/PAUSE'),'utf8'),/dirty/);
 assert.match((await run(dir,'-DryRun').result).output,/PAUSE flag present/);
});
test('session enforces deadlines on its own subprocess tree',{skip:!windows},async t=>{
 const dir=await fixture(t);await fs.mkdir(path.join(dir,'.overnight'));
 const fake=path.join(dir,'automation/fake-cli.cjs');await fs.writeFile(fake,'setInterval(()=>{},1000);');
 const prompt=path.join(dir,'.overnight/prompt.txt');await fs.writeFile(prompt,'test');
 const command=spawn(process.execPath,[path.join(dir,'automation/session.cjs'),'--workspace',dir,'--kind','probe','--cli',fake,'--prompt',prompt,'--schema',path.join(dir,'automation/result-schema.json'),'--result',path.join(dir,'.overnight/result.json'),'--deadline',String(Date.now()+800),'--parent',String(process.pid)],{windowsHide:true,stdio:'ignore'});
 const code=await new Promise(resolve=>command.on('close',resolve));assert.equal(code,124);
});

async function fakeAgent(t,behavior='safe'){
 const dir=await fixture(t),bin=path.join(dir,'fake-bin'),entry=path.join(bin,'node_modules/@openai/codex/bin');
 await fs.mkdir(entry,{recursive:true});await fs.writeFile(path.join(bin,'codex.cmd'),'@echo off\r\n');
 await fs.writeFile(path.join(entry,'codex.js'),`
 const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);
 if(args[0]==='sandbox'){if(!args.includes(':workspace')||!args.includes('--include-managed-config'))process.exit(3);process.exit(0);}
 if(!args.includes('workspace-write')||!args.includes('never')||!args.includes('windows.sandbox="mxc"')||args.includes('--dangerously-bypass-approvals-and-sandbox'))process.exit(2);
 const root=args[args.indexOf('--cd')+1],output=args[args.indexOf('-o')+1];
 fs.writeFileSync(path.join(root,${JSON.stringify(behavior==='unsafe'?'automation/unapproved.txt':'app/updated.txt')}),'synthetic edit');
 fs.writeFileSync(output,JSON.stringify({taskId:'TEST',status:${JSON.stringify(behavior==='blocked'?'blocked':'completed')},summary:'Fixture only',tests:[],manualTesting:[]}));
 `);
 await fs.writeFile(path.join(dir,'app/package.json'),JSON.stringify({scripts:{check:'node -e "process.exit(0)"',test:'node -e "process.exit(0)"'}}));
 for(const args of [['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture baseline']])assert.equal(spawnSync('git.exe',['-C',dir,...args],{windowsHide:true,stdio:'ignore'}).status,0);
 return {dir,environment:{PATH:bin+path.delimiter+process.env.PATH}};
}
test('bounded runner validates a synthetic task and creates only a local fixture commit',{skip:!windows,timeout:30000},async t=>{
 const {dir,environment}=await fakeAgent(t);
 const result=await run(dir,'-MaxIterations 1 -MaxRuntimeMinutes 1 -SessionTimeoutSeconds 15',environment).result;
 assert.equal(result.code,0,result.output);assert.match(result.output,/Iteration limit reached/);
 const tasks=JSON.parse((await fs.readFile(path.join(dir,'automation/backlog.json'),'utf8')).replace(/^\uFEFF/,''));
 assert.equal(tasks[0].status,'completed');
 assert.equal(spawnSync('git.exe',['-C',dir,'rev-list','--count','HEAD'],{encoding:'utf8'}).stdout.trim(),'2');
});
for(const behavior of ['unsafe','blocked'])test(`runner stops on ${behavior} agent output without committing`,{skip:!windows,timeout:15000},async t=>{
 const {dir,environment}=await fakeAgent(t,behavior);
 const result=await run(dir,'-MaxIterations 1 -SessionTimeoutSeconds 10',environment).result;
 assert.notEqual(result.code,0);assert.match(result.output,behavior==='unsafe'?/Unapproved changed path/:/Task stopped: blocked/);
 assert.equal(spawnSync('git.exe',['-C',dir,'rev-list','--count','HEAD'],{encoding:'utf8'}).stdout.trim(),'1');
 assert.ok(await fs.readFile(path.join(dir,'.overnight/PAUSE')));
});
