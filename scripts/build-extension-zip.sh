#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
UUID="livedesk@me.tamkungz"

build_zip() {
  local variant="$1"
  local source_dir="$2"
  local out_name="$3"
  local work_dir

  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' RETURN

  mkdir -p "$work_dir/$UUID"
  cp -r "$source_dir/"* "$work_dir/$UUID/"

  glib-compile-schemas --strict "$work_dir/$UUID/schemas"

  mkdir -p "$DIST_DIR"
  (
    cd "$work_dir/$UUID"
    zip -qr "$DIST_DIR/$out_name" .
  )

  echo "Built $variant extension: $DIST_DIR/$out_name"
  rm -rf "$work_dir"
  trap - RETURN
}

mode="${1:-all}"

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/livedesk-extension-gnome*.zip

case "$mode" in
  modern|45-50|45-49)
    build_zip "GNOME 45-50" "$ROOT_DIR/shell-extension" "livedesk-extension-gnome45-50.zip"
    ;;
  legacy|40-44)
    build_zip "GNOME 40-44" "$ROOT_DIR/shell-extension-legacy" "livedesk-extension-gnome40-44.zip"
    ;;
  all)
    build_zip "GNOME 45-50" "$ROOT_DIR/shell-extension" "livedesk-extension-gnome45-50.zip"
    build_zip "GNOME 40-44" "$ROOT_DIR/shell-extension-legacy" "livedesk-extension-gnome40-44.zip"
    ;;
  *)
    echo "Usage: $0 [all|modern|legacy|45-50|45-49|40-44]" >&2
    exit 2
    ;;
esac
