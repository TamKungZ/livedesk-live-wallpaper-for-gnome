#!/usr/bin/env bash
set -euo pipefail

EXT_UUID="livedesk@me.tamkungz"
APP_ID="me.tamkungz.Livedesk"
APP_DESKTOP="me.tamkungz.LivedeskApp.desktop"
OLD_DESKTOP="me.tamkungz.Livedesk.desktop"

PURGE=0
PURGE_LIBRARY=0
YES=0

usage() {
  cat <<'EOF'
Usage: livedesk-uninstall [options]

Remove Livedesk from the current user session and from system package/source
install paths.

Options:
  --purge          Also remove ~/.config/livedesk and ~/.cache/livedesk
  --purge-library  Also remove ~/Videos/Livedesk. This deletes imported videos.
  -y, --yes        Do not prompt before removing package/system files
  -h, --help       Show this help

The video library is kept unless --purge-library is passed.
EOF
}

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

ask_yes() {
  [ "$YES" -eq 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    warn "Need root privileges for: $*"
    warn "Run this script with sudo, or install sudo and try again."
    return 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge)
      PURGE=1
      ;;
    --purge-library)
      PURGE_LIBRARY=1
      ;;
    -y|--yes)
      YES=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      warn "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

disable_user_services() {
  if have gnome-extensions; then
    info "Disabling GNOME extension"
    gnome-extensions disable "$EXT_UUID" >/dev/null 2>&1 || true
  fi

  if have systemctl; then
    info "Stopping user daemon"
    systemctl --user disable --now livedesk-daemon.service >/dev/null 2>&1 || true
  fi
}

remove_user_install() {
  info "Removing user install files"
  rm -f "$HOME/.local/bin/livedesk"
  rm -f "$HOME/.local/bin/livedesk-daemon"
  rm -f "$HOME/.local/bin/livedesk-setup"
  rm -f "$HOME/.local/bin/livedesk-uninstall"
  rm -f "$HOME/.local/share/applications/$APP_DESKTOP"
  rm -f "$HOME/.local/share/applications/$OLD_DESKTOP"
  rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/$APP_ID.png"
  rm -f "$HOME/.local/share/icons/hicolor/scalable/apps/$APP_ID.svg"
  rm -f "$HOME/.config/systemd/user/livedesk-daemon.service"
  rm -rf "$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"

  if have systemctl; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi

  if have gtk-update-icon-cache; then
    gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
  fi
}

remove_system_package() {
  if have dpkg-query && dpkg-query -W -f='${Status}' livedesk 2>/dev/null | grep -q 'install ok installed'; then
    if ask_yes "Remove installed Debian package 'livedesk'?"; then
      info "Removing Debian package"
      run_root apt-get remove -y livedesk
    fi
    return
  fi

  if have rpm && rpm -q livedesk >/dev/null 2>&1; then
    if ask_yes "Remove installed RPM package 'livedesk'?"; then
      info "Removing RPM package"
      run_root rpm -e livedesk
    fi
    return
  fi

  if [ -e /usr/bin/livedesk ] || [ -e "/usr/share/gnome-shell/extensions/$EXT_UUID" ] || [ -e /usr/share/livedesk ]; then
    if ask_yes "Remove system files installed outside a package manager?"; then
      info "Removing system install files"
      run_root rm -f /usr/bin/livedesk
      run_root rm -f /usr/bin/livedesk-daemon
      run_root rm -f /usr/bin/livedesk-setup
      run_root rm -f /usr/bin/livedesk-uninstall
      run_root rm -f "/usr/share/applications/$APP_DESKTOP"
      run_root rm -f "/usr/share/applications/$OLD_DESKTOP"
      run_root rm -f "/usr/share/icons/hicolor/256x256/apps/$APP_ID.png"
      run_root rm -f "/usr/share/icons/hicolor/scalable/apps/$APP_ID.svg"
      run_root rm -f /usr/lib/systemd/user/livedesk-daemon.service
      run_root rm -rf "/usr/share/gnome-shell/extensions/$EXT_UUID"
      run_root rm -rf /usr/share/livedesk
      run_root rm -rf /usr/share/doc/livedesk
    fi
  fi
}

purge_user_data() {
  if [ "$PURGE" -eq 1 ]; then
    info "Removing config and cache"
    rm -rf "$HOME/.config/livedesk"
    rm -rf "$HOME/.cache/livedesk"
  fi

  if [ "$PURGE_LIBRARY" -eq 1 ]; then
    if ask_yes "Delete video library at $HOME/Videos/Livedesk?"; then
      info "Removing video library"
      rm -rf "$HOME/Videos/Livedesk"
    fi
  fi
}

disable_user_services
remove_user_install
remove_system_package
purge_user_data

cat <<EOF

Livedesk uninstall finished.

If GNOME Shell still shows the extension, log out and back in.
Your video library is kept at:
  $HOME/Videos/Livedesk

EOF
