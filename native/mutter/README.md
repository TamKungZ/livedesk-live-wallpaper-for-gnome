# Mutter-Native Video Background

This is the target for making Livedesk a real GNOME background renderer instead
of a Shell actor overlay.

The current Shell-native path patches GNOME Shell JavaScript and adds a
`Clutter.Actor` above each `Meta.BackgroundActor`. That is practical and works
without a Shell extension, but it is still an overlay. Overview previews,
workspace animation backgrounds, rounded clips, blur, and future Shell layout
changes can create edge cases because Livedesk is not part of the same content
object GNOME already uses for wallpapers.

The Mutter-native target should make video frames part of the background content
path itself.

## Goal

- Keep `org.gnome.desktop.background picture-uri` as the source of truth.
- Accept image URIs exactly as Mutter/GNOME already does.
- Accept video URIs as first-class background sources.
- Preserve all existing background consumers: desktop, overview previews,
  workspace switching animation, lock screen, blur, vignette, and rounded clips.
- Avoid adding extra Shell actors for the video path.

## Candidate Patch Surface

The likely integration point is Mutter's background content implementation:

```text
src/compositor/meta-background-content.*
src/compositor/meta-background-actor.*
src/compositor/meta-background.*
```

The exact file names can vary by Mutter version. The important boundary is that
the video texture provider must sit where image backgrounds currently become
paintable `ClutterContent`, not above that content as a sibling actor.

## Staged Work

1. Detect video URIs in the existing background loader path.
2. Add a `MetaBackgroundVideoContent` or equivalent content provider that can
   expose the latest decoded frame as a paintable texture/content.
3. Keep the Rust/GStreamer daemon initially and consume its shared-memory frame
   buffer from Mutter, matching the current `GVW1` frame format.
4. Replace CPU RGBA upload with a compositor-owned texture path once the content
   boundary is stable.
5. Remove the Shell overlay path when Mutter-native supports the same GNOME
   versions.

## Acceptance Criteria

- Desktop background plays video from `picture-uri`.
- Pressing Super does not create a second playback controller or visible flicker.
- Overview/workspace previews use the same video content as the desktop.
- Rounded corners, clipping, blur, brightness, vignette, and monitor geometry
  remain controlled by GNOME's stock background pipeline.
- Image wallpapers still behave exactly like stock GNOME.

## Current Status

Not implemented. The Shell-native overlay remains the active path while this
target is designed and tested against specific Mutter versions.
