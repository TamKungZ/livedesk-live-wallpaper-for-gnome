#!/usr/bin/env -S gjs -m

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

const APP_ID = 'me.tamkungz.LivedeskApp';
const ICON_ID = 'me.tamkungz.Livedesk';
const DBUS_NAME = 'me.tamkungz.Livedesk';
const DBUS_PATH = '/me/tamkungz/Livedesk';
const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'livedesk']);
const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json']);
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'livedesk']);
const THUMB_DIR = GLib.build_filenamev([CACHE_DIR, 'thumbnails']);
const TILE_WIDTH = 210;
const TILE_HEIGHT = 154;
const THUMB_WIDTH = 190;
const THUMB_HEIGHT = 107;
const TILE_LABEL_CHARS = 24;
const GRID_MARGIN = 18;
const GRID_GAP = 24;
const APP_VERSION = '0.1.2';
const EXT_UUID = 'livedesk@me.tamkungz';
const SETUP_NOTICE_PATH = GLib.build_filenamev([CONFIG_DIR, `setup-notice-${APP_VERSION}`]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ogv']);

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
        titles: {},
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
        config.titles = config.titles && typeof config.titles === 'object' ? config.titles : {};
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

function titleForUri(config, uri) {
    return config.titles?.[uri] || displayNameForUri(uri);
}

function isVideoName(name) {
    const dot = name.lastIndexOf('.');
    if (dot < 0)
        return false;
    return VIDEO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function scanLibrary(config) {
    ensureDirs(config);

    const dir = Gio.File.new_for_path(config.library_dir);
    const uris = [];
    try {
        const enumerator = dir.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        for (;;) {
            const info = enumerator.next_file(null);
            if (!info)
                break;
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const name = info.get_name();
            if (isVideoName(name))
                uris.push(dir.get_child(name).get_uri());
        }
        enumerator.close(null);
    } catch (_) {
        return [];
    }

    uris.sort((a, b) => displayNameForUri(a).localeCompare(displayNameForUri(b)));
    return uris;
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

function commandSucceeds(args) {
    return runCommand(args);
}

function programExists(name) {
    return Boolean(GLib.find_program_in_path(name));
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

function thumbnailPreview(path) {
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        const preview = new Gtk.DrawingArea({
            width_request: THUMB_WIDTH,
            height_request: THUMB_HEIGHT,
            halign: Gtk.Align.CENTER,
            hexpand: false,
        });
        preview.set_size_request(THUMB_WIDTH, THUMB_HEIGHT);
        preview.set_draw_func((_area, cr, width, height) => {
            const scale = Math.max(width / pixbuf.get_width(), height / pixbuf.get_height());
            const scaledWidth = Math.ceil(pixbuf.get_width() * scale);
            const scaledHeight = Math.ceil(pixbuf.get_height() * scale);
            const scaled = pixbuf.scale_simple(
                scaledWidth,
                scaledHeight,
                GdkPixbuf.InterpType.BILINEAR
            );
            const x = Math.floor((width - scaledWidth) / 2);
            const y = Math.floor((height - scaledHeight) / 2);
            cr.rectangle(0, 0, width, height);
            cr.clip();
            Gdk.cairo_set_source_pixbuf(cr, scaled, x, y);
            cr.paint();
        });
        return preview;
    } catch (_) {
        return null;
    }
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
        this._importDialog = null;
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
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._bootstrapUserSession();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildActions() {
        this._addAction('add-video', () => this._chooseVideo());
        this._addAction('open-library', () => this._openLibrary());
        this._addAction('refresh-library', () => this._refreshLibrary());
        this._addAction('start-daemon', () => this._startDaemon());
        this._addAction('play', () => this._callDaemon('PlayRemote'));
        this._addAction('pause', () => this._callDaemon('PauseRemote'));
        this._addAction('stop', () => this._callDaemon('StopRemote'));
        this._addAction('set-default', () => this._setDefault());
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
        return this._monitorCombo?.get_active_id?.() || this._selectedMonitorName || 'monitor-0';
    }

    _activeMonitorConfig() {
        const monitor = this._selectedMonitor();
        return {
            uri: this._config.selected || '',
            width: monitor.width,
            height: monitor.height,
        };
    }

    _buildWindow() {
        this._config.library = scanLibrary(this._config);
        this._monitors = this._detectMonitors();
        const configuredMonitor = Object.keys(this._config.monitors ?? {})[0] ?? 'monitor-0';
        this._selectedMonitorName = this._monitors.some(monitor => monitor.name === configuredMonitor)
            ? configuredMonitor
            : (this._monitors[0]?.name ?? 'monitor-0');

        this._window = new Adw.ApplicationWindow({
            application: this,
            title: 'Livedesk',
            default_width: 1280,
            default_height: 720,
            icon_name: ICON_ID,
        });
        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        this._window.set_content(root);

        const header = new Adw.HeaderBar();
        this._backButton = this._iconButton('go-previous-symbolic', 'Back to library', () => this._showGallery());
        this._backButton.visible = false;
        header.pack_start(this._backButton);
        header.pack_start(this._iconButton('folder-open-symbolic', 'Open library folder', () => this._openLibrary()));
        header.pack_start(this._iconButton('list-add-symbolic', 'Import video', () => this._chooseVideo()));
        header.pack_end(this._iconButton('help-about-symbolic', 'About Livedesk', () => this._showAbout()));
        header.pack_end(this._iconButton('emblem-system-symbolic', 'Settings', () => this._toggleSettings()));
        header.pack_end(this._iconButton('view-refresh-symbolic', 'Refresh library', () => this._refreshLibrary()));
        header.pack_end(this._iconButton('media-playback-stop-symbolic', 'Stop', () => this._callDaemon('StopRemote')));
        header.pack_end(this._iconButton('media-playback-pause-symbolic', 'Pause', () => this._callDaemon('PauseRemote')));
        header.pack_end(this._iconButton('media-playback-start-symbolic', 'Play', () => this._callDaemon('PlayRemote')));
        root.append(header);

        const stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            vexpand: true,
        });
        root.append(stack);
        this._stack = stack;

        const footer = new Gtk.Box({
            halign: Gtk.Align.END,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 14,
            margin_start: 14,
            margin_end: 14,
        });
        this._footer = footer;
        this._setDefaultButton = new Gtk.Button({
            label: 'Set Default',
            sensitive: Boolean(this._config.selected),
        });
        this._setDefaultButton.connect('clicked', () => this._setDefault());
        footer.append(this._setDefaultButton);

        this._saveApplyButton = new Gtk.Button({label: 'Save and Apply'});
        this._saveApplyButton.add_css_class('suggested-action');
        this._saveApplyButton.connect('clicked', () => this._saveAndApply());
        footer.append(this._saveApplyButton);
        root.append(footer);

        stack.add_named(this._galleryPage(), 'gallery');
        stack.add_named(this._settingsPage(), 'settings');
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

    _toggleSettings() {
        if (this._stack.visible_child_name === 'settings')
            this._showGallery();
        else
            this._showSettings();
    }

    _showGallery() {
        this._stack.visible_child_name = 'gallery';
        this._backButton.visible = false;
        this._footer.visible = true;
    }

    _showSettings() {
        this._stack.visible_child_name = 'settings';
        this._backButton.visible = true;
        this._footer.visible = false;
    }

    _galleryPage() {
        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            hexpand: true,
            vexpand: true,
        });
        this._galleryScrolled = scrolled;

        this._flowBox = new Gtk.FlowBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.START,
            hexpand: true,
            selection_mode: Gtk.SelectionMode.NONE,
            min_children_per_line: 1,
            max_children_per_line: 1000,
            row_spacing: GRID_GAP,
            column_spacing: GRID_GAP,
            margin_top: GRID_MARGIN,
            margin_bottom: GRID_MARGIN,
            margin_start: GRID_MARGIN,
            margin_end: GRID_MARGIN,
        });
        scrolled.set_child(this._flowBox);
        this._reloadGallery();
        return scrolled;
    }

    _settingsPage() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            hexpand: true,
            vexpand: true,
        });

        const sidebarShell = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            width_request: 250,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });
        sidebarShell.append(new Gtk.SearchEntry({
            placeholder_text: 'Search...',
            sensitive: false,
        }));

        const settingsStack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
            hexpand: true,
            vexpand: true,
        });
        const sidebar = new Gtk.StackSidebar({stack: settingsStack});
        sidebar.vexpand = true;
        sidebarShell.append(sidebar);

        box.append(sidebarShell);
        box.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL}));
        box.append(settingsStack);

        settingsStack.add_titled(
            this._backgroundServicePage(),
            'background-service',
            'Background Service'
        );
        settingsStack.add_titled(this._librarySettingsPage(), 'library', 'Library');
        settingsStack.add_titled(this._wallpaperSettingsPage(), 'wallpaper', 'Wallpaper');
        settingsStack.add_titled(this._audioSettingsPage(), 'audio', 'Audio');
        settingsStack.visible_child_name = 'background-service';

        return box;
    }

    _settingsContentPage(title) {
        const page = new Adw.PreferencesPage({
            title,
            hexpand: true,
            vexpand: true,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 18,
            margin_end: 18,
        });
        return page;
    }

    _backgroundServicePage() {
        const page = this._settingsContentPage('Background Service');
        const group = new Adw.PreferencesGroup({title: 'Background Service'});
        page.add(group);

        this._serviceSwitch = this._settingsSwitchRow(
            group,
            'Enable service mode',
            'Livedesk keeps the video wallpaper daemon available in the background.',
            commandSucceeds(['systemctl', '--user', 'is-active', '--quiet', 'livedesk-daemon.service']),
            active => this._setServiceActive(active)
        );

        this._autostartSwitch = this._settingsSwitchRow(
            group,
            'Autostart on login',
            'Livedesk is launched at user session startup.',
            commandSucceeds(['systemctl', '--user', 'is-enabled', '--quiet', 'livedesk-daemon.service']),
            active => this._setAutostartActive(active)
        );

        return page;
    }

    _librarySettingsPage() {
        const page = this._settingsContentPage('Library');
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

        return page;
    }

    _wallpaperSettingsPage() {
        const page = this._settingsContentPage('Wallpaper');
        const wallpaperGroup = new Adw.PreferencesGroup({title: 'Wallpaper'});
        page.add(wallpaperGroup);

        this._monitorCombo = new Gtk.ComboBoxText({valign: Gtk.Align.CENTER});
        for (const monitor of this._monitors)
            this._monitorCombo.append(monitor.name, `${monitor.name} (${monitor.width}x${monitor.height})`);
        this._monitorCombo.set_active_id(this._selectedMonitorName);
        this._monitorCombo.connect('changed', () => {
            this._selectedMonitorName = this._activeMonitor();
            this._updateMonitorRows();
        });

        const monitorRow = new Adw.ActionRow({
            title: 'Monitor',
            subtitle: 'Detected from GNOME',
        });
        monitorRow.add_suffix(this._monitorCombo);
        monitorRow.activatable_widget = this._monitorCombo;
        wallpaperGroup.add(monitorRow);

        this._resolutionRow = new Adw.ActionRow({title: 'Resolution'});
        wallpaperGroup.add(this._resolutionRow);
        this._updateMonitorRows();

        return page;
    }

    _audioSettingsPage() {
        const page = this._settingsContentPage('Audio');
        const audioGroup = new Adw.PreferencesGroup({title: 'Audio'});
        page.add(audioGroup);

        this._mutedSwitch = new Gtk.Switch({
            active: this._config.muted ?? true,
            valign: Gtk.Align.CENTER,
        });
        const mutedRow = new Adw.ActionRow({title: 'Mute audio'});
        mutedRow.add_suffix(this._mutedSwitch);
        mutedRow.activatable_widget = this._mutedSwitch;
        audioGroup.add(mutedRow);

        return page;
    }

    _settingsSwitchRow(group, title, subtitle, active, onChanged) {
        const row = new Adw.ActionRow({title, subtitle});
        const widget = new Gtk.Switch({
            active,
            valign: Gtk.Align.CENTER,
        });
        widget.connect('notify::active', () => onChanged(widget.active));
        row.add_suffix(widget);
        row.activatable_widget = widget;
        group.add(row);
        return widget;
    }

    _bootstrapUserSession() {
        let needsSessionRestart = false;

        if (programExists('systemctl')) {
            runCommand(['systemctl', '--user', 'daemon-reload']);
            runCommand(['systemctl', '--user', 'enable', '--now', 'livedesk-daemon.service']);
        }

        if (programExists('gnome-extensions')) {
            if (runCommand(['gnome-extensions', 'info', EXT_UUID]))
                runCommand(['gnome-extensions', 'enable', EXT_UUID]);
            else
                needsSessionRestart = true;
        }

        this._connectProxy();
        this._refreshServiceSwitches();

        if (needsSessionRestart && !GLib.file_test(SETUP_NOTICE_PATH, GLib.FileTest.EXISTS)) {
            GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
            GLib.file_set_contents(SETUP_NOTICE_PATH, `${new Date().toISOString()}\n`);
            this._showError('Livedesk was installed and the background service was enabled. Log out and back in once so GNOME Shell can discover the extension, then open Livedesk again.');
        }
    }

    _refreshServiceSwitches() {
        if (this._serviceSwitch)
            this._serviceSwitch.active = commandSucceeds(['systemctl', '--user', 'is-active', '--quiet', 'livedesk-daemon.service']);
        if (this._autostartSwitch)
            this._autostartSwitch.active = commandSucceeds(['systemctl', '--user', 'is-enabled', '--quiet', 'livedesk-daemon.service']);
    }

    _detectMonitors() {
        const monitors = [];
        const display = Gdk.Display.get_default();
        const model = display?.get_monitors?.();

        if (model) {
            for (let i = 0; i < model.get_n_items(); i++) {
                const monitor = model.get_item(i);
                const geometry = monitor.get_geometry();
                monitors.push({
                    name: `monitor-${i}`,
                    width: geometry.width,
                    height: geometry.height,
                });
            }
        }

        if (monitors.length === 0)
            monitors.push({name: 'monitor-0', width: 1920, height: 1080});
        return monitors;
    }

    _selectedMonitor() {
        return this._monitors.find(monitor => monitor.name === this._activeMonitor())
            ?? this._monitors[0]
            ?? {name: 'monitor-0', width: 1920, height: 1080};
    }

    _updateMonitorRows() {
        if (!this._resolutionRow)
            return;
        const monitor = this._selectedMonitor();
        this._resolutionRow.subtitle = `${monitor.width} x ${monitor.height}`;
    }

    _reloadGallery() {
        this._config.library = scanLibrary(this._config);
        if (this._config.selected && !this._config.library.includes(this._config.selected))
            this._config.selected = this._config.library[0] ?? '';

        if (this._selectedRow)
            this._selectedRow.subtitle = fileUriToPath(this._config.selected);
        this._updateActionButtons();

        if (!this._flowBox)
            return;

        let child = this._flowBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._flowBox.remove(child);
            child = next;
        }

        const tiles = this._config.library.length > 0
            ? this._config.library.map(uri => this._videoTile(uri))
            : [this._emptyLibraryTile()];

        for (const tile of tiles)
            this._flowBox.insert(tile, -1);
    }

    _videoTile(uri) {
        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            width_request: TILE_WIDTH,
            height_request: TILE_HEIGHT,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
            halign: Gtk.Align.START,
            valign: Gtk.Align.START,
            hexpand: false,
            vexpand: false,
        });
        card.set_size_request(TILE_WIDTH, TILE_HEIGHT);

        const thumb = thumbnailForUri(uri);
        let preview;
        if (thumb) {
            preview = thumbnailPreview(thumb);
        }
        if (!preview) {
            preview = new Gtk.Image({
                icon_name: 'video-x-generic-symbolic',
                pixel_size: 36,
                width_request: THUMB_WIDTH,
                height_request: THUMB_HEIGHT,
                halign: Gtk.Align.CENTER,
                hexpand: false,
            });
            preview.set_size_request(THUMB_WIDTH, THUMB_HEIGHT);
        }
        preview.tooltip_text = 'Double-click to use this video';
        preview.add_controller(this._doubleClick(() => {
            this._selectVideo(uri);
            this._playSelected();
        }));
        card.append(preview);

        const label = new Gtk.Label({
            label: titleForUri(this._config, uri),
            ellipsize: 3,
            justify: Gtk.Justification.CENTER,
            xalign: 0.5,
            width_chars: TILE_LABEL_CHARS,
            max_width_chars: TILE_LABEL_CHARS,
            width_request: THUMB_WIDTH,
        });
        label.tooltip_text = 'Double-click to edit title';
        label.add_controller(this._doubleClick(() => this._editTitle(uri)));
        card.append(label);

        if (this._config.selected === uri) {
            const selected = new Gtk.Label({
                label: 'Selected',
                justify: Gtk.Justification.CENTER,
                xalign: 0.5,
                width_chars: TILE_LABEL_CHARS,
                max_width_chars: TILE_LABEL_CHARS,
                width_request: THUMB_WIDTH,
                css_classes: ['dim-label'],
            });
            card.append(selected);
        }

        return card;
    }

    _emptyLibraryTile() {
        const button = new Gtk.Button({
            width_request: TILE_WIDTH,
            height_request: TILE_HEIGHT,
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            spacing: 6,
        });
        box.append(new Gtk.Image({icon_name: 'folder-open-symbolic', pixel_size: 28}));
        box.append(new Gtk.Label({label: 'Open folder'}));
        button.set_child(box);
        button.connect('clicked', () => this._openLibrary());
        return button;
    }

    _doubleClick(callback) {
        const gesture = new Gtk.GestureClick({button: 1});
        gesture.connect('pressed', (_gesture, nPress) => {
            if (nPress === 2)
                callback();
        });
        return gesture;
    }

    _editTitle(uri) {
        const dialog = new Gtk.Dialog({
            title: 'Edit title',
            transient_for: this._window,
            modal: true,
        });
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Save', Gtk.ResponseType.ACCEPT);

        const entry = new Gtk.Entry({
            text: titleForUri(this._config, uri),
            activates_default: true,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        dialog.set_default_response(Gtk.ResponseType.ACCEPT);
        dialog.get_content_area().append(entry);

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                try {
                    this._applyTitle(uri, entry.text);
                } catch (e) {
                    this._showError(`Failed to save title: ${e.message}`);
                }
            }
            dlg.destroy();
        });
        dialog.present();
    }

    _applyTitle(uri, requestedTitle) {
        const title = requestedTitle.trim();
        this._config.titles = this._config.titles ?? {};
        if (!title || title === displayNameForUri(uri))
            delete this._config.titles[uri];
        else
            this._config.titles[uri] = title;
        this._saveConfigOnly();
        this._reloadGallery();
    }

    _selectVideo(uri) {
        this._config.selected = uri;
        if (this._selectedRow)
            this._selectedRow.subtitle = fileUriToPath(uri);
        this._updateActionButtons();
        this._reloadGallery();
    }

    _chooseVideo() {
        if (this._importDialog) {
            this._importDialog.show();
            return;
        }

        const dialog = new Gtk.FileChooserNative({
            title: 'Select a video',
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this._window,
            modal: true,
        });
        this._importDialog = dialog;

        const filter = new Gtk.FileFilter();
        filter.set_name('Video files');
        filter.add_mime_type('video/*');
        dialog.add_filter(filter);

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                try {
                    const uri = importVideoToLibrary(dlg.get_file().get_uri(), this._config.library_dir);
                    this._selectVideo(uri);
                    this._saveConfigOnly();
                } catch (e) {
                    this._showError(`Failed to import video: ${e.message}`);
                }
            }
            dlg.destroy();
            if (this._importDialog === dialog)
                this._importDialog = null;
        });
        dialog.show();
    }

    _openLibrary() {
        ensureDirs(this._config);
        try {
            Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(this._config.library_dir).get_uri(),
                null
            );
        } catch (e) {
            this._showError(`Failed to open library folder: ${e.message}`);
        }
    }

    _refreshLibrary() {
        this._config.library = scanLibrary(this._config);
        if (this._flowBox)
            this._reloadGallery();
        this._saveConfigOnly();
    }

    _updateActionButtons() {
        if (this._setDefaultButton)
            this._setDefaultButton.sensitive = Boolean(this._config.selected);
    }

    _setDefault() {
        if (!this._config.selected)
            return;
        this._saveConfigOnly();
    }

    _saveConfigOnly() {
        const monitor = this._activeMonitor();
        this._config.monitors = this._config.monitors ?? {};
        this._config.monitors[monitor] = this._activeMonitorConfig();
        this._config.muted = this._mutedSwitch?.active ?? this._config.muted ?? true;
        saveConfig(this._config);
    }

    _startDaemon() {
        try {
            this._setServiceActive(true);
            this._connectProxy();
        } catch (e) {
            this._showError(`Failed to start daemon: ${e.message}`);
        }
    }

    _setServiceActive(active) {
        try {
            GLib.spawn_async(
                null,
                ['systemctl', '--user', active ? 'start' : 'stop', 'livedesk-daemon.service'],
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
            if (active)
                this._connectProxy();
        } catch (e) {
            this._showError(`Failed to ${active ? 'start' : 'stop'} service: ${e.message}`);
        }
    }

    _setAutostartActive(active) {
        try {
            GLib.spawn_async(
                null,
                ['systemctl', '--user', active ? 'enable' : 'disable', 'livedesk-daemon.service'],
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
        } catch (e) {
            this._showError(`Failed to update autostart: ${e.message}`);
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
        this._proxy.SetMutedRemote(monitor, this._mutedSwitch?.active ?? this._config.muted ?? true);
        if (uri)
            this._proxy.PlayRemote(monitor);
    }

    _playSelected() {
        this._connectProxy();
        if (!this._proxy || !this._config.selected)
            return;

        const monitor = this._activeMonitor();
        this._proxy.SetSourceRemote(monitor, this._config.selected);
        this._proxy.SetMutedRemote(monitor, this._mutedSwitch?.active ?? this._config.muted ?? true);
        this._proxy.PlayRemote(monitor);
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
            application_icon: ICON_ID,
            developer_name: 'TamKungZ_',
            version: APP_VERSION,
            website: 'https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome',
            issue_url: 'https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome/issues',
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
