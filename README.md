<div align="center">
  <img
    src="https://static.tamkungz.me/assets-image/livedesk-live-wallpaper/icons/hicolor/scalable/apps/me.tamkungz.Livedesk.svg"
    alt="Livedesk icon"
    width="128"
    height="128"
  />

  <h1>Livedesk - Live Wallpaper for GNOME</h1>

  <p>
    <a href="https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/TamKungZ/livedesk-live-wallpaper-for-gnome?display_name=tag"></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue"></a>
    <img alt="GNOME Shell" src="https://img.shields.io/badge/GNOME%20Shell-40--44-4a86cf">
    <img alt="GTK4" src="https://img.shields.io/badge/GTK-4-4a86cf">
    <img alt="Libadwaita" src="https://img.shields.io/badge/Libadwaita-1-4a86cf">
    <img alt="Rust" src="https://img.shields.io/badge/Rust-1.77-b7410e">
  </p>

  <img
    src="https://static.tamkungz.me/assets-image/livedesk-live-wallpaper/preview/livedesk-live-wallpaper-preview-low.gif"
    alt="Animated preview of Livedesk running a live video wallpaper on GNOME"
    width="80%"
  />
</div>

Livedesk lets GNOME use a video file as the desktop background.

When a video is applied, Livedesk writes a first-frame PNG to GNOME's normal
wallpaper setting:

```text
org.gnome.desktop.background picture-uri
```

The video URI is stored in Livedesk's own GSettings schema. GNOME Shell then
loads Livedesk's native background module and plays that video behind normal
windows when the visible wallpaper is the matching first-frame image. Livedesk
is not a hidden fullscreen player and no GNOME Shell extension is used on the
current native path.

## Supported GNOME Versions

The current native setup targets GNOME Shell 40-44 and is tested on GNOME Shell
43.x.

GNOME Shell 45 and newer changed its JavaScript module layout. Those versions
need a separate native overlay before they are considered supported.

## Install

### Debian/Ubuntu

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
changes how GNOME Shell loads JavaScript on the next login, so keep the recovery
commands available on another device or write them down.

### Fedora/RHEL-Like

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

Before logging out, read [Emergency Recovery](#emergency-recovery). Native setup
changes how GNOME Shell loads JavaScript on the next login.

### From Source

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

Log out and back in once, then open `livedesk`.

Before logging out, read [Emergency Recovery](#emergency-recovery).

## Use

Open Livedesk:

```bash
livedesk
```

Put videos in:

```text
~/Videos/Livedesk
```

Double-click a video thumbnail, or select a video and click `Save and Apply`.

The app can import videos into the library, generate thumbnails, mute playback,
start/stop the background daemon, show a tray icon on panels that support
AppIndicator/Ayatana indicators, and restore the previous normal wallpaper.

When a video is applied, Livedesk also stores the first video frame as a PNG in:

```text
~/.cache/livedesk/stills
```

That still frame is used for GNOME surfaces that still expect a normal image.
GNOME Settings and other preview UIs should show this PNG instead of a black
video placeholder.

To see detailed action logs while testing, start the app from a terminal:

```bash
livedesk
```

Every button/action, setup command, daemon call, still-frame command, and command
result is printed to the terminal and appended to:

```text
~/.cache/livedesk/livedesk.log
```

## What Setup Changes

`livedesk-setup` installs a user-session GNOME Shell JavaScript overlay under:

```text
~/.local/share/livedesk/gnome-shell-js
```

It also writes:

```text
~/.config/environment.d/90-livedesk-gnome-shell.conf
```

That environment file tells GNOME Shell to load the native Livedesk background
module on the next login. This is why logging out and back in once is required.

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

## Troubleshooting

Check whether native setup is installed:

```bash
livedesk-setup --check-native
echo $?
```

Check the daemon:

```bash
systemctl --user status livedesk-daemon --no-pager
journalctl --user -u livedesk-daemon -n 80 --no-pager
```

Check the current GNOME wallpaper URI:

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

## Uninstall

```bash
livedesk-uninstall
```

To also remove settings and thumbnail cache:

```bash
livedesk-uninstall --purge
```

Your video library at `~/Videos/Livedesk` is kept by default. To remove it too:

```bash
livedesk-uninstall --purge-library
```

## Build Packages

```bash
scripts/package-linux.sh
```

Packages are written to `dist/`.

## License

Livedesk is licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).

<details>
<summary>Legacy 0.1.x Extension Path</summary>

Livedesk 0.1.0 through 0.1.3 used a GNOME Shell extension as the compositor
side of the wallpaper renderer. That older design installed extension files
under paths such as:

```text
~/.local/share/gnome-shell/extensions/livedesk@me.tamkungz
/usr/share/gnome-shell/extensions/livedesk@me.tamkungz
```

It also used extension-specific settings such as `video-uri` and
`wallpaper-enabled`.

Livedesk 1.0 removes the extension runtime. The native path stores a first-frame
PNG in GNOME's normal `org.gnome.desktop.background picture-uri` setting, stores
the video source in `me.tamkungz.Livedesk video-uri`, and loads the background
renderer through a GNOME Shell JS overlay.

`livedesk-uninstall` still removes the old extension directories so users
upgrading from 0.1.x can clean up stale files.

If an old or broken native test build prevents login, use the emergency recovery
steps above. The key rollback is:

```bash
rm -f ~/.config/environment.d/90-livedesk-gnome-shell.conf
rm -rf ~/.local/share/livedesk/gnome-shell-js
```
</details>
