#!/usr/bin/env bash
# Installs the Phase 1 prototype:
#   1. builds livedesk-daemon (release) and copies it to ~/.local/bin
#   2. installs the Livedesk GTK app into ~/.local/bin and applications
#   3. installs the GNOME Shell extension into ~/.local/share/gnome-shell/extensions
#   4. compiles its GSettings schema
#   5. installs (but does not enable) a systemd --user unit for the daemon
#
# It does NOT enable the shell extension automatically -- do that with
# `gnome-extensions enable livedesk@me.tamkungz` and then log out/in
# (Wayland requires a full session restart to load a new extension).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_UUID="livedesk@me.tamkungz"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
BIN_DEST="$HOME/.local/bin"
APP_DEST="$HOME/.local/share/applications"
SYSTEMD_DEST="$HOME/.config/systemd/user"

detect_extension_source() {
  local version major

  if ! command -v gnome-shell >/dev/null; then
    echo "$SCRIPT_DIR/shell-extension"
    return
  fi

  version="$(gnome-shell --version | awk '{ print $NF }')"
  major="${version%%.*}"

  if [ "$major" -ge 40 ] && [ "$major" -le 44 ]; then
    echo "$SCRIPT_DIR/shell-extension-legacy"
  else
    echo "$SCRIPT_DIR/shell-extension"
  fi
}

echo "==> Checking build dependencies (rustc/cargo, pkg-config, GStreamer dev headers, GJS)"
for cmd in cargo rustc pkg-config gjs; do
  command -v "$cmd" >/dev/null || {
    echo "Missing '$cmd'. On Debian/Ubuntu:"
    echo "  sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \\"
    echo "    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev"
    exit 1
  }
done

echo "==> Building livedesk-daemon (release)"
(cd "$SCRIPT_DIR/daemon" && cargo build --release)

echo "==> Installing daemon binary to $BIN_DEST"
mkdir -p "$BIN_DEST"
install -m 755 "$SCRIPT_DIR/daemon/target/release/livedesk-daemon" "$BIN_DEST/livedesk-daemon"

echo "==> Installing Livedesk app to $BIN_DEST"
install -m 755 "$SCRIPT_DIR/app/livedesk.js" "$BIN_DEST/livedesk"
mkdir -p "$APP_DEST"
install -m 644 "$SCRIPT_DIR/data/me.tamkungz.Livedesk.desktop" "$APP_DEST/me.tamkungz.Livedesk.desktop"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.local/share/icons/hicolor/scalable/apps"
install -m 644 "$SCRIPT_DIR/data/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png" "$HOME/.local/share/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png"
install -m 644 "$SCRIPT_DIR/data/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg"

echo "==> Installing GNOME Shell extension to $EXT_DEST"
EXT_SOURCE="$(detect_extension_source)"
mkdir -p "$EXT_DEST"
cp -r "$EXT_SOURCE/"* "$EXT_DEST/"
echo "    Installed extension variant from $EXT_SOURCE"

echo "==> Compiling GSettings schema"
glib-compile-schemas "$EXT_DEST/schemas"

echo "==> Installing systemd --user unit (not enabled yet)"
mkdir -p "$SYSTEMD_DEST"
sed "s|^ExecStart=.*|ExecStart=$BIN_DEST/livedesk-daemon|" \
  "$SCRIPT_DIR/livedesk-daemon.service" > "$SYSTEMD_DEST/livedesk-daemon.service"
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

  1. Open the Livedesk app:
       livedesk
     Pick your video and apply it to the daemon.

  2. Start the daemon now, and enable it for future logins:
       systemctl --user enable --now livedesk-daemon

  3. Enable the shell extension:
       gnome-extensions enable livedesk@me.tamkungz
     On Wayland you'll need to log out and back in for a newly-installed
     extension to be picked up; on X11, Alt+F2 -> 'r' -> Enter reloads
     GNOME Shell instead.

  4. The extension preferences remain available through GNOME's
     Extensions app, but the standalone Livedesk app is the primary UI.

This is a Phase 1 prototype (see README.md) -- expect rough edges,
especially around GNOME-version-specific internal APIs used for
fullscreen/lock-screen detection.
EOF
