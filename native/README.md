# Native Livedesk Work

This directory holds non-extension integration work.

## Target 1: Shell-Native

Status: prototype added in `gnome-shell/`.

This removes the GNOME Shell extension and patches GNOME Shell itself to create
Livedesk's background actor while Shell builds its normal desktop background.
It is the practical first native target because GNOME Shell already owns the
background container on Wayland.

## Target 2: Mutter-Native

Status: not implemented yet.

This would patch Mutter's `Meta.BackgroundContent` or related background
painting code so the video frame provider becomes part of Mutter's background
renderer instead of being a separate Clutter actor. This is the stricter
"background by the compositor's background renderer" design, but it requires a
Mutter patch and will be more version-sensitive than the Shell-native path.

## Why There Is No Standalone Wayland Binary Here

A standalone Wayland client cannot draw behind GNOME Shell's compositor-owned
desktop background. A layer-shell style client would still be a special surface
above or below other surfaces, not GNOME's own background renderer. For GNOME
Wayland, the native choices are to patch GNOME Shell or patch Mutter.
