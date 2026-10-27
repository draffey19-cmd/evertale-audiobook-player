# Local transcription on the RTX 3050 laptop

Keep `ggml-tiny.en.bin` as the working English fallback. Before selecting another file, use **Keep selected model as fallback**. **Use saved fallback** restores it without deleting transcripts. Model changes affect future sections; already saved work is reused. No models download automatically.

The app now offers CPU only, automatic backend, and detected Vulkan device selection. **Detect GPU devices** enumerated Intel UHD as index 0 and NVIDIA RTX 3050 Laptop GPU as index 1 on this machine. Select by the displayed description, not an assumed index on another machine. Stop/pause work and let its section finish before changing settings; **Start / test Vibe** applies the selection. A saved GPU preference alone is not a measurement of GPU use.

| Compatible Whisper file | Approximate download | Practical role |
| --- | --- | --- |
| `ggml-tiny.en.bin` | 75 MiB | Fast English fallback; limited accuracy |
| `ggml-base.en.bin` | 142 MiB | First accuracy comparison for English narration |
| `ggml-small.en.bin` | 466 MiB | Candidate for better accuracy with more computation |

These are whisper.cpp GGML models. The `.en` variants are English only; use multilingual variants for other languages. Quantized GGML models can reduce storage/memory, with a quality tradeoff to evaluate. A `.gguf` extension alone does not establish compatibility with every Vibe release. The whisper.cpp [model/memory table and quantization documentation](https://github.com/ggml-org/whisper.cpp#memory-usage) is a starting point, not a guarantee of Vulkan VRAM consumption. Small is a reasonable *candidate* for 4 GB; medium/large need separate memory and latency validation. No medium, large, or small model was downloaded in this assignment.

Windows Vibe uses Vulkan rather than requiring a CUDA toolkit. See the [Vibe server documentation](https://github.com/thewh1teagle/vibe/blob/main/server/README.md). No drivers, CUDA packages, services, or global configuration were installed or changed.

## Measurements on this laptop

Hardware reported by `nvidia-smi`: RTX 3050 Laptop GPU, 4096 MiB VRAM, existing driver 610.62. Tested Vibe `server-v0.6.10`, tiny.en and base.en using an approximately 8.6-second locally synthesized English WAV. Base.en was the only new download (about 142 MiB), stored under ignored `app/dist/ai-smoke/`; the existing tiny file was preserved.

| Model | CPU inference, three requests | NVIDIA Vulkan inference, warm cache | Load time |
| --- | --- | --- | --- |
| tiny.en | 0.85–0.94 s | 0.11–0.16 s | about 0.5 s |
| base.en | 1.86–2.13 s | 0.15–0.18 s | about 0.6 s |

An earlier first-ever tiny Vulkan request took **9.56 seconds**, followed by 0.12–0.15 seconds: initial shader/setup cost matters. The table is not a promise for 90-second sections, battery mode, a thermally throttled laptop, other voices, or a long audiobook. Both models recognized the simple sample, so this does **not** demonstrate an accuracy improvement on difficult narration. Compare punctuation, names and missed words against a manually checked excerpt before choosing a default. Base.en is a measured speed candidate, not a proven quality winner for your books.

GPU activity was checked beyond enumeration: during repeated base requests, Windows counters for the **Vibe process PID** showed GPU 3D-engine activity around 8.5–13.8% and copy-engine activity, versus no active per-process engine readings in CPU mode. Explicit Vulkan device 1 was selected; NVIDIA VRAM rose from about 57 MiB system usage to about 291 MiB. Background applications also affect aggregate utilization, so aggregate `nvidia-smi` percentages alone were not used as proof. This verifies GPU use for the benchmark process, not every future app session.

Reproduce from `app`:

```powershell
$env:VIBE_VERIFY_ENGINES = '1'
node scripts/benchmark-vibe.cjs dist/ai-smoke/vibe-server.exe dist/ai-smoke/ggml-base.en.bin dist/ai-smoke/speech.wav 1
```

The benchmark uses its own dynamically assigned loopback port and synthetic WAV, captures per-process diagnostics, and kills only its child server. It never opens EverTale userData. JSON results and logs remain in `app/dist/ai-smoke/`. WDDM reports per-process VRAM as N/A on this machine; that limitation is preserved in the logs. Engine-counter diagnostics are a separate repeated workload, not part of the three timed requests.
