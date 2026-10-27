# EverTale overnight development plan

Branch: `feature/local-ai-transcription-beta`. Recurring schedule: **not activated or registered** by this assignment.

## Priorities and durable state

The ordered machine-readable backlog is `automation/backlog.json`. Reader, whole-book queue, and model investigation are completed. The next pending safe tasks cover reader edge cases, queue recovery tests, and reduced-motion accessibility. They are deliberately small. The final backlog entry requires user acceptance and stops automation. The runner never skips a blocked highest-priority task to invent other work.

`OVERNIGHT_REPORT.md` holds durable outcomes and manual checks. Each successful automated task updates the backlog/report and creates a local commit only after runner-controlled checks. Runtime logs, structured results, current status, history, stop flags and the exclusive lock live in ignored `.overnight/`. A stopped/failed task is not marked complete. Uncommitted partial work is preserved for review; the next run refuses a dirty tree.

## Bounds and permissions

`automation/Run-Overnight.ps1` defaults to three iterations, 90 minutes total, and 1,200 seconds per subprocess. Total time includes validation. It requires the exact branch, a clean working tree for editing sessions, and an exclusive file lock. STOP is polled during subprocesses; deadlines kill only the runner's own subprocess tree. A child wrapper also watches its parent and deadline. File locks release when the process exits; do not delete a live lock file.

The noninteractive command uses `codex exec`, approval policy `never`, the `workspace-write` sandbox, explicit Windows MXC, disabled direct network, no extra writable directories, and excluded implicit temporary roots. Temporary test data is routed into `.overnight/tmp`. Personal config, plugins, apps, hooks and multi-agent tools are disabled for these sessions; authentication is reused without copying credentials. Codex's own authentication/runtime files remain managed by Codex, not by project scripts. No driver/model/dependency installation is permitted by the task prompt.

There is no fallback to elevation or an unsandboxed mode. Missing auth, MXC support, sandbox denial, failed checks, branch/history changes, unapproved paths or a blocked result stop the run and leave `.overnight/PAUSE`. The runner does not repair global permissions or retry with broader access. Agent changes to automation, Git metadata, workflow/config files and dependency files are prohibited; changed paths must match the selected task's allowlist. No remote-writing connector is enabled, and no push/merge/publish command is used. Output validation is an additional check, not a replacement for the OS sandbox.

Runner-controlled syntax/tests/builds also execute through `codex sandbox` with MXC and the workspace profile. Process-control infrastructure tests are skipped **inside nested MXC** using an explicit environment marker: the full ordinary Windows suite runs those seven tests separately. Product/reader/queue tests still execute in the sandbox. Real Vibe remains an opt-in check because it needs a local server. Build caches must already be usable without outside writes/downloads; an unavailable cache stops the task. Test fixtures use explicit project paths because MXC virtualizes system temporary directories. Local commits leave Git hooks intact; any custom hooks or hooksPath stop automation for review. No hook configuration is overridden.

CLI choices were checked against installed CLI help and the official [noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode), [security documentation](https://learn.chatgpt.com/docs/security), and [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox). MXC is selected explicitly so unavailable support fails rather than invoking legacy administrator setup. No permission setting was changed during testing. This uses the OpenAI Docs skill at `C:/Users/Liam/.codex/skills/.system/openai-docs/SKILL.md`.

## Start and monitor manually

Close other development sessions that could edit this checkout. Keep the laptop awake and plugged in. Use an ordinary non-admin PowerShell, from the repository root. Codex must already be installed through npm and authenticated (`codex.cmd login status`). Node, npm, cached dependencies/build tools must already be available: the loop does not install anything.

```powershell
# No model call, source edits, commits or scheduling:
.\automation\Run-Overnight.ps1 -DryRun -MaxIterations 1 -MaxRuntimeMinutes 1

# Read-only noninteractive Codex + sandboxed Get-Location probe:
.\automation\Run-Overnight.ps1 -Probe -MaxIterations 1 -MaxRuntimeMinutes 1 -SessionTimeoutSeconds 45

# One bounded editing session (only when you choose to start):
.\automation\Run-Overnight.ps1 -MaxIterations 1 -MaxRuntimeMinutes 30 -SessionTimeoutSeconds 1200

Get-Content .overnight\status.json
Get-Content .overnight\history.jsonl -Tail 10
Get-ChildItem .overnight -Directory
git log -5 --oneline
git status --short
```

Windows currently has no explicit execution policy configured, so its default can block `.ps1` files. **Do not add `-ExecutionPolicy Bypass`**. Before using `-File` or the schedule, approve local script execution/signing through your normal Windows policy. This assignment did not lower that policy. Tests invoked the trusted script content as a PowerShell command block, with no execution-policy switch or sandbox changes; scheduler `-File` launch remains a manual prerequisite. The schedule should not be enabled until the normal `.ps1` dry run and probe above work in your intended non-admin shell.

## Pause, stop and recover

```powershell
# Finish the current bounded task, then stop before another:
New-Item -ItemType File -Force .overnight\PAUSE

# Interrupt the running child and prevent future sessions:
New-Item -ItemType File -Force .overnight\STOP

# Also prevent future scheduled launches, if you registered a task:
Disable-ScheduledTask -TaskName 'EverTale Overnight Development'
```

After an interruption/error, read the latest stdout/stderr/result logs and inspect `git diff`. Fix/review partial changes and commit them locally when appropriate. Do not reset or delete work automatically. Remove only the STOP/PAUSE files you intend to clear, after review, then dry-run/probe again. A lingering `runner.lock` filename is normal; the open exclusive handle determines whether a runner is active. No lock-file deletion is needed.

## Prepare and activate Task Scheduler — explicit approval required

The setup script defaults to exporting `.overnight/EverTale-Overnight.disabled.xml` only. It does not register or enable anything. The optional registration switch creates an explicitly **disabled** task, refuses to overwrite an existing task, uses your interactive login and limited privileges, ignores overlapping starts, and has a 95-minute outer limit. It does not wake the computer, store a password, or run as administrator. Logged-out or sleeping laptops do not run this configuration.

After you explicitly approve recurring operation, and after the normal script-policy prerequisite and probe pass:

```powershell
# 1. Register the daily 01:00 task DISABLED (inspect first).
.\automation\Setup-OvernightTask.ps1 -At '01:00' -RegisterDisabled
Get-ScheduledTask -TaskName 'EverTale Overnight Development' | Format-List TaskName,State,Actions,Principal,Settings

# 2. Clear reviewed stop flags if present; do not remove a live lock.
Remove-Item .overnight\PAUSE -ErrorAction SilentlyContinue
Remove-Item .overnight\STOP -ErrorAction SilentlyContinue

# 3. This command actually activates the recurring schedule:
Enable-ScheduledTask -TaskName 'EverTale Overnight Development'

# Optional immediate run, only after you choose to start it:
Start-ScheduledTask -TaskName 'EverTale Overnight Development'
```

No activation command was run during this assignment. There is no registered EverTale development task to disable at handoff. The disabled XML was generated and inspected locally. Task registration under the user's real login, reboot/sleep behavior and normal `-File` script execution still require user validation.
