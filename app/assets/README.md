EverTale branding assets

- `evertale-original.png` is a byte-for-byte copy of the approved source.
- The supplied source is RGB with an opaque near-black background, not an alpha PNG.
- `evertale-transparent.png` removes only edge-connected background pixels with RGB channels <= 12. Foreground colors remain unchanged.
- Theme logos retain the same geometry and alpha. Non-purple variants change hue while retaining HSL lightness and saturation.
- PNG icons span 16 to 512 pixels; the ICO contains 16, 20, 24, 32, 40, 48, 64, 128 and 256 pixel entries. Windows and NSIS always use purple.
- Regenerate from the preserved source with `python app/scripts/generate-brand-assets.py` from the project root (Pillow required).

Theme preferences use the local Electron browser storage key `evertale.appearance.theme`. Missing or unknown values use Original Purple. They are independent of listener profiles and library backup files.
The legacy user-data path and application ID remain for compatibility; displayed branding is EverTale.

Windows shortcut icons

`win.signAndEditExecutable` must remain enabled: electron-builder uses `win.icon` when editing the packaged EXE resources. NSIS shortcuts use that EXE's icon index 0. `installerIcon` and `uninstallerIcon` separately brand the installer/uninstaller.
Changing renderer assets or BrowserWindow.icon cannot update an already installed EXE or its shortcuts. A newly built and installed release is required. Windows may retain a cached shortcut icon afterward; check the shortcut target and installed version before considering cache refresh. Do not rewrite user shortcuts or delete icon caches as part of project validation.
