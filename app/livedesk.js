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
        library: [],
        selected: '',
        muted: true,
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
        const config = {...defaultConfig(), ...JSON.parse(new TextDecoder().decode(bytes))};
        config.monitors = {...defaultConfig().monitors, ...(config.monitors ?? {})};
        config.library = Array.isArray(config.library) ? config.library : [];

        const firstMonitor = Object.keys(config.monitors)[0] ?? 'monitor-0';
        const activeUri = config.selected || config.monitors[firstMonitor]?.uri || '';
        config.selected = activeUri;
        if (activeUri && !config.library.includes(activeUri))
            config.library.unshift(activeUri);

        return config;
    } catch (_) {
        return defaultConfig();
    }
}

function saveConfig(config) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    GLib.file_set_contents(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
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

function displayNameForUri(uri) {
    const path = fileUriToPath(uri);
    if (path === uri)
        return uri;
    return GLib.path_get_basename(path);
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
        this._buildActions();
        this._buildWindow();
        this._window.present();
    }

    _buildActions() {
        this._addAction('add-video', () => this._chooseVideo());
        this._addAction('start-daemon', () => this._startDaemon());
        this._addAction('play', () => this._callDaemon('PlayRemote'));
        this._addAction('pause', () => this._callDaemon('PauseRemote'));
        this._addAction('stop', () => this._callDaemon('StopRemote'));
        this._addAction('apply', () => this._saveAndApply());
    }

    _addAction(name, callback) {
        const action = new Gio.SimpleAction({name});
        action.connect('activate', callback);
        this.add_action(action);
    }

    _connectProxy() {
        try {
            this._proxy = new LivedeskProxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH);
        } catch (_) {
            this._proxy = null;
        }
    }

    _activeMonitor() {
        const monitor = this._monitorEntry.text.trim();
        return monitor || 'monitor-0';
    }

    _activeMonitorConfig() {
        return {
            uri: this._config.selected || '',
            width: this._widthSpin.value_as_int,
            height: this._heightSpin.value_as_int,
        };
    }

    _buildWindow() {
        const firstMonitor = Object.keys(this._config.monitors ?? {})[0] ?? 'monitor-0';
        const firstConfig = this._config.monitors?.[firstMonitor] ?? defaultConfig().monitors['monitor-0'];

        this._window = new Adw.ApplicationWindow({
            application: this,
            title: 'Livedesk',
            default_width: 880,
            default_height: 620,
        });

        const root = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
        });
        this._window.set_content(root);

        const header = new Adw.HeaderBar();
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Add video',
        });
        addButton.connect('clicked', () => this._chooseVideo());
        header.pack_start(addButton);

        const menuButton = new Gtk.MenuButton({
            icon_name: 'open-menu-symbolic',
            tooltip_text: 'Menu',
        });
        menuButton.set_menu_model(this._menuModel());
        header.pack_end(menuButton);
        root.append(header);

        const stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            vexpand: true,
        });
        root.append(stack);
        this._stack = stack;

        stack.add_named(this._galleryPage(), 'gallery');
        stack.add_named(this._settingsPage(firstMonitor, firstConfig), 'settings');
        stack.visible_child_name = 'gallery';
    }

    _menuModel() {
        const menu = new Gio.Menu();
        menu.append('Add Video', 'app.add-video');
        menu.append('Save and Apply', 'app.apply');
        menu.append('Start Daemon', 'app.start-daemon');
        menu.append('Play', 'app.play');
        menu.append('Pause', 'app.pause');
        menu.append('Stop', 'app.stop');
        menu.append('Settings', 'app.apply-settings-view');

        const settingsAction = new Gio.SimpleAction({name: 'apply-settings-view'});
        settingsAction.connect('activate', () => {
            this._stack.visible_child_name = this._stack.visible_child_name === 'settings'
                ? 'gallery'
                : 'settings';
        });
        this.add_action(settingsAction);

        return menu;
    }

    _galleryPage() {
        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
        });

        this._flow = new Gtk.FlowBox({
            valign: Gtk.Align.START,
            max_children_per_line: 4,
            min_children_per_line: 1,
            selection_mode: Gtk.SelectionMode.NONE,
            column_spacing: 14,
            row_spacing: 14,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        scrolled.set_child(this._flow);
        this._reloadGallery();
        return scrolled;
    }

    _settingsPage(firstMonitor, firstConfig) {
        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'emblem-system-symbolic',
        });

        const group = new Adw.PreferencesGroup({title: 'Wallpaper'});
        page.add(group);

        this._selectedRow = new Adw.ActionRow({
            title: 'Selected video',
            subtitle: fileUriToPath(this._config.selected),
        });
        group.add(this._selectedRow);

        this._monitorEntry = new Adw.EntryRow({title: 'Monitor'});
        this._monitorEntry.text = firstMonitor;
        group.add(this._monitorEntry);

        this._widthSpin = this._spin(firstConfig.width ?? 1920, 320, 16384);
        const widthRow = new Adw.ActionRow({title: 'Width'});
        widthRow.add_suffix(this._widthSpin);
        group.add(widthRow);

        this._heightSpin = this._spin(firstConfig.height ?? 1080, 240, 16384);
        const heightRow = new Adw.ActionRow({title: 'Height'});
        heightRow.add_suffix(this._heightSpin);
        group.add(heightRow);

        this._mutedSwitch = new Gtk.Switch({
            active: this._config.muted ?? true,
            valign: Gtk.Align.CENTER,
        });
        const mutedRow = new Adw.ActionRow({title: 'Mute audio'});
        mutedRow.add_suffix(this._mutedSwitch);
        mutedRow.activatable_widget = this._mutedSwitch;
        group.add(mutedRow);

        const controls = new Adw.PreferencesGroup({title: 'Daemon'});
        page.add(controls);
        controls.add(this._buttonRow([
            ['Start daemon', () => this._startDaemon()],
            ['Play', () => this._callDaemon('PlayRemote')],
            ['Pause', () => this._callDaemon('PauseRemote')],
            ['Stop', () => this._callDaemon('StopRemote')],
        ]));

        const applyGroup = new Adw.PreferencesGroup();
        page.add(applyGroup);
        const apply = new Gtk.Button({
            label: 'Save and apply',
            halign: Gtk.Align.END,
            css_classes: ['suggested-action'],
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
        });
        apply.connect('clicked', () => this._saveAndApply());
        const row = new Adw.PreferencesRow();
        row.set_child(apply);
        applyGroup.add(row);

        return page;
    }

    _spin(value, lower, upper) {
        return new Gtk.SpinButton({
            valign: Gtk.Align.CENTER,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: 1,
                page_increment: 100,
                value,
            }),
        });
    }

    _buttonRow(items) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
        });

        for (const [label, callback] of items) {
            const button = new Gtk.Button({label, hexpand: true});
            button.connect('clicked', callback);
            box.append(button);
        }

        const row = new Adw.PreferencesRow();
        row.set_child(box);
        return row;
    }

    _reloadGallery() {
        let child = this._flow.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._flow.remove(child);
            child = next;
        }

        for (const uri of this._config.library)
            this._flow.append(this._videoTile(uri));

        this._flow.append(this._addTile());
    }

    _videoTile(uri) {
        const button = new Gtk.Button({
            width_request: 190,
            height_request: 150,
            css_classes: this._config.selected === uri ? ['suggested-action'] : [],
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
        });

        const video = new Gtk.Video({
            file: Gio.File.new_for_uri(uri),
            autoplay: false,
            loop: true,
            hexpand: true,
            vexpand: true,
            height_request: 96,
        });
        video.media_stream?.set_muted(true);
        box.append(video);

        const label = new Gtk.Label({
            label: displayNameForUri(uri),
            ellipsize: 3,
            xalign: 0,
        });
        box.append(label);

        button.set_child(box);
        button.connect('clicked', () => {
            this._selectVideo(uri);
            this._saveAndApply();
        });
        return button;
    }

    _addTile() {
        const button = new Gtk.Button({
            width_request: 190,
            height_request: 150,
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            spacing: 8,
        });
        box.append(new Gtk.Image({icon_name: 'list-add-symbolic', pixel_size: 32}));
        box.append(new Gtk.Label({label: 'Add video'}));
        button.set_child(box);
        button.connect('clicked', () => this._chooseVideo());
        return button;
    }

    _selectVideo(uri) {
        this._config.selected = uri;
        if (this._selectedRow)
            this._selectedRow.subtitle = fileUriToPath(uri);
        this._reloadGallery();
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
                const uri = dlg.get_file().get_uri();
                if (!this._config.library.includes(uri))
                    this._config.library.unshift(uri);
                this._selectVideo(uri);
                this._saveConfigOnly();
            }
            dlg.destroy();
        });
        dialog.show();
    }

    _saveConfigOnly() {
        const monitor = this._activeMonitor();
        this._config.monitors = this._config.monitors ?? {};
        this._config.monitors[monitor] = this._activeMonitorConfig();
        this._config.muted = this._mutedSwitch.active;
        saveConfig(this._config);
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
        this._saveConfigOnly();
        this._connectProxy();

        if (!this._proxy) {
            this._showError(`Saved ${CONFIG_PATH}. Start the daemon to apply it now.`);
            return;
        }

        const monitor = this._activeMonitor();
        const uri = this._config.selected;
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
        this._proxy[method](this._activeMonitor());
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
