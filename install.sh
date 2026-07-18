#!/usr/bin/env bash
# Installs Livedesk:
#   1. builds livedesk-daemon (release) and copies it to ~/.local/bin
#   2. installs the Livedesk GTK app into ~/.local/bin and applications
#   3. installs the GNOME Shell native background patch helper files
#   4. installs and compiles the Livedesk GSettings schema
#   5. installs a systemd --user unit for the daemon
#
# Opening `livedesk` after install will try to start the user service. Run
# `livedesk-setup` once, then log out and back in so GNOME Shell starts with
# the native background overlay.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DEST="$HOME/.local/bin"
APP_DEST="$HOME/.local/share/applications"
SYSTEMD_DEST="$HOME/.config/systemd/user"
DATA_DEST="$HOME/.local/share/livedesk"
SCHEMA_DEST="$HOME/.local/share/glib-2.0/schemas"

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
install -m 755 "$SCRIPT_DIR/scripts/livedesk-setup.sh" "$BIN_DEST/livedesk-setup"
install -m 755 "$SCRIPT_DIR/scripts/livedesk-uninstall.sh" "$BIN_DEST/livedesk-uninstall"
mkdir -p "$APP_DEST"
install -m 644 "$SCRIPT_DIR/data/me.tamkungz.LivedeskApp.desktop" "$APP_DEST/me.tamkungz.LivedeskApp.desktop"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.local/share/icons/hicolor/scalable/apps"
install -m 644 "$SCRIPT_DIR/data/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png" "$HOME/.local/share/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png"
install -m 644 "$SCRIPT_DIR/data/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg"
rm -f "$APP_DEST/me.tamkungz.Livedesk.desktop"

echo "==> Installing native GNOME Shell integration files"
mkdir -p "$DATA_DEST/native/gnome-shell"
install -m 644 "$SCRIPT_DIR/native/gnome-shell/livedeskBackground.js" "$DATA_DEST/native/gnome-shell/livedeskBackground.js"
install -m 644 "$SCRIPT_DIR/native/gnome-shell/README.md" "$DATA_DEST/native/gnome-shell/README.md"

echo "==> Installing and compiling GSettings schema"
mkdir -p "$SCHEMA_DEST"
install -m 644 "$SCRIPT_DIR/data/schemas/me.tamkungz.Livedesk.gschema.xml" "$SCHEMA_DEST/me.tamkungz.Livedesk.gschema.xml"
glib-compile-schemas "$SCHEMA_DEST"

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

Done. Remaining steps:

  1. Install the native GNOME Shell background overlay:
       livedesk-setup

  2. Log out and back in once so GNOME Shell starts with the overlay.

  3. Open Livedesk:
       livedesk

  4. Pick a video. Livedesk writes the video URI to GNOME's own
     org.gnome.desktop.background picture-uri setting.
EOF
