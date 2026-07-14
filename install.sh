#!/usr/bin/env bash
# Installs the Phase 1 prototype:
#   1. builds livedesk-daemon (release) and copies it to ~/.local/bin
#   2. installs the GNOME Shell extension into ~/.local/share/gnome-shell/extensions
#   3. compiles its GSettings schema
#   4. installs (but does not enable) a systemd --user unit for the daemon
#
# It does NOT enable the shell extension automatically -- do that with
# `gnome-extensions enable livedesk@me.tamkungz` and then log out/in
# (Wayland requires a full session restart to load a new extension).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_UUID="livedesk@me.tamkungz"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
BIN_DEST="$HOME/.local/bin"
SYSTEMD_DEST="$HOME/.config/systemd/user"

echo "==> Checking build dependencies (rustc/cargo, pkg-config, GStreamer dev headers)"
for cmd in cargo rustc pkg-config; do
  command -v "$cmd" >/dev/null || {
    echo "Missing '$cmd'. On Debian/Ubuntu:"
    echo "  sudo apt install cargo rustc pkg-config libgstreamer1.0-dev \\"
    echo "    libgstreamer-plugins-base1.0-dev libdbus-1-dev"
    exit 1
  }
done

echo "==> Building livedesk-daemon (release)"
(cd "$SCRIPT_DIR/daemon" && cargo build --release)

echo "==> Installing daemon binary to $BIN_DEST"
mkdir -p "$BIN_DEST"
install -m 755 "$SCRIPT_DIR/daemon/target/release/livedesk-daemon" "$BIN_DEST/livedesk-daemon"

echo "==> Installing GNOME Shell extension to $EXT_DEST"
mkdir -p "$EXT_DEST"
cp -r "$SCRIPT_DIR/shell-extension/"* "$EXT_DEST/"

echo "==> Compiling GSettings schema"
glib-compile-schemas "$EXT_DEST/schemas"

echo "==> Installing systemd --user unit (not enabled yet)"
mkdir -p "$SYSTEMD_DEST"
cp "$SCRIPT_DIR/livedesk-daemon.service" "$SYSTEMD_DEST/livedesk-daemon.service"
systemctl --user daemon-reload

echo "==> Setting up example config (edit the video path!)"
CONFIG_DEST="$HOME/.config/livedesk"
mkdir -p "$CONFIG_DEST"
if [ ! -f "$CONFIG_DEST/config.json" ]; then
  cp "$SCRIPT_DIR/config.example.json" "$CONFIG_DEST/config.json"
  echo "    Wrote $CONFIG_DEST/config.json -- edit the 'uri' field before starting the daemon."
fi

cat <<'EOF'

Done. Remaining manual steps:

  1. Edit ~/.config/livedesk/config.json to point at your video
     (and match "width"/"height" to your monitor's real resolution).

  2. Start the daemon now, and enable it for future logins:
       systemctl --user enable --now livedesk-daemon

  3. Enable the shell extension:
       gnome-extensions enable livedesk@me.tamkungz
     On Wayland you'll need to log out and back in for a newly-installed
     extension to be picked up; on X11, Alt+F2 -> 'r' -> Enter reloads
     GNOME Shell instead.

  4. Open Extension preferences (via the Extensions app, or
     `gnome-extensions prefs livedesk@me.tamkungz`) if you'd rather
     pick the video and settings from a GUI than editing config.json.

This is a Phase 1 prototype (see README.md) -- expect rough edges,
especially around GNOME-version-specific internal APIs used for
fullscreen/lock-screen detection.
EOF
