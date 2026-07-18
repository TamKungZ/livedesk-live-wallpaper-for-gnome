# Changelog

## 1.0.0

- Replaced the GNOME Shell extension runtime with a GNOME Shell native background overlay.
- Changed video selection to use GNOME's own `org.gnome.desktop.background picture-uri` and `picture-uri-dark` settings as the wallpaper source.
- Added `livedesk-setup` native overlay installation through `GNOME_SHELL_JS`, with setup checks and user-session daemon startup.
- Added a GNOME Shell native background module that detects video wallpaper URIs, starts the daemon, and reads frames from shared memory.
- Added `SetMonitorSource` D-Bus control so the daemon can create per-monitor frame buffers at the real monitor resolution.
- Moved Livedesk playback preferences into a standalone GSettings schema under `data/schemas`.
- Removed the 0.1.x GNOME Shell extension sources and extension zip builder from the active code path.
- Updated Debian/RPM packaging to install the native background files and schema instead of extension variants.
- Rewrote user documentation around the native wallpaper flow and moved 0.1.x extension notes into legacy documentation.
- Fixed service mode and autostart toggles to stop using `systemctl mask`, which fails when the user unit file exists.
- Added detailed app-side command logging to `~/.cache/livedesk/livedesk.log` and the Background Service settings page.
- Added terminal-visible action logging for app buttons, setup commands, daemon calls, and still-frame generation.
- Added first-frame static PNG fallback generation for GNOME surfaces that still need an image wallpaper.
- Added a separate Ayatana/AppIndicator tray helper with quick app, play, pause, restore, and log actions.
- Fixed black GNOME/Zorin overview backgrounds by attaching the native live actor to workspace preview backgrounds as well as the desktop background.
- Reduced overview flicker by making non-desktop background actors passive frame readers instead of daemon controllers.
- Added a Mutter-native roadmap for replacing the Shell actor overlay with a real background content renderer.
- Added Linux x64 and arm64 release build/publish coverage for Debian and RPM packages.

## 0.1.3

- Fixed the app startup bootstrap so disabled service mode and autostart settings are not re-enabled when Livedesk is opened again.
- Kept first-run setup automatic by enabling and starting the user daemon unless the user has explicitly disabled service mode or autostart.
- Changed package post-install scripts to stop globally enabling the user daemon by default.
- Changed Autostart off to apply a per-user systemd mask so it overrides older global package autostart state.
- Updated `livedesk-setup` to unmask the user daemon before enabling it again.
- Added a header-bar action to restore the normal GNOME wallpaper.
- Changed Stop to stop playback and restore the normal GNOME wallpaper instead of leaving the live wallpaper actor visible.
- Added extension state for hiding and recreating live wallpaper actors when wallpaper playback is disabled or applied again.
- Bumped package, daemon, app, and extension metadata versions for the 0.1.3 release.

## 0.1.2

- Added first-run app bootstrap that reloads user systemd units, enables and starts the Livedesk daemon, and enables the GNOME Shell extension when the current session can already see it.
- Added a GTK setup button for manually running `livedesk-setup` from the Background Service settings page.
- Added setup status text that tells the user when a logout/login is still required for GNOME Shell extension discovery.
- Changed the startup setup notice to stay silent when setup is complete and list only the missing user actions when setup is incomplete.
- Added Launchpad PPA source packaging with vendored Rust crates for offline builders.
- Added per-series Launchpad source generation for Jammy and Noble uploads.
- Signed Launchpad source uploads by default, with `UNSIGNED=1` available for local-only tests.
- Included source `.buildinfo` files in Launchpad output directories so `dput` can upload every file referenced by `.changes`.
- Added optional automatic Launchpad upload with `UPLOAD=1 PPA=...`, including checks for required files and signatures.
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
