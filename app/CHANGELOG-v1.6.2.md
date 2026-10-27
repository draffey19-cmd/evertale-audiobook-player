# Hearth 1.6.2 stability fixes

- Cache invalidated after title, author, cover and folder edits, and backup restores.
- Serialized, atomic settings/progress writes to prevent out-of-order overwrites.
- Playback speed retained across chapter files.
- Improved chapter-end sleep detection (within 0.5 seconds).
- Progress save also triggered when window is hidden.
- Visible error when an audio file cannot be decoded.

## Limitations
Not verified on Windows. Unsupported codecs still require transcoding, and saved progress on a forced shutdown cannot be guaranteed. Back up your user data before upgrading.
