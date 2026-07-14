# Setup

This guide covers the easiest way to install and enable Livedesk.

## Recommended Install

On Debian/Ubuntu, install from the TamKungZ_ APT repository:

```bash
curl -fsSL https://packages.tamkungz.me/gpg.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/tamkungz-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/tamkungz-archive-keyring.gpg] https://packages.tamkungz.me/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/tamkungz.list
sudo apt update
sudo apt install livedesk
livedesk-setup
```

Or install a local Debian package from `dist/` or from a GitHub release:

```bash
sudo dpkg -i dist/livedesk_0.1.0_amd64.deb
livedesk-setup
```

Then log out and back in if GNOME Shell does not see the extension yet.

Open the app:

```bash
livedesk
```

Put videos in:

```text
~/Videos/Livedesk
```

Double-click a thumbnail, or click `Save and Apply`.

## RPM Install

On Fedora/RHEL-like distributions:

```bash
sudo rpm --import https://packages.tamkungz.me/gpg.key
sudo tee /etc/yum.repos.d/tamkungz.repo >/dev/null <<'EOF'
[tamkungz]
name=TamKungZ_ Packages
baseurl=https://packages.tamkungz.me/rpm/x86_64
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://packages.tamkungz.me/gpg.key
EOF
sudo dnf install livedesk
livedesk-setup
```

Or install a local RPM:

```bash
sudo rpm -Uvh dist/livedesk-0.1.0-1.x86_64.rpm
livedesk-setup
```

## Source Install

Install build dependencies first. On Debian/Ubuntu:

```bash
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev \
  libunwind-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav \
  totem
```

Then:

```bash
./install.sh
livedesk-setup
```

## Extension Zip Only

The GNOME Extensions zip installs only the Shell extension. It does not
include the native daemon or GTK app.

Use the zip only for `extensions.gnome.org` upload/testing. End users
should install the `.deb`, `.rpm`, or source package.

## GNOME Versions

Livedesk ships two extension variants:

- GNOME 40-44: legacy extension
- GNOME 45-51: modern ES module extension

The `.deb` and `.rpm` packages install both variants and choose the
active one during post-install from `gnome-shell --version`.

## Troubleshooting

Check the extension state:

```bash
gnome-extensions info livedesk@me.tamkungz
```

If the state is `OUT OF DATE`, check the installed metadata:

```bash
gnome-shell --version
cat /usr/share/gnome-shell/extensions/livedesk@me.tamkungz/metadata.json
```

On GNOME 43, metadata must include `43`. On GNOME 45 or newer, metadata
must include that major version.

Check the daemon:

```bash
systemctl --user status livedesk-daemon --no-pager
journalctl --user -u livedesk-daemon -n 80 --no-pager
```

If the wallpaper is black, make sure the daemon received a video source:

```text
[monitor-0] source set to file:///...
```

Check GNOME Shell extension logs:

```bash
journalctl --user -b /usr/bin/gnome-shell -n 120 --no-pager | grep -i livedesk
```

## Uninstall

For a clean uninstall:

```bash
livedesk-uninstall
```

To also remove settings and thumbnail cache:

```bash
livedesk-uninstall --purge
```

The video library at `~/Videos/Livedesk` is kept by default. To remove it
too, pass `--purge-library`.
