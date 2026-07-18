# Setup

This guide covers the current native setup path.

Livedesk makes GNOME's background renderer play video while keeping GNOME's
normal background URI usable by apps that need an image. When the app applies a
video, it writes a first-frame PNG to:

```text
org.gnome.desktop.background picture-uri
org.gnome.desktop.background picture-uri-dark
```

The video URI is written to `me.tamkungz.Livedesk video-uri`. The GNOME Shell
native overlay detects the matching still image, reads that video URI, and asks
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

Before logging out, read [Emergency Recovery](#emergency-recovery). Native setup
changes how GNOME Shell loads JavaScript on the next login.

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

Before logging out, read [Emergency Recovery](#emergency-recovery).

## Source Install

Install build dependencies first. On Debian/Ubuntu:

```bash
sudo apt install cargo rustc pkg-config gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1 \
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

Before logging out, read [Emergency Recovery](#emergency-recovery).

## Use

Put videos in:

```text
~/Videos/Livedesk
```

Double-click a thumbnail, or click `Save and Apply`.

If you launch `livedesk` from a terminal, the app prints detailed logs for each
button/action, system command, daemon call, and still-frame generation step. The
same log is saved to:

```text
~/.cache/livedesk/livedesk.log
```

Livedesk also creates a first-frame PNG fallback under:

```text
~/.cache/livedesk/stills
```

That image is used where GNOME still needs a static wallpaper image. A tray icon
is started automatically when the desktop session provides Ayatana/AppIndicator
support.

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
gsettings get me.tamkungz.Livedesk video-uri
gsettings get me.tamkungz.Livedesk still-uri
```

Check GNOME Shell logs:

```bash
journalctl --user -b /usr/bin/gnome-shell -n 160 --no-pager | grep -i livedesk
```

## Emergency Recovery

If GNOME shows `Oh no! Something has gone wrong.` after setup, remove the native
overlay from a TTY and restart the display manager.

Open a TTY:

```text
Ctrl+Alt+F3
```

Log in with your normal username and password, then run:

```bash
rm -f ~/.config/environment.d/90-livedesk-gnome-shell.conf
rm -rf ~/.local/share/livedesk/gnome-shell-js
sudo systemctl restart gdm
```

If your distro does not use GDM, reboot instead:

```bash
sudo reboot
```

Return to the graphical session with:

```text
Ctrl+Alt+F1
```

On some systems the graphical session is on `Ctrl+Alt+F2` instead.

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
