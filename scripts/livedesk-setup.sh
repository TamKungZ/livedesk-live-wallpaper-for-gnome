#!/usr/bin/env bash
set -euo pipefail

EXT_UUID="livedesk@me.tamkungz"

info() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

info "Reloading user systemd units"
systemctl --user daemon-reload

info "Starting Livedesk daemon"
systemctl --user unmask livedesk-daemon.service >/dev/null 2>&1 || true
systemctl --user enable --now livedesk-daemon.service

if have gnome-extensions; then
  info "Checking GNOME extension"
  if gnome-extensions info "$EXT_UUID" >/dev/null 2>&1; then
    if gnome-extensions enable "$EXT_UUID" >/dev/null 2>&1; then
      info "Enabled $EXT_UUID"
    else
      warn "GNOME found $EXT_UUID but could not enable it."
      warn "Open Extensions, check the error state, then try again."
    fi
    gnome-extensions info "$EXT_UUID" || true
  else
    warn "GNOME Shell does not see $EXT_UUID yet."
    warn "Log out and back in, then run: gnome-extensions enable $EXT_UUID"
  fi
else
  warn "gnome-extensions command was not found."
fi

cat <<EOF

Next steps:
  1. Open Livedesk:
       livedesk
  2. Pick a video from ~/Videos/Livedesk or import one.
  3. Double-click a video, or click Save and Apply.

If the desktop is black:
  journalctl --user -u livedesk-daemon -n 80 --no-pager
  journalctl --user -b /usr/bin/gnome-shell -n 120 --no-pager | grep -i livedesk

EOF
