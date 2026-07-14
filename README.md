# Livedesk - Live Wallpaper for GNOME

Makes a looping video the *actual* GNOME desktop background -- an actor
living inside GNOME Shell's own background group, behind every real
window -- instead of a hidden fullscreen player window pretending to be
a wallpaper.

This is the **Phase 1** prototype described in the design doc: a GNOME
Shell extension + a small native daemon + a standalone GTK settings app,
talking over D-Bus and a shared-memory frame buffer. It is *not* the
"patch Mutter directly" end-game (Phase 3) -- see "Where this goes
next" below.

## How it works

```
video file
   |
   v
livedesk-daemon (Rust + GStreamer)
   |  decodes to RGBA, writes each frame into /run/user/<uid>/livedesk/<monitor>.frame
   |  (lock-free seqlock header so readers never see a torn frame)
   v
shell-extension (GJS, ES modules)
   |  polls that file on a GLib timeout, builds a Clutter.Image per frame
   v
Clutter.Actor inside Main.layoutManager._backgroundGroup
   |
   v
Mutter compositor draws it as part of the desktop background
```

Control (which video, play/pause/mute) goes over a small D-Bus
interface (`me.tamkungz.Livedesk`) -- never per-frame pixel data,
that would be far too slow over D-Bus.

The primary settings UI is the standalone `livedesk` GTK app. It writes
`~/.config/livedesk/config.json` and applies changes to a running daemon
over D-Bus.

### Why a separate daemon instead of decoding inside GNOME Shell?

GNOME Shell (`gnome-shell` process) is a single point of failure for
your whole session -- if it crashes, your session dies. Video decoding
has plenty of ways to crash (corrupt files, buggy hardware-decode
drivers, OOM on large frames). Keeping decode in a separate process
means a decoder crash just stops your wallpaper; `systemctl --user
restart livedesk-daemon` fixes it without touching your session.

### Why shared memory instead of, say, sending PNGs over D-Bus?

One 1920x1080 RGBA frame is ~8.3 MB. At 30 fps that's ~250 MB/s if you
copy it through D-Bus message serialization -- it would fall over
immediately. A shared mmap'd file lets the daemon write in place and
the extension read in place; the only "IPC" cost is memory-safe
synchronization (the seqlock), not data copying through a broker.

## What's genuinely built vs. still rough

**Built and compiles cleanly** (verified against `rustc`/`cargo` 1.77,
GStreamer 1.24, `dbus`/`dbus-crossroads`):
- `daemon/`: GStreamer playbin -> appsink(RGBA) -> shared-memory seqlock
  writer, with a D-Bus control surface (`SetSource`, `Play`, `Pause`,
  `Stop`, `SetMuted`, `FramePath`, `ListMonitors`).
- `app/`: GTK4/Libadwaita Livedesk app for selecting the video source,
  monitor, output size, mute state, and daemon playback controls.
- `shell-extension/`: GNOME 45+ ES-module extension that creates one
  actor per monitor in the real background group, reads frames via the
  seqlock protocol, and keeps a small GNOME extension preferences UI.

**Deliberately left rough for Phase 1** (see "Where this goes next"):
- The extension copies each frame through a `Uint8Array` -> new
  `Clutter.Image` on every update. That's fine at ~1080p30 but will not
  keep up with 4K60 -- there is no GPU-texture/DMABUF path yet (that's
  Phase 3 territory, see the design doc).
- Fullscreen/lock-screen pause hooks
  (`global.display::in-fullscreen-changed`, `Main.sessionMode`) use
  GNOME Shell internals that are **not** stable public API and do
  shift between GNOME versions. They're wrapped in `try/catch` so a
  mismatch disables just that feature rather than the whole extension
  -- but expect to need small fixes when GNOME updates.
- Only tested for correctness of compilation, not run inside an actual
  GNOME session (this environment has no display/compositor) -- treat
  it as a solid starting point to run and debug on your own machine,
  not a finished product.
- Looping is implemented by seeking back to the beginning on EOS. It is
  simple and may show a small gap on some codecs; a future release can
  wire `about-to-finish` for a more seamless loop.

## Building & installing

Requirements (Debian/Ubuntu package names):
```
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```
(the last three give you actual decoders -- H.264/VP8/VP9/AV1/etc;
`libgstreamer1.0-dev` alone only gets you the framework.)

