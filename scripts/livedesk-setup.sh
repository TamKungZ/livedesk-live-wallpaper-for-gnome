#!/usr/bin/env bash
set -euo pipefail

APP_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/livedesk"
NATIVE_DIR="$APP_DATA_DIR/gnome-shell-js"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"
ENV_FILE="$ENV_DIR/90-livedesk-gnome-shell.conf"

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

script_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

find_native_module() {
  local candidates=(
    "$APP_DATA_DIR/native/gnome-shell/livedeskBackground.js"
    "$(script_dir)/../native/gnome-shell/livedeskBackground.js"
    "/usr/share/livedesk/native/gnome-shell/livedeskBackground.js"
  )

  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

find_shell_library() {
  local candidates=(
    "/usr/lib/gnome-shell/libgnome-shell.so"
    "/usr/lib64/gnome-shell/libgnome-shell.so"
  )

  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

extract_resource() {
  local shell_lib="$1"
  local resource="$2"
  local out="$3"

  if gresource extract "$shell_lib" "$resource" > "$out"; then
    return 0
  fi

  return 1
}

extract_shell_js_tree() {
  local shell_lib="$1"
  local resource rel out

  while IFS= read -r resource; do
    rel="${resource#/org/gnome/shell/}"
    out="$NATIVE_DIR/$rel"
    mkdir -p "$(dirname "$out")"
    extract_resource "$shell_lib" "$resource" "$out"
  done < <(gresource list "$shell_lib" | grep '^/org/gnome/shell/.*\.js$')

  [ -f "$NATIVE_DIR/ui/environment.js" ] || {
    warn "Failed to extract GNOME Shell ui/environment.js."
    return 1
  }
  [ -f "$NATIVE_DIR/ui/background.js" ] || {
    warn "Failed to extract GNOME Shell ui/background.js."
    return 1
  }
}

patch_background_js() {
  local file="$1"

  grep -q "const Params = imports.misc.params;" "$file" || {
    warn "GNOME Shell background.js does not match the supported imports.* layout."
    warn "This native overlay currently targets GNOME Shell 40-44, tested on 43.x."
    return 1
  }

  grep -q "let changeSignalId = background.connect('bg-changed'" "$file" || {
    warn "Could not find BackgroundManager._createBackgroundActor patch point."
    return 1
  }

  if ! grep -q "imports.ui.livedeskBackground" "$file"; then
    sed -i "/const Params = imports.misc.params;/a const LivedeskBackground = imports.ui.livedeskBackground;" "$file"
  fi

  sed -i "/LivedeskBackground.attachToBackgroundManager(this, backgroundActor);/d" "$file"
  sed -i "/let changeSignalId = background.connect('bg-changed'/i\\        LivedeskBackground.attachToBackgroundManager(this, backgroundActor);" "$file"
}

install_native_shell_overlay() {
  local native_module shell_lib

  native_module="$(find_native_module)" || {
    warn "Could not find livedeskBackground.js."
    warn "Install from the project root or package native/gnome-shell with Livedesk."
    return 1
  }

  shell_lib="$(find_shell_library)" || {
    warn "Could not find GNOME Shell's libgnome-shell.so."
    return 1
  }

  have gresource || {
    warn "gresource was not found. Install libglib2.0-bin or your distro's GLib tools package."
    return 1
  }

  info "Installing GNOME Shell native background overlay"
  rm -rf "$NATIVE_DIR"
  mkdir -p "$NATIVE_DIR"

  extract_shell_js_tree "$shell_lib"
  cp "$native_module" "$NATIVE_DIR/ui/livedeskBackground.js"
  patch_background_js "$NATIVE_DIR/ui/background.js"

  mkdir -p "$ENV_DIR"
  cat > "$ENV_FILE" <<EOF
GNOME_SHELL_JS=$NATIVE_DIR
EOF

  if have systemctl; then
    export GNOME_SHELL_JS="$NATIVE_DIR"
    systemctl --user import-environment GNOME_SHELL_JS >/dev/null 2>&1 || true
  fi
}

check_native() {
  [ -f "$NATIVE_DIR/ui/background.js" ] || return 1
  [ -f "$NATIVE_DIR/ui/environment.js" ] || return 1
  [ -f "$NATIVE_DIR/misc/config.js" ] || return 1
  [ -f "$NATIVE_DIR/ui/livedeskBackground.js" ] || return 1
  grep -q "LivedeskBackground.attachToBackgroundManager" "$NATIVE_DIR/ui/background.js" || return 1
  [ -f "$ENV_FILE" ] || return 1
  grep -q "^GNOME_SHELL_JS=$NATIVE_DIR$" "$ENV_FILE" || return 1
}

start_daemon() {
  if have systemctl; then
    info "Reloading user systemd units"
    systemctl --user daemon-reload

    info "Starting Livedesk daemon"
    systemctl --user enable --now livedesk-daemon.service
  else
    warn "systemctl was not found; start livedesk-daemon manually."
  fi
}

print_recovery_notice() {
  cat <<EOF

Important recovery note:

Native setup changes how GNOME Shell loads JavaScript on the next login.
Before logging out, keep these commands available. If GNOME shows
"Oh no! Something has gone wrong.", press Ctrl+Alt+F3, log in, and run:

  rm -f ~/.config/environment.d/90-livedesk-gnome-shell.conf
  rm -rf ~/.local/share/livedesk/gnome-shell-js
  sudo systemctl restart gdm

If your distro does not use GDM, run:

  sudo reboot

EOF
}

case "${1:-}" in
  --check-native)
    check_native
    exit $?
    ;;
  --install-native-only)
    install_native_shell_overlay
    exit 0
    ;;
  -h|--help)
    cat <<'EOF'
Usage: livedesk-setup [--check-native] [--install-native-only]

Installs the user-session native GNOME Shell JS overlay for Livedesk and starts
the user daemon. Log out and back in once after setup so GNOME Shell starts with
GNOME_SHELL_JS pointing at the overlay.
EOF
    exit 0
    ;;
esac

install_native_shell_overlay
start_daemon

cat <<EOF

Livedesk native setup finished.

Log out and back in once. After that, GNOME Shell will load:
  $NATIVE_DIR

Pick a video in Livedesk. The app will write that video URI to:
  org.gnome.desktop.background picture-uri

EOF

print_recovery_notice
