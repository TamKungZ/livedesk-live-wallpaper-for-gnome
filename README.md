# Livedesk - Live Wallpaper for GNOME

Livedesk turns a video file into a GNOME desktop background. It uses a
GNOME Shell extension for the compositor-facing wallpaper actor, a small
Rust/GStreamer daemon for video decoding, and a GTK settings app for
configuration.

Unlike hidden fullscreen-player approaches, Livedesk draws inside GNOME
Shell's background group, behind normal windows.

## Features

- Video wallpaper rendered as a GNOME Shell background actor
- GTK4/Libadwaita settings app (`livedesk`)
- Rust daemon (`livedesk-daemon`) using GStreamer for decoding
- Shared-memory frame handoff between daemon and Shell extension
- D-Bus controls for source, playback, mute, and frame paths
- GNOME Shell 40-49 support through separate extension variants
- Debian and RPM packaging scripts
- GPL-3.0-or-later licensed

## Architecture

```
video file
  -> livedesk-daemon
  -> /run/user/<uid>/livedesk/<monitor>.frame
  -> GNOME Shell extension
  -> Clutter actor in Main.layoutManager._backgroundGroup
  -> Mutter compositor
```

Per-frame pixel data is not sent over D-Bus. The daemon writes RGBA
frames to a memory-mapped file, and the extension polls that file with a
small seqlock header to avoid torn frame reads. D-Bus is used only for
coarse control such as play, pause, mute, source changes, and frame path
lookup.

## Requirements

Debian/Ubuntu package names:

```bash
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav \
  totem
```

The `*-dev` packages are required to build the Rust daemon. The
`gstreamer1.0-*` plugin packages provide runtime decoders for formats
such as H.264, VP8, VP9, and AV1. `totem` provides
`totem-video-thumbnailer`, which Livedesk uses for static gallery
thumbnails when available.

If Cargo reports missing files such as `gstreamer-1.0.pc`,
`gstreamer-app-1.0.pc`, or `gstreamer-video-1.0.pc`, the GStreamer
runtime is installed but the development headers are missing. Install:

```bash
sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
```

## Install From Source

```bash
./install.sh
```

Then enable and start the components:

```bash
systemctl --user enable --now livedesk-daemon
gnome-extensions enable livedesk@me.tamkungz
livedesk
```

On Wayland, a logout/login is usually required after installing a new
GNOME Shell extension. On X11, GNOME Shell can usually be restarted with
Alt+F2, `r`, Enter.

The installer chooses the correct extension variant for the current
GNOME Shell version:

- GNOME 45-49: ES module extension
- GNOME 40-44: legacy `imports.*` extension

## Usage

Open the settings app:

```bash
livedesk
```

The app can:

- show saved videos as a thumbnail gallery
- select a video from the gallery and apply it immediately
- add video files to the gallery
- choose the monitor key, such as `monitor-0`
- set output width and height
- mute or unmute playback
- start the daemon
- send play, pause, stop, and apply commands over D-Bus

Use the hamburger menu in the top-right corner for daemon controls and
settings.

Imported videos are copied into the Livedesk library folder:

```text
~/Videos/Livedesk
```

Static thumbnails are cached in:

```text
~/.cache/livedesk/thumbnails
```

The app writes configuration to:

```text
~/.config/livedesk/config.json
```

## Manual Build

Build the daemon:

```bash
cd daemon
cargo +1.77 build --release --locked
```

The daemon binary is:

```text
daemon/target/release/livedesk-daemon
```

The GTK app source is executable directly:

```text
app/livedesk.js
```

## GNOME Extension Zips

Build extension upload zips:

```bash
scripts/build-extension-zip.sh all
```

Outputs:

- `dist/livedesk-extension-gnome45-49.zip`
- `dist/livedesk-extension-gnome40-44.zip`

For <https://extensions.gnome.org/upload/>, upload the zip matching the
target GNOME Shell series. The zips contain only the GNOME Shell
extension and its preferences UI. They do not install the standalone GTK
app or native daemon.

For a complete install, use `./install.sh`, the `.deb`, or the `.rpm`.

## Debian and RPM Packages

Build local release packages:

```bash
scripts/package-linux.sh
```

Outputs are written to `dist/`:

- GNOME extension upload zips
- Debian package (`.deb`)
- RPM package (`.rpm`)

The `.deb` and `.rpm` packages include:

- `livedesk`
- `livedesk-daemon`
- desktop entry
- systemd user service
- GNOME Shell extension files
- extension zips under `/usr/share/livedesk/extensions`

## GitHub Releases

The repository includes a GitHub Actions workflow at:

```text
.github/workflows/release.yml
```

It builds the daemon, extension zips, `.deb`, and `.rpm`, then uploads
the artifacts. Tagged releases matching `v*.*.*` also publish GitHub
Release assets.

## Development Notes

- Rust toolchain: `1.77`
- Rust edition: `2021`
- D-Bus name: `me.tamkungz.Livedesk`
- GNOME extension UUID: `livedesk@me.tamkungz`
- Config directory: `~/.config/livedesk`
- Runtime frame directory: `$XDG_RUNTIME_DIR/livedesk`

GNOME Shell APIs used for background actor placement and fullscreen or
lock-screen detection are not stable public extension APIs. Compatibility
may require fixes when GNOME Shell internals change.

The current renderer uploads frames through CPU memory into
`Clutter.Image`. This is simple and portable, but not a zero-copy GPU
pipeline. High-resolution or high-frame-rate wallpapers may need a
future DMABUF/GL texture path.

## Repository Layout

```text
livedesk/
├── app/                     GTK4/Libadwaita settings app
├── data/                    desktop entry
├── daemon/                  Rust + GStreamer decode daemon
├── shell-extension/         GNOME 45-49 extension
├── shell-extension-legacy/  GNOME 40-44 extension
├── scripts/                 package and extension zip builders
├── config.example.json
├── install.sh
└── livedesk-daemon.service
```

## Contributing

Issues and pull requests are welcome. Useful areas include GNOME version
compatibility, packaging improvements, hardware decode options,
per-monitor settings, and lower-copy rendering paths.

## License

Livedesk is licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
