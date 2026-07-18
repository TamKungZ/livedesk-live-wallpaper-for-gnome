// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
//
// GNOME Shell native integration prototype for Livedesk.
//
// This file is meant to live in GNOME Shell's own js/ui/ tree and be
// imported from js/ui/background.js. It keeps the Rust/GStreamer daemon
// as the decoder and moves the compositor-facing reader into Shell's
// native background manager path, so no Shell extension is required.

const { Clutter, Cogl, Gio, GLib } = imports.gi;

const DBUS_NAME = 'me.tamkungz.Livedesk';
const DBUS_PATH = '/me/tamkungz/Livedesk';
const LIVEDESK_SCHEMA = 'me.tamkungz.Livedesk';
const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const PICTURE_URI_KEY = 'picture-uri';
const PICTURE_URI_DARK_KEY = 'picture-uri-dark';
const COLOR_SCHEME_KEY = 'color-scheme';
const PREFER_DARK = 1;

const DBUS_IFACE_XML = `
<node>
  <interface name="me.tamkungz.Livedesk">
    <method name="SetSource">
      <arg type="s" direction="in" name="monitor"/>
      <arg type="s" direction="in" name="uri"/>
    </method>
    <method name="SetMonitorSource">
      <arg type="s" direction="in" name="monitor"/>
      <arg type="s" direction="in" name="uri"/>
      <arg type="u" direction="in" name="width"/>
      <arg type="u" direction="in" name="height"/>
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
const DEFAULT_FPS = 30;

function _settings(schemaId) {
    try {
        return new Gio.Settings({ schema_id: schemaId });
    } catch (e) {
        logError(e, `livedesk-native: settings schema ${schemaId} is not installed`);
        return null;
    }
}

function _settingInt(settings, key, fallback) {
    try {
        return settings.get_int(key);
    } catch (_) {
        return fallback;
    }
}

function _settingString(settings, key) {
    try {
        return settings.get_string(key);
    } catch (_) {
        return '';
    }
}

function _settingBool(settings, key, fallback) {
    try {
        return settings.get_boolean(key);
    } catch (_) {
        return fallback;
    }
}

function _isVideoUri(uri) {
    if (!uri)
        return false;

    try {
        const file = Gio.File.new_for_commandline_arg(uri);
        const info = file.query_info(
            Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
            Gio.FileQueryInfoFlags.NONE,
            null);
        const contentType = info.get_content_type();
        if (contentType?.startsWith('video/'))
            return true;
    } catch (_) {
    }

    const lower = uri.toLowerCase();
    return lower.endsWith('.mp4') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.mkv') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.avi') ||
        lower.endsWith('.m4v') ||
        lower.endsWith('.ogv');
}

class LivedeskNativeBackground {
    constructor(bgManager, backgroundActor) {
        this._bgManager = bgManager;
        this._backgroundActor = backgroundActor;
        this._container = bgManager._container;
        this._layoutManager = bgManager._layoutManager;
        this._monitorIndex = bgManager._monitorIndex;
        this._monitorName = `monitor-${this._monitorIndex}`;

        this._settings = _settings(LIVEDESK_SCHEMA);
        this._backgroundSettings = _settings(BACKGROUND_SCHEMA);
        this._interfaceSettings = _settings(INTERFACE_SCHEMA);
        this._settingsSignalIds = [];
        this._retryTimeoutId = 0;
        this._timeoutId = 0;
        this._mappedFile = null;
        this._framePath = '';
        this._lastGoodSeq = -1;
        this._proxy = null;
        this._destroyed = false;
        this.actor = null;

        if (!this._settings || !this._backgroundSettings)
            return;

        this._createActor();
        if (!this.actor)
            return;

        this._connectSettings();
        this._syncFromSettings();
    }

    _createActor() {
        if (!this._container || this._monitorIndex === null)
            return;

        const monitor = this._layoutManager.monitors[this._monitorIndex];
        if (!monitor)
            return;

        this.actor = new Clutter.Actor({
            name: 'livedesk-native-background',
            reactive: false,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            background_color: new Clutter.Color({
                red: 0,
                green: 0,
                blue: 0,
                alpha: 255,
            }),
        });

        this._container.add_child(this.actor);
        this._container.set_child_above_sibling(this.actor, this._backgroundActor);

        this._backgroundActor.connect('destroy', () => this.destroy());
    }

    _connectSettings() {
        this._settingsSignalIds.push([
            this._settings,
            this._settings.connect('changed', () => this._syncFromSettings()),
        ]);
        this._settingsSignalIds.push([
            this._backgroundSettings,
            this._backgroundSettings.connect('changed', () => this._syncFromSettings()),
        ]);

        if (this._interfaceSettings) {
            this._settingsSignalIds.push([
                this._interfaceSettings,
                this._interfaceSettings.connect(`changed::${COLOR_SCHEME_KEY}`,
                    () => this._syncFromSettings()),
            ]);
        }
    }

    _syncFromSettings() {
        if (this._destroyed || !this.actor)
            return;

        const uri = this._backgroundUri();
        if (!_isVideoUri(uri)) {
            this.actor.hide();
            this._stopPolling();

            if (this._proxy)
                this._proxy.PauseRemote(this._monitorName);
            return;
        }

        this.actor.show();

        if (!this._proxy)
            this._connectDBus();

        this._applySettingsToDaemon(uri);
        this._restartPolling();
    }

    _backgroundUri() {
        const darkPreferred = _settingInt(
            this._interfaceSettings,
            COLOR_SCHEME_KEY,
            0) === PREFER_DARK;

        const primaryKey = darkPreferred ? PICTURE_URI_DARK_KEY : PICTURE_URI_KEY;
        const fallbackKey = darkPreferred ? PICTURE_URI_KEY : PICTURE_URI_DARK_KEY;

        return _settingString(this._backgroundSettings, primaryKey) ||
            _settingString(this._backgroundSettings, fallbackKey);
    }

    _connectDBus() {
        if (this._destroyed)
            return false;

        try {
            this._proxy = new WallpaperProxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH);
            if (!this._proxy.get_name_owner())
                throw new Error('daemon D-Bus name has no owner yet');

            this._proxy.FramePathRemote(this._monitorName, ([path]) => {
                if (this._destroyed)
                    return;
                this._framePath = path;
                this._restartPolling();
            });
            return true;
        } catch (e) {
            this._proxy = null;
            logError(e, 'livedesk-native: could not connect to daemon over D-Bus');
            this._maybeSpawnDaemon();
            this._scheduleReconnect();
            return false;
        }
    }

    _scheduleReconnect() {
        if (this._retryTimeoutId || this._destroyed)
            return;

        this._retryTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._retryTimeoutId = 0;
            if (this._destroyed || !_isVideoUri(this._backgroundUri()))
                return GLib.SOURCE_REMOVE;

            if (this._connectDBus()) {
                this._applySettingsToDaemon(this._backgroundUri());
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _maybeSpawnDaemon() {
        try {
            GLib.spawn_command_line_async('systemctl --user start livedesk-daemon.service');
        } catch (_) {
        }

        try {
            const binPath = GLib.build_filenamev([
                GLib.get_home_dir(),
                '.local',
                'bin',
                'livedesk-daemon',
            ]);
            if (GLib.file_test(binPath, GLib.FileTest.IS_EXECUTABLE)) {
                GLib.spawn_async(
                    null,
                    [binPath],
                    null,
                    GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null);
            }
        } catch (e) {
            logError(e, 'livedesk-native: failed to auto-start daemon');
        }
    }

    _applySettingsToDaemon(uri) {
        if (!this._proxy || this._destroyed)
            return;

        const muted = _settingBool(this._settings, 'muted', true);
        const monitor = this._layoutManager.monitors[this._monitorIndex];
        const width = monitor?.width ?? 1920;
        const height = monitor?.height ?? 1080;

        if (uri)
            this._proxy.SetMonitorSourceRemote(this._monitorName, uri, width, height);
        this._proxy.SetMutedRemote(this._monitorName, muted);
    }

    _restartPolling() {
        this._stopPolling();

        if (!this.actor || !this._framePath)
            return;

        const fps = Math.max(1, _settingInt(this._settings, 'frame-rate', DEFAULT_FPS));
        const intervalMs = Math.max(16, Math.round(1000 / fps));
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._mappedFile = null;
    }

    _ensureMapped() {
        if (this._mappedFile)
            return true;

        try {
            this._mappedFile = GLib.MappedFile.new(this._framePath, false);
            return true;
        } catch (_) {
            return false;
        }
    }

    _tick() {
        if (!this.actor || !this._ensureMapped())
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
            Cogl.PixelFormat.RGBA_8888,
            width,
            height,
            width * 4);

        if (ok) {
            this.actor.set_content(image);
            this._lastGoodSeq = Number(seq1);
        }
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;

        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = 0;
        }

        this._stopPolling();

        for (const [settings, signalId] of this._settingsSignalIds) {
            settings.disconnect(signalId);
        }
        this._settingsSignalIds = [];

        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }

        this._proxy = null;
        this._settings = null;
        this._backgroundSettings = null;
        this._interfaceSettings = null;
        this._bgManager = null;
        this._backgroundActor = null;
        this._container = null;
        this._layoutManager = null;
    }
}

var attachToBackgroundManager = function(bgManager, backgroundActor) {
    try {
        if (!bgManager || !backgroundActor)
            return;

        if (bgManager._livedeskNativeBackground)
            bgManager._livedeskNativeBackground.destroy();

        bgManager._livedeskNativeBackground =
            new LivedeskNativeBackground(bgManager, backgroundActor);
    } catch (e) {
        logError(e, 'livedesk-native: failed to attach native background actor');
    }
};
