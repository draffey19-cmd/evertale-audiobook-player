# EverTale local AI transcription development report

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
