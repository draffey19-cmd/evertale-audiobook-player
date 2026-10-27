// Process wrapper used by Run-Overnight.ps1. No shell for Codex; npm commands are fixed.
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2===0?[...a,[v.replace(/^--/,''),all[i+1]]]:a,[]));
const workspace=path.resolve(args.workspace||'.');
function inside(file){const target=path.resolve(file),relative=path.relative(workspace,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Path outside workspace');return target;}
let child=null,finished=false;
function terminate(){if(child&&!finished){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}}
async function main(){
 const environment={...process.env,TEMP:inside(path.join(workspace,'.overnight/tmp')),TMP:inside(path.join(workspace,'.overnight/tmp')),npm_config_cache:inside(path.join(workspace,'.overnight/npm-cache')),EVERTALE_SANDBOX_VALIDATION:'1',CI:'true',GIT_TERMINAL_PROMPT:'0'};
 fs.mkdirSync(environment.TEMP,{recursive:true});
 let command,argv,options={cwd:workspace,env:environment,windowsHide:true,stdio:['pipe','inherit','inherit']};
 if(args.kind==='codex'||args.kind==='probe'){
  const entry=path.resolve(args.cli);command=entry.endsWith('.js')||entry.endsWith('.cjs')?process.execPath:entry;
  argv=command===process.execPath?[entry]:[];
  argv.push('-a','never','exec','--ignore-user-config','--ephemeral','--sandbox',args.kind==='probe'?'read-only':'workspace-write',
   '-c','windows.sandbox="mxc"','-c','sandbox_workspace_write.network_access=false',
   '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
   '--disable','apps','--disable','plugins','--disable','hooks','--disable','multi_agent',
   '--cd',workspace,'--json','--color','never','--output-schema',inside(args.schema),'-o',inside(args.result),'-');
 }else{
  const commands={check:'npm.cmd --prefix app run check',test:'npm.cmd --prefix app test',build:'npm.cmd --prefix app run build:win -- --publish never'};
  if(!commands[args.kind])throw Error('Unknown validation step');
  const entry=path.resolve(args.cli);command=entry.endsWith('.js')||entry.endsWith('.cjs')?process.execPath:entry;
  argv=command===process.execPath?[entry]:[];
  // Validation executes repository code, so it must retain the same OS boundary.
  argv.push('sandbox','-c','windows.sandbox="mxc"','-c','sandbox_workspace_write.network_access=false',
   '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
   '--cd',workspace,'--permission-profile',':workspace','--include-managed-config','--',process.env.ComSpec||'cmd.exe','/d','/s','/c',commands[args.kind]);
 }
 child=spawn(command,argv,options);
 const interval=setInterval(()=>{
  let parentGone=false;try{if(args.parent)process.kill(Number(args.parent),0);}catch{parentGone=true;}
  if(parentGone||Date.now()>=Number(args.deadline)||fs.existsSync(path.join(workspace,'.overnight/STOP'))){terminate();process.exitCode=124;}
 },250);
 child.on('error',e=>{console.error(e.message);clearInterval(interval);process.exitCode=1;});
 child.on('close',code=>{finished=true;clearInterval(interval);if(process.exitCode!==124)process.exitCode=code===0?0:1;});
 child.stdin.on('error',()=>{});
 if(args.kind==='codex'||args.kind==='probe')child.stdin.end(fs.readFileSync(inside(args.prompt)));else child.stdin.end();
}
process.on('SIGINT',()=>{terminate();process.exitCode=130;});
process.on('SIGTERM',()=>{terminate();process.exitCode=143;});
main().catch(e=>{console.error(e.message);terminate();process.exitCode=1;});
