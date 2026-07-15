#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG_VERSION="$(dpkg-parsechangelog -l "$ROOT_DIR/debian/changelog" -S Version)"
UPSTREAM_VERSION="${CHANGELOG_VERSION%%-*}"
VERSION="${VERSION:-$UPSTREAM_VERSION}"
SERIES="${SERIES:-jammy}"
DEB_REVISION="${DEB_REVISION:-1~${SERIES}1}"
WORK_DIR="$ROOT_DIR/target/launchpad-source"
SRC_DIR="$WORK_DIR/livedesk-$VERSION"
OUT_DIR="$ROOT_DIR/dist/launchpad/$SERIES"
CHANGES_FILE="$OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}_source.changes"
SIGN_FLAGS=()
if [ "${UNSIGNED:-0}" = "1" ]; then
  SIGN_FLAGS=(-us -uc)
fi

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command '$1'"
}

verify_upload_files() {
  local stem="$OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}"
  local missing=0
  for file in \
    "$OUT_DIR/livedesk_${VERSION}.orig.tar.gz" \
    "$stem.debian.tar.xz" \
    "$stem.dsc" \
    "${stem}_source.buildinfo" \
    "${stem}_source.changes"; do
    if [ ! -f "$file" ]; then
      printf 'missing: %s\n' "$file" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || fail "source package output is incomplete"
}

verify_signatures() {
  if [ "${UNSIGNED:-0}" = "1" ]; then
    fail "UPLOAD=1 cannot be used with UNSIGNED=1 because Launchpad requires signed .changes and .dsc files"
  fi
  gpg --verify "$CHANGES_FILE" >/dev/null 2>&1 || fail "invalid or missing signature on $CHANGES_FILE"
  local dsc="$OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}.dsc"
  gpg --verify "$dsc" >/dev/null 2>&1 || fail "invalid or missing signature on $dsc"
}

upload_package() {
  local target="${PPA:-}"
  [ -n "$target" ] || fail "UPLOAD=1 requires PPA=ppa:<launchpad-user>/<ppa-name>"
  need_cmd dput
  verify_upload_files
  verify_signatures
  dput "$target" "$CHANGES_FILE" || fail "dput upload failed for $CHANGES_FILE"
}

need_cmd dpkg-parsechangelog
need_cmd debuild
need_cmd tar
need_cmd sed
if [ "${UPLOAD:-0}" = "1" ]; then
  [ -n "${PPA:-}" ] || fail "UPLOAD=1 requires PPA=ppa:<launchpad-user>/<ppa-name>"
  [ "${UNSIGNED:-0}" != "1" ] || fail "UPLOAD=1 cannot be used with UNSIGNED=1 because Launchpad requires signed .changes and .dsc files"
  need_cmd dput
  need_cmd gpg
fi

if [ ! -d "$ROOT_DIR/daemon/vendor" ]; then
  cat >&2 <<'EOF'
error: missing daemon/vendor

Create vendored Rust dependencies before building the Launchpad source package:
  cd daemon
  cargo vendor --locked vendor
  cd ..
EOF
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$SRC_DIR" "$OUT_DIR"

tar -C "$ROOT_DIR" \
  --exclude=.git \
  --exclude=dist \
  --exclude=target \
  --exclude=daemon/target \
  --exclude='*.deb' \
  --exclude='*.rpm' \
  -cf - . | tar -C "$SRC_DIR" -xf -

sed -i "1s|^livedesk (.*) .*; urgency=medium$|livedesk (${VERSION}-${DEB_REVISION}) ${SERIES}; urgency=medium|" \
  "$SRC_DIR/debian/changelog"

tar -C "$WORK_DIR" \
  --exclude="livedesk-$VERSION/debian" \
  -czf "$WORK_DIR/livedesk_${VERSION}.orig.tar.gz" \
  "livedesk-$VERSION"

(cd "$SRC_DIR" && debuild -S -sa -d "${SIGN_FLAGS[@]}")

cp "$WORK_DIR"/livedesk_"$VERSION".orig.tar.gz "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION".debian.tar.xz "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION".dsc "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION"_source.buildinfo "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION"_source.changes "$OUT_DIR"/

cat <<EOF
Launchpad source package written to:
  $OUT_DIR

Upload with:
  dput ppa:<launchpad-user>/<ppa-name> $CHANGES_FILE
EOF

if [ "${UPLOAD:-0}" = "1" ]; then
  upload_package
fi
