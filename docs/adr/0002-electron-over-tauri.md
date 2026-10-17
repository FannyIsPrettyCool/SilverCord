# ADR-0002: Electron over Tauri for the desktop client

- Status: accepted
- Date: 2026-10-17

## Context

The client needs: identical WebRTC behaviour on Windows and Linux (voice, video,
screen share with system audio), heavy and consistent use of `backdrop-filter`
plus Chromium-only SVG filters for the glass design (§7.2), screen capture on
Wayland via xdg-desktop-portal + PipeWire, and a mature auto-update/installer
pipeline.

## Options

1. **Tauri.** Small binaries, Rust backend, low idle RAM. Renders in the OS
   webview: WebView2 (Chromium) on Windows, WebKitGTK on Linux. WebKitGTK's WebRTC
   support and `backdrop-filter` performance differ from Chromium and vary by
   distribution package version; `backdrop-filter: url(#svg)` is Chromium-only.
   Screen capture with audio would need native code per platform.
2. **Electron.** Ships its own Chromium and Node. Larger installers and higher
   baseline RAM. Same rendering and WebRTC stack on every OS; `desktopCapturer` +
   `setDisplayMediaRequestHandler` cover screen share; PipeWire capture on Wayland
   is supported by Chromium; `electron-builder` + `electron-updater` cover NSIS,
   AppImage, deb, rpm and staged update channels.
3. **Native per OS.** Out of scope for a single-team v1.

## Decision

Electron (newest stable at init: 44.9.0, verified with `npm view electron version`
on 2026-10-17; 45 is in beta and scheduled for 2026-10-20). Bootstrapped with
`electron-vite`, packaged with `electron-builder`, hardened per §8.2 with
`@electron/fuses`.

## Consequences

- One rendering engine to design and test against; glass and WebRTC behaviour
  are the same on Windows and Linux.
- Installer size (~100 MB) and baseline memory are higher; the RAM budget in
  §10.3 (≤500 MB typical) must be watched.
- Security posture depends on our hardening (context isolation, sandbox, fuses,
  CSP, IPC validation); this is enforced by a test from phase 1.
- Electron major upgrades are frequent (8-week cadence); budget an upgrade per
  phase and re-verify platform flags each time.
