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
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'livedesk']);
const THUMB_DIR = GLib.build_filenamev([CACHE_DIR, 'thumbnails']);
const TILE_WIDTH = 300;
const TILE_HEIGHT = 206;
const THUMB_WIDTH = 284;
const THUMB_HEIGHT = 160;

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

function defaultLibraryDir() {
    const videos = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS)
        ?? GLib.build_filenamev([GLib.get_home_dir(), 'Videos']);
    return GLib.build_filenamev([videos, 'Livedesk']);
}

function ensureDirs(config) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    GLib.mkdir_with_parents(CACHE_DIR, 0o755);
    GLib.mkdir_with_parents(THUMB_DIR, 0o755);
    GLib.mkdir_with_parents(config.library_dir, 0o755);
}

function defaultConfig() {
    return {
        library_dir: defaultLibraryDir(),
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
        config.library_dir = config.library_dir || defaultLibraryDir();

        const firstMonitor = Object.keys(config.monitors)[0] ?? 'monitor-0';
        const activeUri = config.selected || config.monitors[firstMonitor]?.uri || '';
        config.selected = activeUri;
        if (activeUri && !config.library.includes(activeUri))
            config.library.unshift(activeUri);

        ensureDirs(config);
        return config;
    } catch (_) {
        const config = defaultConfig();
        ensureDirs(config);
        return config;
    }
}

function saveConfig(config) {
    ensureDirs(config);
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

function thumbnailPathForUri(uri) {
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, uri, -1);
    return GLib.build_filenamev([THUMB_DIR, `${hash}.png`]);
}

function runCommand(args) {
    try {
        const [ok, , , status] = GLib.spawn_sync(
            null,
            args,
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );
        return ok && status === 0;
    } catch (_) {
        return false;
    }
}

function thumbnailForUri(uri) {
    const input = fileUriToPath(uri);
    const output = thumbnailPathForUri(uri);
    if (GLib.file_test(output, GLib.FileTest.EXISTS))
        return output;
    if (!input || input === uri || !GLib.file_test(input, GLib.FileTest.EXISTS))
        return null;

    GLib.mkdir_with_parents(THUMB_DIR, 0o755);
    if (runCommand(['totem-video-thumbnailer', '-s', '640', input, output]))
        return output;
    if (runCommand(['ffmpeg', '-y', '-ss', '00:00:01', '-i', input, '-frames:v', '1', '-vf', 'scale=640:-1', output]))
        return output;
    return null;
}

