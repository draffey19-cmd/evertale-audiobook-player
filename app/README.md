# EverTale Audiobook Player

Private source repository. Windows builds run through GitHub Actions.

## Data compatibility
The app deliberately keeps the original `Hearth Audiobooks` Electron user-data directory to preserve the library and progress during the rename. Back up data before installing.

## Builds
GitHub Actions -> Build EverTale for Windows -> Run workflow; download the Windows installer from the workflow artifacts.

## Updates
The app is configured to check GitHub Releases. **Private releases do not work anonymously with the built-in updater.** One-click update delivery requires a separately configured public binary-only release host or authenticated distribution. Do not publish this private source repository just to make the updater work.
