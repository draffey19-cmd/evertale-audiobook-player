# EverTale local AI transcription development report

## SAFE-01: reader edge-case regressions (October 27, 2026)

- Added four synthetic reader regressions covering reverse seeks through exclusive ends/gaps/pre-roll, repeated start/end timestamps and zero-length passages, older refresh failures arriving after newer success/failure, and rejection after the selected context changes before another refresh starts. Assertions cover highlight/ARIA cleanup, stable passage selection, clickable timestamps, and continued highlighting of retained text after a refresh error.
- The context-change rejection regression initially failed: the error path checked only request generation and could display an old book's error. Added the same current-context check already used by successful loads. No other reader behavior required repair.
- Validation from `app`: `npm.cmd run check` passed; `npm.cmd test` passed **36 tests, zero failures, eight skips** (seven infrastructure tests explicitly skipped in this environment and the opt-in real Vibe test skipped). All nine reader tests passed. The initial regression run had one expected failure exposing the repaired error path. `git diff --check` passed.
- Manual checks: reviewed the patch and confirmed the requested branch and three allowed changed paths. No graphical, audible playback, installed-app, real-engine, or real-data checks were run for this task; those acceptance checks remain outstanding above. Reader fixtures are synthetic in-memory objects; suite temporary fixtures use project-local `.overnight/tmp`. No models, dependencies, or external services were needed. No commit or remote write was performed.

Date: October 27, 2026. Branch: `feature/local-ai-transcription-beta`.

## Scope and baseline

- Started from clean commit `ab4ce9c` on the requested branch. No branch switches, remote writes, merges, releases, or publishing were performed.
- Inspected the transcription backend, renderer controls, preload bridge, Electron setup/file pickers, package configuration, and Windows build workflow. No applicable local `AGENTS.md` was found.
- Baseline JavaScript syntax checks and the Windows installer build already passed. No compiler or packaging error required a workaround. Repairs address runtime correctness and missing regression coverage.
- Environment: Windows x64, Node `v24.22.1`, Electron `33.4.11`, electron-builder `25.1.8`. CI remains configured for Node 22.

## Repairs

- Reserved manual starts during asynchronous setup and assigned request generations so Stop invalidates pending work. A cancelled model load can finish, but cannot launch transcription afterward.
- Retained worker ownership until cancelled FFmpeg/HTTP work unwinds, preventing overlapping conversions and transcript writes. Automatic session replacement waits for the old worker; old failures cannot clear a newer session.
- Removed duplicate automatic pump scheduling, guarded asynchronous section selection against a changed playback position/track, and normalized nonfinite positions.
- Added cancellation checks around audio upload, response parsing, and persistence. Missing/invalid timestamp segments now produce an error without marking a section complete. Valid silence (`segments: []`) remains supported.
- Shared concurrent model loads, honored selection of a different model, validated model-list response shape, and verified readiness after loading. Model readiness is checked again before each section to recover from model unloading between sections.
- Bound managed Vibe explicitly to loopback, kept process ownership tied to the actual child, propagated spawn errors, killed timed-out startup children, and cleaned up active jobs/server on quit. External Vibe processes are not killed.
- Retained the last status for status queries. Renderer position updates cannot restart automatic transcription after Stop, and concurrent position updates are serialized. Errors turn automatic mode off to prevent repeated retries. Stale transcript search results are discarded when the query changes.
- Removed the unused preload method targeting the nonexistent `ai-transcript-position` handler.
- Added `npm test`, 18 isolated regression tests, an opt-in real Vibe smoke test, a dependency lockfile, and CI test execution using `npm ci`.

## API verification