function importVideoToLibrary(uri, libraryDir) {
    const source = Gio.File.new_for_uri(uri);
    const sourcePath = source.get_path();
    if (!sourcePath)
        return uri;

    GLib.mkdir_with_parents(libraryDir, 0o755);
    if (sourcePath.startsWith(`${libraryDir}/`))
        return uri;

    const basename = GLib.path_get_basename(sourcePath);
    const dot = basename.lastIndexOf('.');
    const stem = dot > 0 ? basename.slice(0, dot) : basename;
    const ext = dot > 0 ? basename.slice(dot) : '';

    for (let i = 0; i < 1000; i++) {
        const name = i === 0 ? basename : `${stem}-${i}${ext}`;
        const targetPath = GLib.build_filenamev([libraryDir, name]);
        if (GLib.file_test(targetPath, GLib.FileTest.EXISTS))
            continue;

        source.copy(Gio.File.new_for_path(targetPath), Gio.FileCopyFlags.NONE, null, null);
        return Gio.File.new_for_path(targetPath).get_uri();
    }

    return uri;
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
        this._addAction('settings', () => this._toggleSettings());
        this._addAction('about', () => this._showAbout());
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
            default_width: 1280,
            default_height: 720,
            icon_name: APP_ID,
        });

        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        this._window.set_content(root);

        const header = new Adw.HeaderBar();
        header.pack_start(this._iconButton('list-add-symbolic', 'Add video', () => this._chooseVideo()));
        header.pack_end(this._menuButton());
        header.pack_end(this._iconButton('emblem-system-symbolic', 'Settings', () => this._toggleSettings()));
        header.pack_end(this._iconButton('media-playback-stop-symbolic', 'Stop', () => this._callDaemon('StopRemote')));
        header.pack_end(this._iconButton('media-playback-pause-symbolic', 'Pause', () => this._callDaemon('PauseRemote')));
        header.pack_end(this._iconButton('media-playback-start-symbolic', 'Play', () => this._callDaemon('PlayRemote')));
        header.pack_end(this._iconButton('view-refresh-symbolic', 'Save and apply', () => this._saveAndApply()));
        header.pack_end(this._iconButton('system-run-symbolic', 'Start daemon', () => this._startDaemon()));
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

    _iconButton(iconName, tooltip, callback) {
        const button = new Gtk.Button({
            icon_name: iconName,
            tooltip_text: tooltip,
        });
        button.connect('clicked', callback);
        return button;
    }

    _menuButton() {
        const menu = new Gio.Menu();
        menu.append('Add Video', 'app.add-video');
        menu.append('Save and Apply', 'app.apply');
        menu.append('Start Daemon', 'app.start-daemon');
        menu.append('Settings', 'app.settings');
        menu.append('About Livedesk', 'app.about');

        const button = new Gtk.MenuButton({
            icon_name: 'open-menu-symbolic',
            tooltip_text: 'Menu',
        });
        button.set_menu_model(menu);
        return button;
    }

    _toggleSettings() {
        this._stack.visible_child_name = this._stack.visible_child_name === 'settings'
            ? 'gallery'
            : 'settings';
    }

    _galleryPage() {
        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
        });

        this._flow = new Gtk.FlowBox({
            valign: Gtk.Align.START,
            max_children_per_line: 4,
            min_children_per_line: 2,
            selection_mode: Gtk.SelectionMode.NONE,
            column_spacing: 16,
            row_spacing: 16,
            margin_top: 20,
            margin_bottom: 20,
            margin_start: 20,
            margin_end: 20,
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

        const libraryGroup = new Adw.PreferencesGroup({title: 'Library'});
        page.add(libraryGroup);
        libraryGroup.add(new Adw.ActionRow({
            title: 'Folder',
            subtitle: this._config.library_dir,
        }));
        this._selectedRow = new Adw.ActionRow({
            title: 'Selected video',
            subtitle: fileUriToPath(this._config.selected),
        });
        libraryGroup.add(this._selectedRow);

        const wallpaperGroup = new Adw.PreferencesGroup({title: 'Wallpaper'});
        page.add(wallpaperGroup);
        this._monitorEntry = new Adw.EntryRow({title: 'Monitor'});
        this._monitorEntry.text = firstMonitor;
        wallpaperGroup.add(this._monitorEntry);

        this._widthSpin = this._spin(firstConfig.width ?? 1920, 320, 16384);
        const widthRow = new Adw.ActionRow({title: 'Width'});
        widthRow.add_suffix(this._widthSpin);
        wallpaperGroup.add(widthRow);

        this._heightSpin = this._spin(firstConfig.height ?? 1080, 240, 16384);
        const heightRow = new Adw.ActionRow({title: 'Height'});
        heightRow.add_suffix(this._heightSpin);
        wallpaperGroup.add(heightRow);

        this._mutedSwitch = new Gtk.Switch({
            active: this._config.muted ?? true,
            valign: Gtk.Align.CENTER,
        });
        const mutedRow = new Adw.ActionRow({title: 'Mute audio'});
        mutedRow.add_suffix(this._mutedSwitch);
        mutedRow.activatable_widget = this._mutedSwitch;
        wallpaperGroup.add(mutedRow);

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

    _reloadGallery() {
        let child = this._flow.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._flow.remove(child);
            child = next;
        }

        const existing = [];
        for (const uri of this._config.library) {
            const path = fileUriToPath(uri);
            if (path !== uri && GLib.file_test(path, GLib.FileTest.EXISTS)) {
                existing.push(uri);
                this._flow.append(this._videoTile(uri));
            }
        }
        this._config.library = existing;
        this._flow.append(this._addTile());
    }

    _videoTile(uri) {
        const button = new Gtk.Button({
            width_request: TILE_WIDTH,
            height_request: TILE_HEIGHT,
            tooltip_text: fileUriToPath(uri),
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
        });

        const thumb = thumbnailForUri(uri);
        if (thumb) {
            const picture = new Gtk.Picture({
                file: Gio.File.new_for_path(thumb),
                width_request: THUMB_WIDTH,
                height_request: THUMB_HEIGHT,
                hexpand: true,
            });
            box.append(picture);
        } else {
            const image = new Gtk.Image({
                icon_name: 'video-x-generic-symbolic',
                pixel_size: 64,
                height_request: THUMB_HEIGHT,
                hexpand: true,
            });
            box.append(image);
        }

        const label = new Gtk.Label({
            label: displayNameForUri(uri),
            ellipsize: 3,
            xalign: 0,
        });
        box.append(label);

        if (this._config.selected === uri) {
            const selected = new Gtk.Label({
                label: 'Selected',
                xalign: 0,
                css_classes: ['dim-label'],
            });
            box.append(selected);
        }

        button.set_child(box);
        button.connect('clicked', () => {
            this._selectVideo(uri);
            this._saveAndApply();
        });
        return button;
    }

    _addTile() {
        const button = new Gtk.Button({
            width_request: TILE_WIDTH,
            height_request: TILE_HEIGHT,
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            spacing: 8,
        });
        box.append(new Gtk.Image({icon_name: 'list-add-symbolic', pixel_size: 36}));
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
                try {
                    const uri = importVideoToLibrary(dlg.get_file().get_uri(), this._config.library_dir);
                    if (!this._config.library.includes(uri))
                        this._config.library.unshift(uri);
                    this._selectVideo(uri);
                    this._saveConfigOnly();
                } catch (e) {
                    this._showError(`Failed to import video: ${e.message}`);
                }
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

    _showAbout() {
        const about = new Adw.AboutWindow({
            transient_for: this._window,
            application_name: 'Livedesk',
            application_icon: APP_ID,
            developer_name: 'TamKungZ_',
            version: '0.1.0',
            website: 'https://github.com/TamKungZ/Livedesk',
            issue_url: 'https://github.com/TamKungZ/Livedesk/issues',
            license_type: Gtk.License.GPL_3_0,
        });
        about.present();
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
