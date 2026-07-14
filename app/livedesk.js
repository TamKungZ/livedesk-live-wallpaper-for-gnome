#!/usr/bin/env -S gjs -m

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

const APP_ID = 'me.tamkungz.Livedesk';
const DBUS_NAME = 'me.tamkungz.Livedesk';
const DBUS_PATH = '/me/tamkungz/Livedesk';
const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'livedesk']);
const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json']);

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
  </interface>
</node>`;
const LivedeskProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);

function defaultConfig() {
    return {
        monitors: {
            'monitor-0': {
                uri: '',
                width: 1920,
                height: 1080,
            },
        },
    };
}

function loadConfig() {
    try {
        const [, bytes] = GLib.file_get_contents(CONFIG_PATH);
        const text = new TextDecoder().decode(bytes);
        return {...defaultConfig(), ...JSON.parse(text)};
    } catch (_) {
        return defaultConfig();
    }
}

function saveConfig(config) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    const text = `${JSON.stringify(config, null, 2)}\n`;
    GLib.file_set_contents(CONFIG_PATH, text);
}

function fileUriToPath(uri) {
    if (!uri)
        return 'No file selected';
    try {
        return Gio.File.new_for_uri(uri).get_path() ?? uri;
    } catch (_) {
        return uri;
    }
}

const LivedeskApp = GObject.registerClass(
class LivedeskApp extends Adw.Application {
    constructor() {
        super({application_id: APP_ID, flags: Gio.ApplicationFlags.FLAGS_NONE});
        this._config = loadConfig();
        this._proxy = null;
    }

    vfunc_activate() {
        if (this._window) {
            this._window.present();
            return;
        }

        this._connectProxy();
        this._buildWindow();
        this._window.present();
    }

    _connectProxy() {
        try {
            this._proxy = new LivedeskProxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH);
        } catch (_) {
            this._proxy = null;
        }
    }

    _selectedMonitor() {
        const monitor = this._monitorRow.text.trim();
        return monitor || 'monitor-0';
    }

    _selectedUri() {
        return this._uri ?? '';
    }

    _currentMonitorConfig() {
        return {
            uri: this._selectedUri(),
            width: this._widthSpin.value_as_int,
            height: this._heightSpin.value_as_int,
        };
    }

    _buildWindow() {
        const firstMonitor = Object.keys(this._config.monitors ?? {})[0] ?? 'monitor-0';
        const firstConfig = this._config.monitors?.[firstMonitor] ?? defaultConfig().monitors['monitor-0'];
        this._uri = firstConfig.uri ?? '';

        this._window = new Adw.PreferencesWindow({
            application: this,
            title: 'Livedesk',
            default_width: 620,
            default_height: 540,
        });

        const page = new Adw.PreferencesPage({
            title: 'Livedesk',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        this._window.add(page);

        const sourceGroup = new Adw.PreferencesGroup({title: 'Wallpaper'});
        page.add(sourceGroup);

        this._monitorRow = new Adw.EntryRow({title: 'Monitor'});
        this._monitorRow.text = firstMonitor;
        sourceGroup.add(this._monitorRow);

        this._fileRow = new Adw.ActionRow({
            title: 'Video file',
            subtitle: fileUriToPath(this._uri),
        });
        const chooseButton = new Gtk.Button({
            label: 'Choose',
            valign: Gtk.Align.CENTER,
        });
        chooseButton.connect('clicked', () => this._chooseVideo());
        this._fileRow.add_suffix(chooseButton);
        sourceGroup.add(this._fileRow);

        this._widthSpin = new Gtk.SpinButton({
            valign: Gtk.Align.CENTER,
            adjustment: new Gtk.Adjustment({
                lower: 320,
                upper: 16384,
                step_increment: 1,
                page_increment: 100,
                value: firstConfig.width ?? 1920,
            }),
        });
        this._widthRow = new Adw.ActionRow({
            title: 'Width',
        });
        this._widthRow.add_suffix(this._widthSpin);
        sourceGroup.add(this._widthRow);

        this._heightSpin = new Gtk.SpinButton({
            valign: Gtk.Align.CENTER,
            adjustment: new Gtk.Adjustment({
                lower: 240,
                upper: 16384,
                step_increment: 1,
                page_increment: 100,
                value: firstConfig.height ?? 1080,
            }),
        });
        this._heightRow = new Adw.ActionRow({
            title: 'Height',
        });
        this._heightRow.add_suffix(this._heightSpin);
        sourceGroup.add(this._heightRow);

        const playbackGroup = new Adw.PreferencesGroup({title: 'Playback'});
        page.add(playbackGroup);

        this._mutedSwitch = new Gtk.Switch({
            active: true,
            valign: Gtk.Align.CENTER,
        });
        this._mutedRow = new Adw.ActionRow({title: 'Mute audio'});
        this._mutedRow.add_suffix(this._mutedSwitch);
        this._mutedRow.activatable_widget = this._mutedSwitch;
        playbackGroup.add(this._mutedRow);

        const controls = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
        });
        controls.append(this._button('Start daemon', () => this._startDaemon()));
        controls.append(this._button('Play', () => this._callDaemon('PlayRemote')));
        controls.append(this._button('Pause', () => this._callDaemon('PauseRemote')));
        controls.append(this._button('Stop', () => this._callDaemon('StopRemote')));

        const controlsRow = new Adw.PreferencesRow();
        controlsRow.set_child(controls);
        playbackGroup.add(controlsRow);

        const applyGroup = new Adw.PreferencesGroup();
        page.add(applyGroup);
        const applyButton = new Gtk.Button({
            label: 'Save and apply',
            halign: Gtk.Align.END,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
            css_classes: ['suggested-action'],
        });
        applyButton.connect('clicked', () => this._saveAndApply());
        const applyRow = new Adw.PreferencesRow();
        applyRow.set_child(applyButton);
        applyGroup.add(applyRow);
    }

    _button(label, callback) {
        const button = new Gtk.Button({label, hexpand: true});
        button.connect('clicked', callback);
        return button;
    }

    _chooseVideo() {
        const dialog = new Gtk.FileChooserNative({
            title: 'Select a video',
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this._window,
            modal: true,
        });

        const filter = new Gtk.FileFilter();
        filter.set_name('Video files');
        filter.add_mime_type('video/*');
        dialog.add_filter(filter);

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                this._uri = dlg.get_file().get_uri();
                this._fileRow.subtitle = fileUriToPath(this._uri);
            }
            dlg.destroy();
        });
        dialog.show();
    }

    _startDaemon() {
        try {
            GLib.spawn_command_line_async('systemctl --user start livedesk-daemon.service');
            this._connectProxy();
        } catch (e) {
            this._showError(`Failed to start daemon: ${e.message}`);
        }
    }

    _saveAndApply() {
        const monitor = this._selectedMonitor();
        this._config.monitors = this._config.monitors ?? {};
        this._config.monitors[monitor] = this._currentMonitorConfig();
        saveConfig(this._config);

        this._connectProxy();
        if (!this._proxy) {
            this._showError(`Saved ${CONFIG_PATH}. Start the daemon to apply it now.`);
            return;
        }

        const uri = this._selectedUri();
        if (uri)
            this._proxy.SetSourceRemote(monitor, uri);
        this._proxy.SetMutedRemote(monitor, this._mutedSwitch.active);
    }

    _callDaemon(method) {
        this._connectProxy();
        if (!this._proxy) {
            this._showError('Daemon is not available.');
            return;
        }
        this._proxy[method](this._selectedMonitor());
    }

    _showError(message) {
        const dialog = new Adw.MessageDialog({
            transient_for: this._window,
            heading: 'Livedesk',
            body: message,
        });
        dialog.add_response('ok', 'OK');
        dialog.present();
    }
});

new LivedeskApp().run(ARGV);