Consulted the upstream [Vibe server README](https://github.com/thewh1teagle/vibe/blob/main/server/README.md) and server source for [models](https://github.com/thewh1teagle/vibe/blob/main/server/crates/vibe-server/src/server/routes/models.rs), [health/readiness](https://github.com/thewh1teagle/vibe/blob/main/server/crates/vibe-server/src/server/routes/health.rs), and [timestamp serialization](https://github.com/thewh1teagle/vibe/blob/main/server/crates/vibe-server/src/server/format.rs).

The existing `/v1/models`, `/v1/models/load`, multipart `/v1/audio/transcriptions`, and `verbose_json` contract is correct. Model listings represent loaded models, and verbose segment timestamps are seconds. An initial suspicion that model listings included unloaded models was ruled out by source inspection and the real integration test.

## Validation

- `npm.cmd install --no-audit --no-fund`: passed; generated the lockfile. Dependency deprecation/install-script notices were observed, but Electron and FFmpeg executables were present and exercised successfully.
- `npm.cmd run check`: passed for all five application JavaScript files.
- `npm.cmd test`: 18 regression tests passed; the opt-in real engine test skips when its three environment variables are absent.
- `npm.cmd test` with `VIBE_TEST_BINARY`, `VIBE_TEST_MODEL`, and `VIBE_TEST_AUDIO`: all 19 tests passed, with no skips.
- Real integration used upstream Windows `vibe-server` release `server-v0.6.10`, `ggml-tiny.en.bin`, and a WAV synthesized locally with Windows speech synthesis. Tested startup, model loading, real bundled FFmpeg conversion, multipart upload, timestamped results, persistence, search, and resume without repeating completed sections.
- Recognized text: "The Little Fox walked through the forest. A bright moon lit the path. This is a test of local audiobook transcription."
- Repeated that real integration through the packaged executable in Electron's Node mode, requiring `ai-transcription.cjs` directly from `resources/app.asar`: passed. This also exercised FFmpeg from `resources/app.asar.unpacked` rather than the development dependency directory.
- `npm.cmd run build:win -- --publish never`: passed. Installer output: `app/dist/EverTale-Audiobook-Player-Setup-1.8.0-beta.1.exe`, with its blockmap and unpacked application alongside it.
- Build notices: package author absent, default Electron icon used, code signing skipped because no signing identity is configured. These are existing nonfatal notices; the installer is unsigned.
- `git diff --check`: passed.
- The first local commit attempt found no configured Git identity. The successful local commit uses the existing recent repository author identity through per-command Git options; no global or repository identity configuration was changed.
- Windows PowerShell execution policy blocked the `npm.ps1` shim, so commands used `npm.cmd`; execution policy was not changed. Temporary edit-command mistakes were corrected before validation.

Regression coverage includes manual/automatic section selection, absolute timestamps, search, resume, duplicate prevention, cancel during setup/conversion/response parsing, worker ownership, automatic track replacement, shared loads, model changes, false readiness, malformed responses, HTTP 429, spawn failure, quit cleanup, and invalid inputs.

## Reproduction and local artifacts

From `app`, run `npm.cmd ci`, `npm.cmd run check`, and `npm.cmd test`. Build locally with `npm.cmd run build:win -- --publish never`.

The optional real smoke test requires absolute file paths in `VIBE_TEST_BINARY`, `VIBE_TEST_MODEL`, and `VIBE_TEST_AUDIO`, then `npm.cmd test`. Use a dedicated local test server/port; it uses the integration's fixed loopback port 3030. For packaged testing, set `VIBE_TEST_MODULE` to the absolute `dist/win-unpacked/resources/app.asar/ai-transcription.cjs` path and `ELECTRON_RUN_AS_NODE=1`, then run the packaged executable with `--test test/vibe-integration.test.cjs` and wait for its exit.

Downloaded test engine/model and synthetic WAV remain in ignored `app/dist/ai-smoke/`. Packaged test logs are there as `packaged-test.log` and `packaged-test-errors.log`. They are not committed or included in the application package. Tests use disposable temporary user-data directories and do not modify the actual audiobook library/settings. The model and Vibe executable remain user-supplied at runtime.

## Manual testing still required

1. Install the unsigned NSIS installer on a separate Windows account or test machine; check install location, launch, upgrade, and uninstall behavior. The installer was built but not installed over the user's app.
2. In the UI, browse to the real Vibe executable/model, use Start/Test, transcribe an actual audiobook section, search a phrase, and click the result to verify audible seek alignment.
3. Exercise automatic mode while playing, seeking far forward/backward, changing tracks/books, toggling automatic mode, and rapidly stopping/restarting during setup and recognition. Check status text, progress, enabled controls, and that Stop remains effective.
4. Run a long audiobook across several 90-second sections and a short final section; restart EverTale and verify persistence/resume. Include files with missing duration metadata, non-ASCII paths, removed/moved files, and read-only/full storage.
5. Test supported large models and GPU/CPU behavior on target hardware, including a machine without Vulkan support. The tiny-model local smoke test does not establish hardware compatibility, long-session performance, or recognition quality on real audiobooks.
6. Test an already-running external Vibe server, port conflicts, model unloading/server restart during playback, and shutdown while loading a large model. Aborting the client request may leave externally owned Vibe inference running briefly; a subsequent request can report HTTP 429. Failed sections remain retryable, and automatic mode stops on error.

The fixed port 3030 and dependence on a separately downloaded compatible Vibe executable/model remain existing beta constraints. Full graphical interaction, installer acceptance, and the cases above are not claimed as automated passes. No remote CI run was triggered.


# Follow-along and unattended development assignment

## A-B: inspection and follow-along reader

Continued on `feature/local-ai-transcription-beta` from clean `97d2bf2`. The reader displays saved text for the selected book and current playback track, highlights only timestamp ranges (clears gaps), scrolls inside its own panel, remembers the Follow playback toggle, and seeks through clickable passages. Track/book changes invalidate stale loads. New saved section events refresh text; reading never starts transcription. Empty and partially recognized tracks have explicit status messages.

Added four reader regression tests. `npm.cmd run check` passed; `npm.cmd test` passed 22 isolated tests with the real-engine test skipped without opt-in variables. Full real-engine, packaged, and installer checks follow the remaining implementation work.


## C: whole-book queue

Added a persistent whole-book queue that traverses known-duration tracks in order and skips all completed sections. It shares the existing worker with manual/automatic listening, serializes queue checkpoints, reports saved-section progress, retries HTTP 429/503 at most three times, and stops with a recoverable error on other failures. Pause finishes the current section; Cancel interrupts owned work. Restart recovery is paused and requires explicit Resume. Tracks with unknown duration produce a rescan instruction rather than silently omitting their tail. Completed transcripts are the source of truth on resume, including after interruption between transcript and queue saves.

Added seven queue tests plus a backend integration regression. All 30 isolated tests pass (one optional real-engine test skipped in this run). No installed application or real library files were opened for these checks.


## D: model selection and measured GPU use

Added CPU/automatic/detected-Vulkan selection, runtime device enumeration, model guidance, and explicit save/restore fallback controls. Compute changes force model reload and are refused while setup or transcription is busy. Saved transcripts are preserved across model changes. Added a configuration regression. Fixed a checkpoint race discovered by repeated queue tests: status queries now await pending durable writes.

`nvidia-smi` verified the existing RTX 3050 Laptop GPU with 4096 MiB VRAM, driver 610.62. Vibe devices reported Intel UHD index 0 and NVIDIA index 1. Benchmarked existing tiny.en plus one modest new base.en download (142 MiB), stored only under ignored app/dist/ai-smoke. No small/medium/large models or drivers were downloaded/installed. MODEL_GUIDE.md records sources, limitations, cold-start latency and reproducible commands.

On the approximately 8.6-second synthetic sample, tiny CPU requests took 0.85-0.94 s versus 0.11-0.16 s warm Vulkan; base CPU took 1.86-2.13 s versus 0.15-0.18 s Vulkan. An initial cold tiny Vulkan request took 9.56 s. Explicit NVIDIA Vulkan selection was corroborated by Windows GPU Engine counters for the Vibe PID (8.5-13.8 percent 3D engine plus copy activity during repeated base requests; no active per-process readings for CPU). Aggregate VRAM rose from approximately 57 MiB to 291 MiB. These short-sample results verify this benchmark's GPU activity, not long-book throughput or an accuracy improvement on real narration. Existing real model paths/settings were not opened or changed. Logs/JSON remain ignored in app/dist/ai-smoke.


## E: unattended runner and scheduler preparation

Added automation/Run-Overnight.ps1, session.cjs, result-schema.json, prioritized backlog.json, Setup-OvernightTask.ps1, and OVERNIGHT_PLAN.md. The loop is noninteractive, bounded by iterations/per-process/total time, uses an exclusive file lock, preserves logs and structured results, and validates branch/history/changed paths before locally committing. STOP interrupts owned subprocesses; PAUSE stops future work. Serious errors persist PAUSE and leave partial edits for review. Backlog entries requiring user acceptance stop the loop rather than silently skipping ahead.

Codex execution uses the workspace sandbox, approval policy never, explicit non-elevated MXC, no extra write roots/direct network, ephemeral sessions, and disabled personal config/apps/plugins/hooks/multi-agent tools. Runner-controlled checks also use the MXC workspace sandbox. The runner refuses an elevated host shell. Authentication, drivers, system policy and sandbox configuration were not modified. No editing Codex session or recurring schedule was launched against the real checkout; the only live Codex probe was read-only Get-Location with structured READY output.

Dry-run selection, exclusive locking, STOP handling, dirty-tree refusal, persistent PAUSE, process-tree deadlines, synthetic successful local commits, unapproved-path refusal and blocked-agent refusal were tested in disposable fixture Git repositories inside .overnight. Seven infrastructure tests run in the ordinary Windows suite. Inside nested MXC they skip explicitly because process-control tests cannot manage their nested trees there; all product/reader/queue tests still run sandboxed. Initial sandbox validation exposed MXC virtualized temporary-directory rename failures. Test fixtures now use explicit project-local .overnight/tmp paths, with no broader permissions. A PowerShell JSON-array/BOM issue and asynchronous process exit-code retrieval issue found during runner tests were fixed.

The actual disabled Task Scheduler XML was generated and inspected: overall Enabled=false, LeastPrivilege, InteractiveToken, IgnoreNew, and a 95-minute outer limit. No task was registered or enabled. Normal powershell.exe -File launch was tested and is blocked by this machine's existing script execution policy. That remains a manual prerequisite: approve local script signing/execution through normal Windows policy before the schedule is usable. No ExecutionPolicy Bypass switch or policy change was made. Trusted runner command-block dry runs, real read-only Codex execution and sandboxed product validation passed; normal scheduled -File launch is not claimed as passed.

Automatic approval review rejected a proposed Git hook override because disabling hooks could bypass repository validation. That proposal was abandoned. The implemented runner leaves hooks intact and stops for manual review when a custom hooksPath or hook is present. No hook configuration was changed, and no approval for bypassing hooks is needed or requested.

## F: final quality checks and handoff

- npm.cmd run check: passed for all application modules, including the reader and queue.
- npm.cmd test with local real-engine environment variables: **40 passed, zero failures/skips**. This includes the seven infrastructure tests and a real Vibe smoke that now traverses two synthetic tracks through the whole-book queue while reusing the saved first track.
- Runner-controlled MXC validation: syntax checks and all product/reader/queue tests passed. Infrastructure process-control tests and the opt-in real-engine test skip explicitly in that context; this is distinct from the full 40-test Windows run.
- Hidden Electron UI smoke passed against development assets and packaged app.asar assets: saved reader text, highlight/gaps, clickable seeking, Follow toggle persistence, track/book switching, new background text, queue pause/resume/cancel controls, and GPU selector. The packaged UI test loads the packaged HTML/preload/scripts in the matching Electron 33 runtime with synthetic IPC, not the installed application's real main process. Fresh project-local userData is used for each run.
- The packaged executable in Electron Node mode passed the real Vibe/FFmpeg/transcription/search/resume/two-track queue smoke, loading backend modules from app.asar and FFmpeg from app.asar.unpacked.
- Final Windows NSIS build with --publish never passed. Artifact: app/dist/EverTale-Audiobook-Player-Setup-1.8.0-beta.1.exe (103,986,540 bytes), SHA256 5FD3599B3B7B3711B369A1691D7616394172D3339794C77384CDE3F35FE867CC. Existing unsigned/default-icon/missing-author notices remain nonfatal.
- UI validation prompted moving the reader above engine setup and correcting its scroll coordinate calculation. A dedicated regression checks container-relative scrolling. Screenshots remain under ignored app/dist/ui-smoke/; stdout/stderr logs are under app/dist/ai-smoke/.
- git diff --check passed. No push, merge, release, schedule activation, elevation, or installed-app/data overwrite occurred. All source changes remain on feature/local-ai-transcription-beta with local commits only.

Remaining acceptance: user testing on real long audiobooks, audible segment alignment over extended listening, responsiveness/thermals on battery vs AC, crash/reboot recovery, file/disk failures, and separate-account installer acceptance. Unknown-duration tracks require a rescan for whole-book mode. Small/medium/large model evaluation and real-narration quality comparisons remain unmeasured. The overnight backlog retains three safe follow-up tasks and a manual-acceptance stop. OVERNIGHT_PLAN.md gives the exact dry-run/probe/register-disabled/enable commands; normal local PowerShell script execution must be approved first, and recurring activation still requires the user's explicit choice.
