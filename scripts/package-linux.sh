#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-0.1.0}"
ARCH_DEB="${ARCH_DEB:-amd64}"
ARCH_RPM="${ARCH_RPM:-x86_64}"
DIST_DIR="$ROOT_DIR/dist"
PKGROOT="$ROOT_DIR/target/package"
STAGE="$PKGROOT/livedesk-${VERSION}"

build_release() {
  (cd "$ROOT_DIR/daemon" && cargo build --release --locked)
}

install_tree() {
  rm -rf "$STAGE"
  mkdir -p \
    "$STAGE/usr/bin" \
    "$STAGE/usr/share/applications" \
    "$STAGE/usr/share/doc/livedesk" \
    "$STAGE/usr/share/gnome-shell/extensions/livedesk@me.tamkungz" \
    "$STAGE/usr/share/icons/hicolor/256x256/apps" \
    "$STAGE/usr/share/icons/hicolor/scalable/apps" \
    "$STAGE/usr/share/livedesk/extension-gnome40-44" \
    "$STAGE/usr/share/livedesk/extension-gnome45-51" \
    "$STAGE/usr/share/livedesk/extensions" \
    "$STAGE/usr/lib/systemd/user"

  install -m 755 "$ROOT_DIR/daemon/target/release/livedesk-daemon" "$STAGE/usr/bin/livedesk-daemon"
  install -m 755 "$ROOT_DIR/app/livedesk.js" "$STAGE/usr/bin/livedesk"
  install -m 644 "$ROOT_DIR/data/me.tamkungz.LivedeskApp.desktop" "$STAGE/usr/share/applications/me.tamkungz.LivedeskApp.desktop"
  install -m 644 "$ROOT_DIR/data/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png" "$STAGE/usr/share/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png"
  install -m 644 "$ROOT_DIR/data/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg" "$STAGE/usr/share/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg"
  install -m 644 "$ROOT_DIR/livedesk-daemon.service" "$STAGE/usr/lib/systemd/user/livedesk-daemon.service"
  install -m 644 "$ROOT_DIR/README.md" "$STAGE/usr/share/doc/livedesk/README.md"
  install -m 644 "$ROOT_DIR/LICENSE" "$STAGE/usr/share/doc/livedesk/LICENSE"

  cp -r "$ROOT_DIR/shell-extension-legacy/"* "$STAGE/usr/share/livedesk/extension-gnome40-44/"
  cp -r "$ROOT_DIR/shell-extension/"* "$STAGE/usr/share/livedesk/extension-gnome45-51/"
  glib-compile-schemas --strict "$STAGE/usr/share/livedesk/extension-gnome40-44/schemas"
  glib-compile-schemas --strict "$STAGE/usr/share/livedesk/extension-gnome45-51/schemas"

  cp -r "$ROOT_DIR/shell-extension/"* "$STAGE/usr/share/gnome-shell/extensions/livedesk@me.tamkungz/"
  glib-compile-schemas --strict "$STAGE/usr/share/gnome-shell/extensions/livedesk@me.tamkungz/schemas"
  cp "$DIST_DIR"/livedesk-extension-gnome*.zip "$STAGE/usr/share/livedesk/extensions/"
}

