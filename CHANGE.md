# Changelog

## Unreleased

## 0.1.2

- Added first-run app bootstrap that reloads user systemd units, enables and starts the Livedesk daemon, and enables the GNOME Shell extension when the current session can already see it.
- Enabled the user daemon globally from Debian/RPM package post-install scripts where supported, so Livedesk starts automatically on future logins.
- Updated install guidance so opening `livedesk` is the primary post-install step, with `livedesk-setup` kept as a manual fallback.
- Bumped package, daemon, app, and extension metadata versions for the 0.1.2 release.

## 0.1.1

- Added GTK4/Libadwaita app as the primary Livedesk UI.
- Added folder-based video gallery using `~/Videos/Livedesk`.
- Added a sidebar-based settings view with background service, library, wallpaper, and audio sections.
- Added app controls for starting/stopping the daemon and enabling/disabling autostart from settings.
- Switched the video gallery to fixed-size tiles that wrap naturally with the window width.
- Replaced the GTK menu button with direct header-bar actions to avoid GTK CSS corner critical warnings.
- Kept file chooser dialogs alive while open so import/selection windows do not close unexpectedly.
- Bumped package, daemon, app, and extension metadata versions for the 0.1.1 release.
- Added static thumbnail generation with `totem-video-thumbnailer` or `ffmpeg`.
- Added GNOME Shell extension variants for GNOME 40-44 and 45-51.
- Added Debian and RPM package builders.
- Added package post-install variant selection based on `gnome-shell --version`.
- Added `livedesk-setup` helper for first-run setup.
- Added `livedesk-uninstall` helper for clean removal and optional purge.
- Separated GTK app ID from daemon D-Bus name to avoid session bus conflicts.
- Fixed packaged systemd service path to use `/usr/bin/livedesk-daemon`.
- Added D-Bus reconnect handling in the extension when the daemon starts late.
- Switched extension frame upload to `Cogl.PixelFormat.RGBA_8888` for GNOME 43 compatibility.
- Removed custom GTK tile CSS that could trigger GTK corner-value warnings on some themes.

## 0.1.0

- Initial Livedesk prototype with Rust/GStreamer daemon, shared-memory frame buffer, GNOME Shell extension, and GTK app packaging.
