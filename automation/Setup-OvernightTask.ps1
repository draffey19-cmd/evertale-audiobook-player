[CmdletBinding()]
param(
    [string]$Workspace = (Split-Path $PSScriptRoot -Parent),
    [string]$TaskName = 'EverTale Overnight Development',
    [ValidatePattern('^\d{2}:\d{2}$')][string]$At = '01:00',
    [switch]$RegisterDisabled
)
$ErrorActionPreference='Stop'
$workspaceRoot=[IO.Path]::GetFullPath($Workspace)
$runner=Join-Path $workspaceRoot 'automation/Run-Overnight.ps1'
if (!(Test-Path -LiteralPath $runner)) { throw 'Runner not found' }
if ($workspaceRoot.Contains('"')) { throw 'Unsupported workspace path' }
if (& git.exe -C $workspaceRoot branch --show-current | Where-Object {$_ -ne 'feature/local-ai-transcription-beta'}) { throw 'Wrong branch' }
$arguments='-NoProfile -NonInteractive -File "'+$runner+'" -Workspace "'+$workspaceRoot+'" -MaxIterations 3 -MaxRuntimeMinutes 90 -SessionTimeoutSeconds 1200'
$action=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments -WorkingDirectory $workspaceRoot
$trigger=New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($At,'HH:mm',[Globalization.CultureInfo]::InvariantCulture))
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 95) -StartWhenAvailable -DisallowDemandStart:$false
$task=New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Bounded local-only EverTale development. Requires explicit user enablement.'
$task.Settings.Enabled=$false
$runtimeRoot=Join-Path $workspaceRoot '.overnight'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$xmlPath=Join-Path $runtimeRoot 'EverTale-Overnight.disabled.xml'
$xml=Export-ScheduledTask -InputObject $task
[IO.File]::WriteAllText($xmlPath,$xml,[Text.Encoding]::Unicode)
Write-Output "Prepared disabled definition: $xmlPath"
if ($RegisterDisabled) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect it manually. Nothing was overwritten.' }
    Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
    Write-Output "Registered DISABLED task: $TaskName. No schedule was activated."
}
