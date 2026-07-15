#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command '$1'"
}

need_cmd dpkg-parsechangelog
need_cmd awk

CHANGELOG="$ROOT_DIR/debian/changelog"
CHANGELOG_SERIES="$(dpkg-parsechangelog -l "$CHANGELOG" -S Distribution)"
SERIES="${SERIES:-$CHANGELOG_SERIES}"
CHANGELOG_VERSION="$(
  awk -v series="$SERIES" '
    /^livedesk \(/ {
      version = $2
      distribution = $3
      gsub(/^\(|\)$/, "", version)
      sub(/;$/, "", distribution)
      if (distribution == series) {
        print version
        exit
      }
    }
  ' "$CHANGELOG"
)"
[ -n "$CHANGELOG_VERSION" ] || fail "debian/changelog has no livedesk entry for series '$SERIES'"
UPSTREAM_VERSION="${CHANGELOG_VERSION%%-*}"
CHANGELOG_DEB_REVISION="${CHANGELOG_VERSION#*-}"
VERSION="${VERSION:-$UPSTREAM_VERSION}"
DEB_REVISION="${DEB_REVISION:-$CHANGELOG_DEB_REVISION}"
ORIG_SERIES="${ORIG_SERIES:-jammy}"
ORIG_TARBALL_NAME="livedesk_${VERSION}.orig.tar.gz"
PUBLISHED_ORIG_TARBALL="${PUBLISHED_ORIG_TARBALL:-$ROOT_DIR/dist/launchpad/$ORIG_TARBALL_NAME}"
SERIES_ORIG_TARBALL="${SERIES_ORIG_TARBALL:-$ROOT_DIR/dist/launchpad/$ORIG_SERIES/$ORIG_TARBALL_NAME}"
INCLUDE_ORIG="${INCLUDE_ORIG:-auto}"
if [ "$INCLUDE_ORIG" = "auto" ]; then
  if [ "$SERIES" = "$ORIG_SERIES" ]; then
    INCLUDE_ORIG=1
  else
    INCLUDE_ORIG=0
  fi
fi
[ "$INCLUDE_ORIG" = "0" ] || [ "$INCLUDE_ORIG" = "1" ] || fail "INCLUDE_ORIG must be 0, 1, or auto"
WORK_DIR="$ROOT_DIR/target/launchpad-source"
SRC_DIR="$WORK_DIR/livedesk-$VERSION"
OUT_DIR="$ROOT_DIR/dist/launchpad/$SERIES"
CHANGES_FILE="$OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}_source.changes"
if [ "$INCLUDE_ORIG" = "0" ]; then
  ORIG_TARBALL="${ORIG_TARBALL:-$PUBLISHED_ORIG_TARBALL}"
  if [ ! -f "$ORIG_TARBALL" ]; then
    ORIG_TARBALL="$SERIES_ORIG_TARBALL"
  fi
else
  ORIG_TARBALL="${ORIG_TARBALL:-$PUBLISHED_ORIG_TARBALL}"
  if [ ! -f "$ORIG_TARBALL" ]; then
    ORIG_TARBALL="$SERIES_ORIG_TARBALL"
  fi
fi
WORK_ORIG_TARBALL="$WORK_DIR/$ORIG_TARBALL_NAME"
SOURCE_FLAGS=(-S -d)
if [ "$INCLUDE_ORIG" = "1" ]; then
  SOURCE_FLAGS+=(-sa)
else
  SOURCE_FLAGS+=(-sd)
fi
SIGN_FLAGS=()
if [ "${UNSIGNED:-0}" = "1" ]; then
  SIGN_FLAGS=(-us -uc)
fi

verify_upload_files() {
  local stem="$OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}"
  local missing=0
  local files=(
    "$stem.debian.tar.xz"
    "$stem.dsc"
    "${stem}_source.buildinfo"
    "${stem}_source.changes"
  )
  if [ "$INCLUDE_ORIG" = "1" ]; then
    files=("$OUT_DIR/$ORIG_TARBALL_NAME" "${files[@]}")
  fi
  for file in "${files[@]}"; do
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

need_cmd debuild
need_cmd tar
need_cmd sed
need_cmd sha256sum
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
mkdir -p "$WORK_DIR" "$OUT_DIR"

if [ -f "$ORIG_TARBALL" ]; then
  cp "$ORIG_TARBALL" "$WORK_ORIG_TARBALL"
  tar -C "$WORK_DIR" -xzf "$WORK_ORIG_TARBALL"
  [ -d "$SRC_DIR" ] || fail "$ORIG_TARBALL does not extract to livedesk-$VERSION"
  rm -rf "$SRC_DIR/debian"
  cp -a "$ROOT_DIR/debian" "$SRC_DIR/debian"
elif [ "$INCLUDE_ORIG" = "1" ]; then
  mkdir -p "$SRC_DIR"
  tar -C "$ROOT_DIR" \
    --exclude=.git \
    --exclude=dist \
    --exclude=target \
    --exclude=daemon/target \
    --exclude='*.deb' \
    --exclude='*.rpm' \
    -cf - . | tar -C "$SRC_DIR" -xf -
else
  fail "missing upstream orig tarball for $SERIES: $ORIG_TARBALL

Build/upload $ORIG_SERIES first, or set ORIG_TARBALL=/path/to/$ORIG_TARBALL_NAME."
fi

sed -i "1s|^livedesk (.*) .*; urgency=medium$|livedesk (${VERSION}-${DEB_REVISION}) ${SERIES}; urgency=medium|" \
  "$SRC_DIR/debian/changelog"

if [ "$INCLUDE_ORIG" = "1" ]; then
  if [ ! -f "$WORK_ORIG_TARBALL" ]; then
    tar -C "$WORK_DIR" \
      --exclude="livedesk-$VERSION/debian" \
      -czf "$WORK_ORIG_TARBALL" \
      "livedesk-$VERSION"
  fi
else
  :
fi

printf 'Launchpad source build:\n'
printf '  series: %s\n' "$SERIES"
printf '  version: %s-%s\n' "$VERSION" "$DEB_REVISION"
printf '  include orig: %s\n' "$INCLUDE_ORIG"
printf '  orig tarball: %s\n' "$ORIG_TARBALL"
printf '  orig sha256: %s\n' "$(sha256sum "$WORK_ORIG_TARBALL" | awk '{print $1}')"

(cd "$SRC_DIR" && debuild "${SOURCE_FLAGS[@]}" "${SIGN_FLAGS[@]}")

if [ "$INCLUDE_ORIG" = "1" ]; then
  cp "$WORK_ORIG_TARBALL" "$OUT_DIR"/
  if [ -f "$PUBLISHED_ORIG_TARBALL" ]; then
    existing_sha="$(sha256sum "$PUBLISHED_ORIG_TARBALL" | awk '{print $1}')"
    built_sha="$(sha256sum "$WORK_ORIG_TARBALL" | awk '{print $1}')"
    [ "$existing_sha" = "$built_sha" ] || fail "refusing to overwrite $PUBLISHED_ORIG_TARBALL with a different orig tarball

existing sha256: $existing_sha
built sha256:    $built_sha"
  else
    cp "$WORK_ORIG_TARBALL" "$PUBLISHED_ORIG_TARBALL"
  fi
else
  rm -f "$OUT_DIR/$ORIG_TARBALL_NAME"
fi
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