build_deb() {
  local deb_root="$PKGROOT/deb"
  local deb_path="$DIST_DIR/livedesk_${VERSION}_${ARCH_DEB}.deb"

  rm -rf "$deb_root"
  mkdir -p "$deb_root/DEBIAN"
  cp -a "$STAGE"/. "$deb_root/"

  cat > "$deb_root/DEBIAN/control" <<EOF
Package: livedesk
Version: $VERSION
Section: gnome
Priority: optional
Architecture: $ARCH_DEB
Maintainer: TamKungZ_ <dev@tamkungz.me>
Depends: gjs, gir1.2-gtk-4.0, gir1.2-adw-1, gnome-shell, libgstreamer1.0-0, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad, gstreamer1.0-libav, dbus-user-session
Recommends: totem | ffmpeg
Description: Live video wallpaper for GNOME
 Livedesk renders a looping video as the GNOME desktop background via
 a GNOME Shell extension and a native GStreamer daemon.
EOF

  cat > "$deb_root/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env sh
set -e

install_extension_variant() {
  major="$(gnome-shell --version 2>/dev/null | sed -n 's/.* \([0-9][0-9]*\).*/\1/p')"
  if [ -n "$major" ] && [ "$major" -ge 40 ] && [ "$major" -le 44 ]; then
    variant="/usr/share/livedesk/extension-gnome40-44"
  else
    variant="/usr/share/livedesk/extension-gnome45-51"
  fi

  rm -rf /usr/share/gnome-shell/extensions/livedesk@me.tamkungz
  mkdir -p /usr/share/gnome-shell/extensions/livedesk@me.tamkungz
  cp -a "$variant"/. /usr/share/gnome-shell/extensions/livedesk@me.tamkungz/
  glib-compile-schemas /usr/share/gnome-shell/extensions/livedesk@me.tamkungz/schemas
}

install_extension_variant

cat <<'MSG'

Livedesk was installed.

Complete setup for your user session:
  systemctl --user daemon-reload
  systemctl --user enable --now livedesk-daemon

If GNOME says "Extension does not exist", log out and back in first so
GNOME Shell can discover the newly installed system extension, then run:
  gnome-extensions enable livedesk@me.tamkungz

Open the main app with:
  livedesk

MSG

rm -f /usr/share/applications/me.tamkungz.Livedesk.desktop

exit 0
EOF
  chmod 755 "$deb_root/DEBIAN/postinst"

  dpkg-deb --build "$deb_root" "$deb_path"
  echo "Built deb: $deb_path"
}

build_rpm() {
  local rpmroot="$PKGROOT/rpmbuild"
  local tarball="$rpmroot/SOURCES/livedesk-${VERSION}.tar.gz"

  rm -rf "$rpmroot"
  mkdir -p "$rpmroot"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS,tmp}
  tar -C "$STAGE/.." -czf "$tarball" "livedesk-${VERSION}"

  cat > "$rpmroot/SPECS/livedesk.spec" <<EOF
Name: livedesk
Version: $VERSION
Release: 1%{?dist}
Summary: Live video wallpaper for GNOME
License: GPL-3.0-or-later
URL: https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome
Source0: livedesk-%{version}.tar.gz
Requires: gjs
Requires: gtk4
Requires: libadwaita
Requires: gnome-shell
Requires: gstreamer1
Recommends: totem

%description
Livedesk renders a looping video as the GNOME desktop background via a
GNOME Shell extension and a native GStreamer daemon.

%prep
%setup -q

%build

%install
mkdir -p %{buildroot}
cp -a . %{buildroot}/

%post
MAJOR="\$(gnome-shell --version 2>/dev/null | sed -n 's/.* \([0-9][0-9]*\).*/\1/p')"
if [ -n "\$MAJOR" ] && [ "\$MAJOR" -ge 40 ] && [ "\$MAJOR" -le 44 ]; then
  VARIANT="/usr/share/livedesk/extension-gnome40-44"
else
  VARIANT="/usr/share/livedesk/extension-gnome45-51"
fi
rm -rf /usr/share/gnome-shell/extensions/livedesk@me.tamkungz
mkdir -p /usr/share/gnome-shell/extensions/livedesk@me.tamkungz
cp -a "\$VARIANT"/. /usr/share/gnome-shell/extensions/livedesk@me.tamkungz/
glib-compile-schemas /usr/share/gnome-shell/extensions/livedesk@me.tamkungz/schemas || :
rm -f /usr/share/applications/me.tamkungz.Livedesk.desktop

%files
%license /usr/share/doc/livedesk/LICENSE
%doc /usr/share/doc/livedesk/README.md
/usr/bin/livedesk
/usr/bin/livedesk-daemon
/usr/share/applications/me.tamkungz.LivedeskApp.desktop
/usr/share/gnome-shell/extensions/livedesk@me.tamkungz
/usr/share/icons/hicolor/256x256/apps/me.tamkungz.Livedesk.png
/usr/share/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg
/usr/share/livedesk
/usr/lib/systemd/user/livedesk-daemon.service

%changelog
* Tue Jul 14 2026 TamKungZ_ <dev@tamkungz.me> - $VERSION-1
- Initial package
EOF

  rpmbuild \
    --define "_topdir $rpmroot" \
    --define "_tmppath $rpmroot/tmp" \
    -bb "$rpmroot/SPECS/livedesk.spec"
  cp "$rpmroot"/RPMS/*/*.rpm "$DIST_DIR/"
  echo "Built rpm packages in $DIST_DIR"
}

mkdir -p "$DIST_DIR"
"$ROOT_DIR/scripts/build-extension-zip.sh" all
build_release
install_tree
build_deb
build_rpm
