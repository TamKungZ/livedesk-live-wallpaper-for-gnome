# Setup

This guide covers the current native setup path.

Livedesk makes GNOME's own background URI accept video files. When the app
applies a video, it writes the video URI to:

```text
org.gnome.desktop.background picture-uri
org.gnome.desktop.background picture-uri-dark
```

The GNOME Shell native overlay detects that the URI is a video and asks
`livedesk-daemon` to decode frames for the background actor.

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

Log out and back in once, then open:

```bash
livedesk
```

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

Log out and back in once, then open `livedesk`.

## Source Install

Install build dependencies first. On Debian/Ubuntu:

```bash
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libdbus-1-dev \
  libunwind-dev libglib2.0-bin \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav \
  totem
```

Then:

```bash
./install.sh
livedesk-setup
```

Log out and back in once, then open:

```bash
livedesk
```

## Use

Put videos in:

```text
~/Videos/Livedesk
```

Double-click a thumbnail, or click `Save and Apply`.

## Native Support Status

The native overlay currently targets GNOME Shell 40-44 and has been tested
against GNOME Shell 43.x. GNOME Shell 45+ uses a different internal JS module
layout and needs a separate native overlay patch before it can be treated as
supported on this path.

## Troubleshooting

Check native setup:

```bash
livedesk-setup --check-native
echo $?
```

Check the daemon:

```bash
systemctl --user status livedesk-daemon --no-pager
journalctl --user -u livedesk-daemon -n 80 --no-pager
```

Check the current GNOME background URI:

```bash
gsettings get org.gnome.desktop.background picture-uri
gsettings get org.gnome.desktop.background picture-uri-dark
```

Check GNOME Shell logs:

```bash
journalctl --user -b /usr/bin/gnome-shell -n 160 --no-pager | grep -i livedesk
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

The video library at `~/Videos/Livedesk` is kept by default. To remove it too,
pass `--purge-library`.
