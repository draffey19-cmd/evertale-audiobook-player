// Local-only benchmark. Explicit paths; never touches EverTale's real user data.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
async function main(){
 const [binary,model,audio,device='1']=process.argv.slice(2);
 if(!binary||!model||!audio)throw Error('Usage: node scripts/benchmark-vibe.cjs BINARY MODEL SPEECH_WAV VULKAN_DEVICE_INDEX');
 const out=path.resolve('dist/ai-smoke');await fs.mkdir(out,{recursive:true});
 const wav=path.join(out,'benchmark-16k.wav');
 const conversion=spawnSync(require('ffmpeg-static'),['-nostdin','-y','-i',path.resolve(audio),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{windowsHide:true});
 if(conversion.status!==0)throw Error('Audio conversion failed');
 const bytes=await fs.readFile(wav);const duration=(bytes.length-44)/32000;
 const results=[];
 for(const noGpu of [true,false]){
  const label=noGpu?'cpu':'vulkan-'+device;let logs='',stdout='';
  const child=spawn(path.resolve(binary),['serve','--verbose','--host','127.0.0.1','--port','0'],{windowsHide:true});
  child.stderr.on('data',d=>{logs+=d;});
  const ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server start timed out')),15000);
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});
   child.stdout.on('data',d=>{stdout+=d;for(const line of stdout.split(/\r?\n/)){try{const value=JSON.parse(line);if(value.status==='ready'&&value.port){clearTimeout(timer);resolve(value.port);}}catch{}}});
  });
  try{
   const port=await ready,endpoint='http://127.0.0.1:'+port;
   let start=performance.now();
   const response=await fetch(endpoint+'/v1/models/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path.resolve(model),no_gpu:noGpu,gpu_device:noGpu?-1:Number(device)}),signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw Error(await response.text());
   const loadSeconds=(performance.now()-start)/1000,times=[];let text='';
   const processGpuInfo=spawnSync('nvidia-smi',['--query-compute-apps=pid,process_name,used_memory','--format=csv,noheader'],{windowsHide:true,encoding:'utf8',timeout:2000}).stdout?.split(/\r?\n/).filter(line=>line.startsWith(child.pid+',')).join('\n');
   const gpuSamples=[];const sample=()=>{const r=spawnSync('nvidia-smi',['--query-gpu=utilization.gpu,memory.used','--format=csv,noheader,nounits'],{windowsHide:true,encoding:'utf8',timeout:2000});if(r.status===0)gpuSamples.push(r.stdout.trim());};
   sample();const timer=setInterval(sample,500);
   try{for(let i=0;i<3;i++){
    const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');form.append('response_format','verbose_json');
    start=performance.now();const r=await fetch(endpoint+'/v1/audio/transcriptions',{method:'POST',body:form,signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw Error(await r.text());const transcript=await r.json();times.push((performance.now()-start)/1000);text=transcript.text;
   }}finally{clearInterval(timer);sample();}
   let engineCounters='Not requested';
   if(process.env.VIBE_VERIFY_ENGINES==='1'){
    const command=`Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 3 | ForEach-Object {$_.CounterSamples} | Where-Object {$_.InstanceName -like 'pid_${child.pid}_*' -and $_.CookedValue -gt 0.01} | Select-Object InstanceName,CookedValue | ConvertTo-Json -Compress`;
    const counter=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true});
    let output='',errors='';counter.stdout.on('data',d=>{output+=d;});counter.stderr.on('data',d=>{errors+=d;});
    const closed=new Promise(resolve=>counter.on('close',resolve));
    const until=performance.now()+5500;
    while(performance.now()<until){const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');const r=await fetch(endpoint+'/v1/audio/transcriptions',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(await r.text());await r.text();}
    await closed;engineCounters=output.trim()||errors.trim()||'No active per-process GPU engine measured';
   }
   results.push({model:path.basename(model),mode:label,serverPid:child.pid,processGpuInfo,audioSeconds:duration,loadSeconds,inferenceSeconds:times,realtimeFactors:times.map(t=>t/duration),gpuSamples,engineCounters,text});
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await fs.writeFile(path.join(out,path.basename(model)+'-'+label+'.log'),logs+stdout);}
 }
 const output=path.join(out,path.basename(model)+'-benchmark.json');await fs.writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