Then:
```
./install.sh
```
See the script's own final printout for the remaining manual steps
(opening `livedesk`, enabling the systemd unit, enabling the extension).
Nothing auto-enables the extension for you -- GNOME requires an explicit
`gnome-extensions enable ...` and, on Wayland, a logout/login for a
newly-*installed* (not just newly-enabled) extension to load.

### What to run after building

After `./install.sh`, run these:

```
systemctl --user enable --now livedesk-daemon
gnome-extensions enable livedesk@me.tamkungz
livedesk
```

If you only ran `cargo build --release --locked` manually, the daemon
binary is:

```
daemon/target/release/livedesk-daemon
```

The GTK settings app is:

```
app/livedesk.js
```

### GNOME Shell versions

GNOME Shell 45+ changed extensions to ES modules, while GNOME 40-44 use
the legacy `imports.*` loader. Livedesk therefore builds two extension
zip variants from the same project:

- `dist/livedesk-extension-gnome45-49.zip`: GNOME 45, 46, 47, 48, 49
- `dist/livedesk-extension-gnome40-44.zip`: GNOME 40, 41, 42, 43, 44

Build both with:

```
scripts/build-extension-zip.sh all
```

For <https://extensions.gnome.org/upload/>, upload the zip matching the
target GNOME Shell series. The modern upload file is
`dist/livedesk-extension-gnome45-49.zip`; the legacy upload file is
`dist/livedesk-extension-gnome40-44.zip`. They use the same UUID, so
extensions.gnome.org may require submitting them as separate extension
versions after review rather than one combined zip.

The extension zips are only GNOME Shell extensions. They include the
extension preferences UI, but they do not install the standalone GTK app
or the native daemon. Use the `.deb`/`.rpm` packages or `./install.sh`
for a complete install with `livedesk` and `livedesk-daemon`.

### Debian and RPM packages

Build release packages with:

```
scripts/package-linux.sh
```

The output files are written to `dist/`, including `.deb`, `.rpm`, and
the two GNOME extension upload zips.

If Cargo fails with missing `gstreamer-1.0.pc`, `gstreamer-app-1.0.pc`,
or `gstreamer-video-1.0.pc`, the GStreamer runtime/plugins are installed
but the development headers are not. On Debian/Ubuntu, install:

```
sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
```

### Rust toolchain note

`daemon/Cargo.toml` pins `hashbrown`/`indexmap` to versions that build
on rustc 1.77. If you're on a newer toolchain (1.85+), feel free to
delete those two pinned lines -- newer transitive versions will resolve
fine and you'll pick up their improvements.

## Project identity

- Name: Livedesk - Live Wallpaper for GNOME
- Application/IPC namespace: `me.tamkungz.Livedesk`
- Author: TamKungZ_ <dev@tamkungz.me>
- License: GPL-3.0-or-later

## Where this goes next (from the design doc)

- **Phase 1 (this repo):** extension + daemon, shared-memory RGBA,
  CPU-side texture upload. Good enough to actually use day-to-day.
- **Phase 2:** promote the daemon to a proper packaged app (per-monitor
  settings persisted, hardware-decode selection, a real Settings-app
  integration) -- mostly polish on top of what's here.
- **Phase 3:** the "real" integration -- teach `Meta.BackgroundActor`
  (Mutter) about a video source directly, so frames go
  decoder -> DMABUF/GL texture -> compositor with no CPU copy at all,
  and it becomes an actual `org.gnome.desktop.background` media type
  instead of a shell extension. That's a much bigger, riskier change
  (you're patching the compositor every session depends on) -- worth
  attempting only once Phase 1/2 prove the UX is worth it.

## Repo layout

```
livedesk/
├── app/                     GTK4/Libadwaita settings app (`livedesk`)
├── data/
│   └── me.tamkungz.Livedesk.desktop
├── daemon/                  Rust + GStreamer decode daemon
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs          config loading, wiring
│       ├── pipeline.rs      GStreamer playbin -> appsink -> frame buffer
│       ├── frame.rs         shared-memory seqlock frame buffer
│       └── dbus_iface.rs    me.tamkungz.Livedesk D-Bus interface
├── shell-extension/
│   ├── metadata.json
│   ├── extension.js         background actor + frame polling + power hooks
│   ├── prefs.js             GTK4/Libadwaita settings UI
│   ├── stylesheet.css
│   └── schemas/*.gschema.xml
├── livedesk-daemon.service
├── shell-extension-legacy/  GNOME 40-44 legacy loader variant
├── scripts/                 extension zip and Linux package builders
├── config.example.json
└── install.sh
```
