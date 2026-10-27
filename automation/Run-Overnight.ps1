[CmdletBinding()]
param(
    [string]$Workspace = (Split-Path $PSScriptRoot -Parent),
    [ValidateRange(1,100)][int]$MaxIterations = 3,
    [ValidateRange(1,480)][int]$MaxRuntimeMinutes = 90,
    [ValidateRange(10,3600)][int]$SessionTimeoutSeconds = 1200,
    [switch]$DryRun,
    [switch]$Probe,
    [ValidateRange(0,30)][int]$DryRunHoldSeconds = 0
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspaceRoot = [IO.Path]::GetFullPath($Workspace).TrimEnd('\')
if (!(Test-Path -LiteralPath (Join-Path $workspaceRoot 'app/package.json'))) { throw 'Not an EverTale workspace' }
$runtimeRoot = Join-Path $workspaceRoot '.overnight'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
foreach ($item in @($workspaceRoot,$runtimeRoot,(Join-Path $workspaceRoot 'automation'))) {
    if ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse-point roots are not allowed' }
}
$lock = $null
try { $lock = [IO.File]::Open((Join-Path $runtimeRoot 'runner.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { throw 'Another overnight runner holds the exclusive lock. Do not delete a live lock file.' }
$started = [DateTime]::UtcNow
$deadline = $started.AddMinutes($MaxRuntimeMinutes)
$runId = $started.ToString('yyyyMMdd-HHmmss-fff')
$logRoot = Join-Path $runtimeRoot $runId
New-Item -ItemType Directory -Path $logRoot | Out-Null
$statusPath = Join-Path $runtimeRoot 'status.json'
$historyPath = Join-Path $runtimeRoot 'history.jsonl'
$processState = @{active=$null;cli=$null}
function Write-State([string]$State,[string]$Message) {
    $value = [ordered]@{run=$runId;pid=$PID;state=$State;message=$Message;updated=[DateTime]::UtcNow.ToString('o');logs=$logRoot}
    $json = $value | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($statusPath,$json)
    [IO.File]::AppendAllText($historyPath,$json+[Environment]::NewLine)
    Write-Output "$State : $Message"
}
function Git([string[]]$Arguments) {
    $oldPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue';$output = @(& git.exe -C $workspaceRoot @Arguments 2>&1);$code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$oldPreference }
    if ($code -ne 0) { throw "Git failed: $($output -join ' ')" }
    return $output
}
function Assert-Branch {
    if ((Git @('branch','--show-current')) -ne 'feature/local-ai-transcription-beta') { throw 'Required branch is feature/local-ai-transcription-beta' }
    $gitRoot = [IO.Path]::GetFullPath((Git @('rev-parse','--show-toplevel'))).TrimEnd('\')
    if ($gitRoot -ne $workspaceRoot) { throw 'Workspace must be the Git repository root' }
}
function Quote([string]$Value) {
    if ($Value.Contains('"') -or $Value.Contains("`n")) { throw 'Unsupported process argument' }
    return '"'+$Value+'"'
}
function Stop-OwnedProcess {
    if ($null -ne $processState.active -and !$processState.active.HasExited) {
        & taskkill.exe /PID $processState.active.Id /T /F | Out-Null
        $processState.active.WaitForExit()
    }
}
function Run-Step([string]$Kind,[string]$Prefix,[string]$PromptPath='',[string]$ResultPath='') {
    $stepDeadline = [DateTime]::UtcNow.AddSeconds($SessionTimeoutSeconds)
    if ($stepDeadline -gt $deadline) { $stepDeadline=$deadline }
    $millis = [long](($stepDeadline-[DateTime]'1970-01-01').TotalMilliseconds)
    $arguments = @((Join-Path $workspaceRoot 'automation/session.cjs'),'--workspace',$workspaceRoot,'--kind',$Kind,'--deadline',"$millis",'--parent',"$PID")
    $arguments += @('--cli',$processState.cli)
    if ($Kind -in @('codex','probe')) { $arguments += @('--prompt',$PromptPath,'--result',$ResultPath,'--schema',(Join-Path $workspaceRoot 'automation/result-schema.json')) }
    $commandLine = ($arguments | ForEach-Object { Quote $_ }) -join ' '
    $processState.active = Start-Process -FilePath (Get-Command node.exe -ErrorAction Stop).Source -ArgumentList $commandLine -WorkingDirectory (Join-Path $workspaceRoot 'app') -WindowStyle Hidden -PassThru -RedirectStandardOutput ($Prefix+'.stdout.log') -RedirectStandardError ($Prefix+'.stderr.log')
    $null=$processState.active.Handle
    while (!$processState.active.WaitForExit(250)) {
        if ((Test-Path -LiteralPath (Join-Path $runtimeRoot 'STOP')) -or [DateTime]::UtcNow -ge $stepDeadline) { Stop-OwnedProcess; throw 'Stop requested or runtime limit reached; unfinished work preserved' }
    }
    if ($processState.active.ExitCode -ne 0) { throw "$Kind failed (exit $($processState.active.ExitCode)); see $Prefix.stderr.log" }
    $processState.active=$null
}
try {
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run the overnight loop from a non-elevated shell' }
    Assert-Branch
    foreach ($flag in @('STOP','PAUSE')) { if (Test-Path -LiteralPath (Join-Path $runtimeRoot $flag)) { Write-State 'stopped' "$flag flag present"; return } }
    if (!$DryRun -and !$Probe -and @((Git @('status','--porcelain'))).Count -gt 0) { throw 'Working tree is dirty. Review and commit changes before unattended work.' }
    $backlogPath = Join-Path $workspaceRoot 'automation/backlog.json'
    $tasks = Get-Content -LiteralPath $backlogPath -Raw | ConvertFrom-Json
    $next = @($tasks | Where-Object { $_.status -ne 'completed' } | Sort-Object priority | Select-Object -First 1)
    if ($DryRun) {
        Write-State 'dry-run' ('No model, edits, commits or schedule. Next task: '+$(if($next.Count){$next[0].id}else{'none'}))
        $dryDeadline=[DateTime]::UtcNow.AddSeconds($DryRunHoldSeconds)
        while ([DateTime]::UtcNow -lt $dryDeadline) { if(Test-Path -LiteralPath (Join-Path $runtimeRoot 'STOP')){Write-State 'stopped' 'STOP flag observed';return};Start-Sleep -Milliseconds 100 }
        return
    }
    $codexCommand = (Get-Command codex.cmd -ErrorAction Stop).Source
    $processState.cli = Join-Path (Split-Path $codexCommand -Parent) 'node_modules/@openai/codex/bin/codex.js'
    if (!(Test-Path -LiteralPath $processState.cli)) { throw 'NPM Codex entry not found. Install/configure Codex manually; runner will not install it.' }
    # Ignore personal plugins/hooks, force MXC (no legacy elevation fallback), retain auth only.
    if ($Probe) {
        $promptPath=Join-Path $logRoot 'probe.txt';$resultPath=Join-Path $logRoot 'probe-result.json'
        [IO.File]::WriteAllText($promptPath,'Read-only readiness probe. Run exactly one sandboxed read-only shell command Get-Location in this workspace. Do not edit files or use other tools. If it succeeds return taskId probe, status completed, summary READY, tests [Get-Location passed], manualTesting []. If any sandbox/auth/setup error occurs return status blocked with the error and do not retry with broader access.')
        Run-Step 'probe' (Join-Path $logRoot 'probe') $promptPath $resultPath
        $probeResult=Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        if ($probeResult.taskId -ne 'probe' -or $probeResult.status -ne 'completed') { throw 'Read-only Codex probe did not complete' }
        Write-State 'probe-passed' (Get-Content -LiteralPath $resultPath -Raw);return
    }
    $customHooks=@(& git.exe -C $workspaceRoot config --get core.hooksPath)
    if ($customHooks.Count -gt 0) { throw 'Custom Git hooksPath requires manual review before unattended commits; hooks will not be bypassed' }
    $hookDirectory=Join-Path $workspaceRoot '.git/hooks'
    if (Test-Path -LiteralPath $hookDirectory) {
        $hooks=@(Get-ChildItem -LiteralPath $hookDirectory -File | Where-Object {$_.Name -notlike '*.sample'})
        if ($hooks.Count) { throw 'Custom Git hooks require manual review before unattended commits; hooks will not be bypassed' }
    }
    for ($iteration=1;$iteration -le $MaxIterations;$iteration++) {
        Assert-Branch
        if ([DateTime]::UtcNow -ge $deadline) { Write-State 'bounded-stop' 'Maximum runtime reached'; return }
        foreach ($flag in @('STOP','PAUSE')) { if(Test-Path -LiteralPath (Join-Path $runtimeRoot $flag)){Write-State 'stopped' "$flag flag present";return} }
        $tasks=Get-Content -LiteralPath $backlogPath -Raw | ConvertFrom-Json
        $next=@($tasks | Where-Object {$_.status -ne 'completed'} | Sort-Object priority | Select-Object -First 1)
        if (!$next.Count) { Write-State 'complete' 'No unfinished tasks';return }
        $task=$next[0]
        if (!$task.safe -or $task.status -ne 'pending') { throw "Task $($task.id) requires review/approval: $($task.status)" }
        if ($task.id -notmatch '^[A-Z0-9-]+$') { throw 'Invalid task ID' }
        $head=(Git @('rev-parse','HEAD'))
        $prefix=Join-Path $logRoot ("$iteration-"+$task.id)
        $promptPath=$prefix+'.prompt.txt';$resultPath=$prefix+'.result.json'
        $prompt=@"
Work only in $workspaceRoot on feature/local-ai-transcription-beta. Implement exactly task $($task.id): $($task.instruction)
Read OVERNIGHT_PLAN.md and OVERNIGHT_REPORT.md. Preserve working reader, transcription, search and playback.
Allowed changed paths: $($task.allowedPaths -join ', '). Update OVERNIGHT_REPORT.md with changes/tests/manual checks.
Never push, merge, publish, elevate, bypass sandbox protections, install drivers, download models, alter installed EverTale/real data, change branches, or modify files outside this workspace. No external apps/connectors, subagents or remote writes. Do not modify automation, .git, .github, .codex, .agents, dependencies or lockfiles. Do not commit; the runner validates and commits.
Stop immediately with blocked on permission/network/sandbox/auth failures or a need for user approval. Do not retry with broader access. Do not claim unrun checks. Run relevant tests with npm.cmd from app. Use synthetic temporary fixtures under .overnight/tmp. Complete one bounded task; no unrelated cleanup.
Return structured taskId $($task.id), status completed/blocked/failed, summary, tests and manualTesting. If any serious errors remain, return failed.
"@
        [IO.File]::WriteAllText($promptPath,$prompt)
        Write-State 'running' "Iteration $iteration task $($task.id)"
        Run-Step 'codex' $prefix $promptPath $resultPath
        $result=Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        if ($result.taskId -ne $task.id -or $result.status -ne 'completed') { throw "Task stopped: $($result.status) $($result.summary)" }
        Assert-Branch
        if ((Git @('rev-parse','HEAD')) -ne $head) { throw 'Agent changed commit history; manual review required' }
        $changed=@(@(Git @('-c','core.quotepath=false','diff','--name-only','HEAD'))+@(Git @('-c','core.quotepath=false','ls-files','--others','--exclude-standard')) | Where-Object {$_} | Select-Object -Unique)
        foreach ($file in $changed) {
            if ($file -match '^(automation/|\.git|\.codex|\.agents)' -or !@($task.allowedPaths | Where-Object {$file -like $_}).Count) { throw "Unapproved changed path: $file" }
        }
        Run-Step 'check' ($prefix+'-check')
        Run-Step 'test' ($prefix+'-test')
        if ($task.build) { Run-Step 'build' ($prefix+'-build') }
        Git @('diff','--check') | Out-Null
        $task.status='completed'
        [IO.File]::WriteAllText($backlogPath,(ConvertTo-Json -InputObject @($tasks) -Depth 8))
        Add-Content -LiteralPath (Join-Path $workspaceRoot 'OVERNIGHT_REPORT.md') -Value "`nAutomation $runId / $($task.id): $($result.summary). Runner syntax/tests passed. Logs: .overnight/$runId. Manual: $($result.manualTesting -join '; ')"
        Git (@('add','--')+$changed+@('automation/backlog.json','OVERNIGHT_REPORT.md')) | Out-Null
        Git @('-c','user.name=EverTale Automation','-c','user.email=evertale-automation@localhost','commit','-m',"Overnight $($task.id): validated local task") | Out-Null
        Write-State 'committed' (Git @('rev-parse','--short','HEAD'))
    }
    Write-State 'bounded-stop' 'Iteration limit reached'
} catch {
    Stop-OwnedProcess
    [IO.File]::WriteAllText((Join-Path $runtimeRoot 'PAUSE'),$_.Exception.Message)
    Write-State 'error' $_.Exception.Message
    throw
} finally {
    Stop-OwnedProcess
    if ($null -ne $lock) { $lock.Dispose() }
}
