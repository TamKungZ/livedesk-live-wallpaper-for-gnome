# Livedesk GNOME Shell Native Prototype

This is the no-extension path for Livedesk.

It moves the frame reader from a GNOME Shell extension into GNOME Shell's own
`BackgroundManager` path. The Rust daemon still decodes video with GStreamer and
writes RGBA frames to the shared-memory files under `$XDG_RUNTIME_DIR/livedesk`.
The patched Shell imports `js/ui/livedeskBackground.js` and attaches one live
actor per monitor while Shell creates its normal `Meta.BackgroundActor`.

The visible wallpaper source remains GNOME's own wallpaper setting:

```text
org.gnome.desktop.background picture-uri
org.gnome.desktop.background picture-uri-dark
```

In normal operation those keys point at a first-frame PNG so GNOME Settings and
other preview UIs can still render a static background. The matching video
source is stored in:

```text
me.tamkungz.Livedesk video-uri
me.tamkungz.Livedesk still-uri
```

When the current GNOME background URI matches Livedesk's still URI, the native
overlay treats `video-uri` as the wallpaper source. Direct video URIs in
GNOME's background settings are still accepted as a compatibility path. When the
URI points at any other normal image, GNOME's stock background path is left
alone.

This is not a standalone Wayland client. On GNOME Wayland, a normal process
cannot draw below Shell's compositor-owned desktop. The only non-extension ways
to be a real background are:

- Patch GNOME Shell's background manager, which this prototype does.
- Patch Mutter's C-level `Meta.BackgroundContent`/`Meta.BackgroundActor`, which
  is deeper and should come after this path is proven.

## Files

- `livedeskBackground.js` - GNOME Shell JS module to copy into `js/ui/`.
- `gnome-shell-43-background.patch` - minimal patch showing the integration
  points for GNOME Shell 43.x.

## How To Apply To GNOME Shell Source

1. Get the GNOME Shell source that matches your distro package.
2. Copy `native/gnome-shell/livedeskBackground.js` to
   `gnome-shell/js/ui/livedeskBackground.js`.
3. Apply the patch by hand if the line numbers drift:

   - Add `<file>ui/livedeskBackground.js</file>` to
     `js/js-resources.gresource.xml`.
   - Add `const LivedeskBackground = imports.ui.livedeskBackground;` near the
     other imports in `js/ui/background.js`.
   - In `BackgroundManager._createBackgroundActor()`, call
     `LivedeskBackground.attachToBackgroundManager(this, backgroundActor);`
     after the normal background actor has been added and positioned.

4. Rebuild and install GNOME Shell using your distro's packaging flow.
5. Install Livedesk's schema, daemon, and app as usual. The GNOME Shell
   extension is not needed for this prototype.

## Current Behavior

- Uses GNOME's `org.gnome.desktop.background` URI as the visible still source.
- Uses Livedesk GSettings for the native playback source and preferences:
  - `video-uri`
  - `still-uri`
  - `muted`
  - `frame-rate`
- Starts `livedesk-daemon.service` over systemd user session when D-Bus is not
  available yet.
- Reads the same shared-memory frame format used by the extension.
- Attaches the live actor to Shell's background container, above the static
  `Meta.BackgroundActor` and below normal windows.

## Known Limits

- This is Shell-native, not Mutter-native. It removes the extension dependency,
  but it still uses a Clutter actor in GNOME Shell instead of adding a video
  texture provider inside Mutter's `Meta.BackgroundContent`.
- GNOME Shell JS internals are version-sensitive. The patch is based on GNOME
  Shell 43.x, which is the version available on this machine.
- The first frame still goes through CPU RGBA upload via `Clutter.Image`, same as
  the current extension. A Mutter-native renderer should avoid that later by
  owning a texture/update path closer to the compositor.
