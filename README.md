<div align="center">
  <img
    src="https://static.tamkungz.me/assets-image/livedesk-live-wallpaper/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg"
    alt="Livedesk icon"
    width="128"
    height="128"
  />

  <h1>Livedesk - Live Wallpaper for GNOME</h1>

  <p>
    <a href="https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/TamKungZ/livedesk-live-wallpaper-for-gnome?display_name=tag"></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue"></a>
    <img alt="GNOME Shell" src="https://img.shields.io/badge/GNOME%20Shell-40--51-4a86cf">
    <img alt="GTK4" src="https://img.shields.io/badge/GTK-4-4a86cf">
    <img alt="Libadwaita" src="https://img.shields.io/badge/Libadwaita-1-4a86cf">
    <img alt="Rust" src="https://img.shields.io/badge/Rust-1.77-b7410e">
    <img alt="Packages" src="https://img.shields.io/badge/packages-DEB%20%7C%20RPM-2ea44f">
  </p>

  <img
    src="https://static.tamkungz.me/assets-image/livedesk-live-wallpaper/preview/livedesk-live-wallpaper-preview-low.gif"
    alt="Animated preview of Livedesk running a live video wallpaper on GNOME"
    width="80%"
  />
</div>

Livedesk turns a video file into a GNOME desktop background. It uses a
GNOME Shell extension for the compositor-facing wallpaper actor, a small
Rust/GStreamer daemon for video decoding, and a GTK settings app for
configuration.

Unlike hidden fullscreen-player approaches, Livedesk draws inside GNOME
Shell's background group, behind normal windows.

For installation steps, see [SETUP.md](SETUP.md).

## Features

- Video wallpaper rendered as a GNOME Shell background actor
- GTK4/Libadwaita settings app (`livedesk`)
- Rust daemon (`livedesk-daemon`) using GStreamer for decoding
- Shared-memory frame handoff between daemon and Shell extension
- D-Bus controls for source, playback, mute, and frame paths
- GNOME Shell 40-51 support through separate extension variants
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

## Install

Debian/Ubuntu:

```bash
curl -fsSL https://packages.tamkungz.me/gpg.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/tamkungz-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/tamkungz-archive-keyring.gpg] https://packages.tamkungz.me/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/tamkungz.list
sudo apt update
sudo apt install livedesk
livedesk
```

Fedora/RHEL-like distributions:

```bash
sudo rpm --import https://packages.tamkungz.me/gpg.key
sudo tee /etc/yum.repos.d/tamkungz.repo >/dev/null <<'EOF'
[tamkungz]
name=TamKungZ_ Packages
baseurl=https://packages.tamkungz.me/rpm/x86_64
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://packages.tamkungz.me/gpg.key
EOF
sudo dnf install livedesk
livedesk
```

## Install From Source

```bash
./install.sh
livedesk
```

Then open the app:

```bash
livedesk
```

On Wayland, a logout/login is usually required after installing a new
GNOME Shell extension. On X11, GNOME Shell can usually be restarted with
Alt+F2, `r`, Enter.

The installer chooses the correct extension variant for the current
GNOME Shell version:

- GNOME 45-51: ES module extension
- GNOME 40-44: legacy `imports.*` extension

## Requirements

Debian/Ubuntu package names:

```bash
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev \
  libunwind-dev \
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
sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libunwind-dev
```

## Usage

Open the settings app:

```bash
livedesk
```

The app can:

- show videos from the library folder as a compact thumbnail gallery
- select a video from the gallery and apply it immediately
- open the library folder
- import video files into the library folder
- choose from detected monitors
- use the detected monitor resolution automatically
- mute or unmute playback
- start the daemon
- send play, pause, stop, and apply commands over D-Bus

Use the hamburger menu in the top-right corner for daemon controls and
settings.

The library folder is the main source of videos. Put video files here,
or use the app's import action to copy files into it:

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

- `dist/livedesk-extension-gnome45-51.zip`
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
- `livedesk-setup`
- `livedesk-uninstall`
- desktop entry
- systemd user service
- GNOME Shell extension files
- extension zips under `/usr/share/livedesk/extensions`

The packages install both extension variants and select the active one
from `gnome-shell --version` during post-install:

- GNOME 40-44: legacy `imports.*` extension
- GNOME 45-51: ES module extension

After installing a package, open the app to finish setup for the current
user automatically:

```bash
livedesk
```

If `gnome-extensions` says the extension does not exist, log out and
back in first so GNOME Shell can discover the newly installed system
extension, then open `livedesk` again. `livedesk-setup` remains
available as a manual setup helper.

Uninstall:

```bash
livedesk-uninstall
```

To also remove settings and thumbnail cache:

```bash
livedesk-uninstall --purge
```

The video library at `~/Videos/Livedesk` is kept unless
`--purge-library` is passed.

## Launchpad PPA Source Package

Launchpad builds run without network access during package builds, so
the Rust dependencies are vendored under `daemon/vendor/`. The vendor
directory is ignored by git; create it locally before building the source
upload:

```bash
cd daemon
cargo vendor --locked vendor
cd ..
```

Normal local Cargo builds are not forced to use the vendor directory.
The Debian packaging writes a temporary Cargo config only while building
the Launchpad package.
Launchpad builds use Ubuntu's `rustc-1.77` and `cargo-1.77` packages
when available, falling back to unversioned `rustc`/`cargo` only if they
are new enough.

Build the source upload locally:

```bash
scripts/package-launchpad-source.sh
```

Outputs are written under:

```text
dist/launchpad/<series>/
```

Build separate source uploads for Jammy and Noble:

```bash
SERIES=jammy scripts/package-launchpad-source.sh
SERIES=noble scripts/package-launchpad-source.sh
```

Build and upload in one command:

```bash
UPLOAD=1 PPA=ppa:tamkungz/stable SERIES=jammy scripts/package-launchpad-source.sh
UPLOAD=1 PPA=ppa:tamkungz/stable SERIES=noble scripts/package-launchpad-source.sh
```

The upload files are signed by default because Launchpad requires signed
`.changes` files. For local unsigned testing only, run with
`UNSIGNED=1`.

The script reads the upstream version from `debian/changelog` by default.
For a normal release, update `debian/changelog`, make sure
`daemon/vendor/` exists, then run the upload command for each target
series.

Upload the generated source changes files to a PPA:

```bash
dput ppa:<launchpad-user>/<ppa-name> dist/launchpad/jammy/livedesk_0.1.2-1~jammy1_source.changes
dput ppa:<launchpad-user>/<ppa-name> dist/launchpad/noble/livedesk_0.1.2-1~noble1_source.changes
```

## GitHub Releases

The repository includes a GitHub Actions workflow at:

```text
.github/workflows/release.yml
```

It builds the daemon, extension zips, `.deb`, and `.rpm`, then uploads
the artifacts. Tagged releases matching `v*.*.*` also publish signed
GitHub Release assets and update the APT/RPM repositories in
`TamKungZ/packages.tamkungz.me`.

## Development Notes

- Rust toolchain: `1.77`
- Rust edition: `2021`
- D-Bus name: `me.tamkungz.Livedesk`
- GTK app ID: `me.tamkungz.LivedeskApp`
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
├── shell-extension/         GNOME 45-51 extension
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
