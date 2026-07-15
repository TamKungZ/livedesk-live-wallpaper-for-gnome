#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-0.1.2}"
SERIES="${SERIES:-jammy}"
DEB_REVISION="${DEB_REVISION:-1~${SERIES}1}"
WORK_DIR="$ROOT_DIR/target/launchpad-source"
SRC_DIR="$WORK_DIR/livedesk-$VERSION"
OUT_DIR="$ROOT_DIR/dist/launchpad/$SERIES"

if [ ! -d "$ROOT_DIR/daemon/vendor" ]; then
  cat >&2 <<'EOF'
Missing daemon/vendor.

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

(cd "$SRC_DIR" && debuild -S -sa -us -uc -d)

cp "$WORK_DIR"/livedesk_"$VERSION".orig.tar.gz "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION".debian.tar.xz "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION".dsc "$OUT_DIR"/
cp "$WORK_DIR"/livedesk_"$VERSION"-"$DEB_REVISION"_source.changes "$OUT_DIR"/

cat <<EOF
Launchpad source package written to:
  $OUT_DIR

Upload with:
  dput ppa:<launchpad-user>/<ppa-name> $OUT_DIR/livedesk_${VERSION}-${DEB_REVISION}_source.changes
EOF
