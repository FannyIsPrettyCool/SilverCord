# Platform limits

Honest list of things a platform cannot do, the fallback we ship, and how the user
is told. Add an entry the moment a limit is discovered; never fake a capability.

| Area | Platform | Limit | Fallback | User-visible notice | Verified |
|---|---|---|---|---|---|
| Window blur behind app | Linux (X11 + Wayland), Windows 10 | No OS backdrop material exposed by Electron; Wayland blur is compositor-specific and not surfaced | In-app glass over the ambient layer (same look everywhere) | none needed | pending (phase 1) |
| Global push-to-talk | Linux Wayland | No global key capture for regular clients | XDG GlobalShortcuts portal if Electron supports it, else in-focus-only PTT | yes, in keybind settings | pending (phase 4) |
| Code signing | Windows | Unsigned NSIS installers trigger SmartScreen | Signing step wired to env-provided certificate, off until a cert is supplied | release notes + RUNBOOK | pending (phase 7) |
| Windows installer builds | Linux dev host | NSIS builds need a Windows runner or Wine | Windows CI runner (GitHub Actions `windows-latest`) | n/a | pending (phase 7) |
| Screen-share audio | Linux | System audio capture depends on PipeWire + portal; not all compositors offer it | Video-only share with a notice | yes, in source picker | pending (phase 4) |
| Persistent sign-in | Linux without a Secret Service (no GNOME Keyring / KWallet) | `safeStorage` falls back to the `basic_text` backend, which is obfuscation only | The refresh token is kept in memory only; signing in is needed after each restart | yes, `persistent: false` surfaced to the UI (phase 1 login screen) | 2026-10-17, code path |
| Windows 11 Mica | Windows 10, Windows 11 < 22H2 | `backgroundMaterial` needs build 22621+ | Same in-app ambient backdrop as Linux | none needed | pending (needs a Windows machine) |
| Electron `evaluate`-based CSP probes | Test tooling | CDP-evaluated code is exempt from the page CSP | Security test asserts the CSP header and a real inline-script violation instead | n/a | 2026-10-17 |
