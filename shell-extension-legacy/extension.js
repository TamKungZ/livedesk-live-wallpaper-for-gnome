const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;

const DBUS_NAME = 'me.tamkungz.Livedesk';
const DBUS_PATH = '/me/tamkungz/Livedesk';
const DBUS_IFACE_XML = `
<node>
  <interface name="me.tamkungz.Livedesk">
    <method name="SetSource">
      <arg type="s" direction="in" name="monitor"/>
      <arg type="s" direction="in" name="uri"/>
    </method>
    <method name="Play">
      <arg type="s" direction="in" name="monitor"/>
    </method>
    <method name="Pause">
      <arg type="s" direction="in" name="monitor"/>
    </method>
    <method name="Stop">
      <arg type="s" direction="in" name="monitor"/>
    </method>
    <method name="SetMuted">
      <arg type="s" direction="in" name="monitor"/>
      <arg type="b" direction="in" name="muted"/>
    </method>
    <method name="FramePath">
      <arg type="s" direction="in" name="monitor"/>
      <arg type="s" direction="out" name="path"/>
    </method>
    <method name="ListMonitors">
      <arg type="as" direction="out" name="monitors"/>
    </method>
  </interface>
</node>`;
const WallpaperProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);

const FRAME_MAGIC = 'GVW1';
const HEADER_LEN = 24;

class MonitorWallpaper {
    constructor(monitorIndex, monitorGeometry, monitorName) {
        this.index = monitorIndex;
        this.name = monitorName;
        this.geometry = monitorGeometry;
        this._mappedFile = null;
        this._timeoutId = null;
        this._lastGoodSeq = -1;

        this.actor = new Clutter.Actor({
            x: monitorGeometry.x,
            y: monitorGeometry.y,
            width: monitorGeometry.width,
            height: monitorGeometry.height,
            background_color: new Clutter.Color({red: 0, green: 0, blue: 0, alpha: 255}),
        });

        Main.layoutManager._backgroundGroup.add_child(this.actor);
        Main.layoutManager._backgroundGroup.set_child_above_sibling(this.actor, null);
    }

    startPolling(framePath, fps) {
        this.stopPolling();
        this._framePath = framePath;
        const intervalMs = Math.max(16, Math.round(1000 / fps));
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopPolling() {
        if (this._timeoutId !== null) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._mappedFile = null;
    }

    _ensureMapped() {
        if (this._mappedFile !== null)
            return true;
        try {
            this._mappedFile = GLib.MappedFile.new(this._framePath, false);
            return true;
        } catch (e) {
            return false;
        }
    }

    _tick() {
        if (!this._ensureMapped())
            return;

        const bytes = this._mappedFile.get_bytes().toArray();
        if (bytes.length < HEADER_LEN)
            return;

        const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        if (magic !== FRAME_MAGIC)
            return;

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = view.getUint32(4, true);
        const height = view.getUint32(8, true);
        const expectedLen = HEADER_LEN + width * height * 4;
        if (width === 0 || height === 0 || bytes.length < expectedLen)
            return;

        const seq1 = view.getBigUint64(16, true);
        if (seq1 % 2n !== 0n)
            return;
        if (seq1 === BigInt(this._lastGoodSeq))
            return;

        const pixels = bytes.subarray(HEADER_LEN, expectedLen);
        const seq2 = view.getBigUint64(16, true);
        if (seq1 !== seq2)
            return;

        const image = new Clutter.Image();
        const ok = image.set_data(
            pixels,
            Clutter.PixelFormat.RGBA_8888,
            width,
            height,
            width * 4
        );
        if (ok) {
            this.actor.set_content(image);
            this._lastGoodSeq = Number(seq1);
        }
    }

    destroy() {
        this.stopPolling();
        this.actor.destroy();
    }
}

class LivedeskExtension {
    enable() {
        this._settings = ExtensionUtils.getSettings('me.tamkungz.Livedesk');
        this._monitors = [];
        this._proxy = null;
        this._fullscreenSignalId = null;
        this._lockSignalId = null;

        this._connectDBus();
        this._rebuildMonitors();
        this._applySettingsToDaemon();

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed',
            () => this._rebuildMonitors()
        );

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._applySettingsToDaemon();
        });

        this._connectFullscreenWatch();
        this._connectLockWatch();
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._fullscreenSignalId) {
            global.display.disconnect(this._fullscreenSignalId);
            this._fullscreenSignalId = null;
        }
        if (this._lockSignalId) {
            Main.sessionMode.disconnect(this._lockSignalId);
            this._lockSignalId = null;
        }

        for (const m of this._monitors)
            m.destroy();
        this._monitors = [];
        this._settings = null;
        this._proxy = null;
    }

    _connectDBus() {
        try {
            this._proxy = new WallpaperProxy(
                Gio.DBus.session,
                DBUS_NAME,
                DBUS_PATH
            );
        } catch (e) {
            logError(e, 'livedesk: could not connect to daemon over D-Bus');
            this._maybeSpawnDaemon();
        }
    }

    _maybeSpawnDaemon() {
        try {
            const binPath = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'livedesk-daemon']);
            if (GLib.file_test(binPath, GLib.FileTest.IS_EXECUTABLE)) {
                GLib.spawn_async(
                    null,
                    [binPath],
                    null,
                    GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null
                );
            }
        } catch (e) {
            logError(e, 'livedesk: failed to auto-start daemon');
        }
    }

    _rebuildMonitors() {
        for (const m of this._monitors)
            m.destroy();
        this._monitors = [];

        const monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            const name = `monitor-${i}`;
            const mw = new MonitorWallpaper(i, monitors[i], name);
            this._monitors.push(mw);

            if (this._proxy) {
                this._proxy.FramePathRemote(name, ([path]) => {
                    const fps = this._settings.get_int('frame-rate');
                    mw.startPolling(path, fps);
                });
            }
        }
    }

    _applySettingsToDaemon() {
        if (!this._proxy)
            return;
        const uri = this._settings.get_string('video-uri');
        const muted = this._settings.get_boolean('muted');
        const fps = this._settings.get_int('frame-rate');

        for (const m of this._monitors) {
            if (uri)
                this._proxy.SetSourceRemote(m.name, uri);
            this._proxy.SetMutedRemote(m.name, muted);
            m.startPolling(m._framePath || '', fps);
        }
    }

    _setAllPaused(paused) {
        if (!this._proxy)
            return;
        for (const m of this._monitors) {
            if (paused)
                this._proxy.PauseRemote(m.name);
            else
                this._proxy.PlayRemote(m.name);
        }
    }

    _connectFullscreenWatch() {
        try {
            this._fullscreenSignalId = global.display.connect('in-fullscreen-changed', () => {
                if (!this._settings.get_boolean('pause-on-fullscreen'))
                    return;
                const anyFullscreen = Main.layoutManager.monitors.some(m => m.inFullscreen);
                this._setAllPaused(anyFullscreen);
            });
        } catch (e) {
            logError(e, 'livedesk: fullscreen watch unavailable on this GNOME version');
        }
    }

    _connectLockWatch() {
        try {
            this._lockSignalId = Main.sessionMode.connect('updated', () => {
                if (!this._settings.get_boolean('pause-when-locked'))
                    return;
                const locked = Main.sessionMode.isLocked || Main.sessionMode.currentMode === 'unlock-dialog';
                this._setAllPaused(locked);
            });
        } catch (e) {
            logError(e, 'livedesk: lock-screen watch unavailable on this GNOME version');
        }
    }
}

function init() {
    return new LivedeskExtension();
}
