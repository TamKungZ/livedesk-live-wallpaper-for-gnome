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
const LOG_PATH = GLib.build_filenamev([CACHE_DIR, 'livedesk.log']);
const THUMB_DIR = GLib.build_filenamev([CACHE_DIR, 'thumbnails']);
const STILL_DIR = GLib.build_filenamev([CACHE_DIR, 'stills']);
const TILE_WIDTH = 210;
const TILE_HEIGHT = 154;
const THUMB_WIDTH = 190;
const THUMB_HEIGHT = 107;
const TILE_LABEL_CHARS = 24;
const GRID_MARGIN = 18;
const GRID_GAP = 24;
const APP_VERSION = '1.0.0';
const LIVEDESK_SCHEMA_ID = 'me.tamkungz.Livedesk';
const GNOME_BACKGROUND_SCHEMA_ID = 'org.gnome.desktop.background';
const GNOME_SCREENSAVER_SCHEMA_ID = 'org.gnome.desktop.screensaver';
const PICTURE_URI_KEY = 'picture-uri';
const PICTURE_URI_DARK_KEY = 'picture-uri-dark';
const VIDEO_URI_KEY = 'video-uri';
const STILL_URI_KEY = 'still-uri';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ogv']);

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
    GLib.mkdir_with_parents(STILL_DIR, 0o755);
    GLib.mkdir_with_parents(config.library_dir, 0o755);
}

function defaultConfig() {
    return {
        library_dir: defaultLibraryDir(),
        library: [],
        titles: {},
        selected: '',
        previous_background_uri: '',
        previous_background_uri_dark: '',
        previous_screensaver_uri: '',
        still_uri: '',
        muted: true,
        service_mode_disabled: false,
        autostart_disabled: false,
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
        config.service_mode_disabled = Boolean(config.service_mode_disabled);
        config.autostart_disabled = Boolean(config.autostart_disabled);
        config.previous_background_uri = config.previous_background_uri || '';
        config.previous_background_uri_dark = config.previous_background_uri_dark || '';
        config.previous_screensaver_uri = config.previous_screensaver_uri || '';
        config.still_uri = config.still_uri || '';

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

function stillPathForUri(uri) {
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, uri, -1);
    return GLib.build_filenamev([STILL_DIR, `${hash}.png`]);
}

function runCommand(args) {
    return runCommandWithOutput(args).ok;
}

function runCommandWithOutput(args) {
    try {
        const [ok, stdout, stderr, status] = GLib.spawn_sync(
            null,
            args,
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );
        return {
            ok: ok && status === 0,
            stdout: new TextDecoder().decode(stdout ?? new Uint8Array()),
            stderr: new TextDecoder().decode(stderr ?? new Uint8Array()),
            status,
        };
    } catch (e) {
        return {
            ok: false,
            stdout: '',
            stderr: e.message,
            status: -1,
        };
    }
}

function appendLog(message) {
    const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H:%M:%S');
    const line = `[${stamp}] ${message}\n`;
    try {
        GLib.mkdir_with_parents(CACHE_DIR, 0o755);
        const file = Gio.File.new_for_path(LOG_PATH);
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(new TextEncoder().encode(line), null);
        stream.close(null);
    } catch (_) {
    }
    print(`livedesk: ${message}`);
}

function commandLine(args) {
    return args.map(arg => arg.includes(' ') ? `'${arg}'` : arg).join(' ');
}

function commandResultText(args, result) {
    return [
        `$ ${commandLine(args)}`,
        `status=${result.status} ok=${result.ok}`,
        result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : '',
        result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : '',
    ].filter(Boolean).join('\n');
}

function appendCommandResult(args, result) {
    appendLog(commandResultText(args, result));
}

function commandSucceeds(args) {
    return runCommand(args);
}

function programExists(name) {
    return Boolean(GLib.find_program_in_path(name));
}

function livedeskSettings() {
    try {
        return new Gio.Settings({schema_id: LIVEDESK_SCHEMA_ID});
    } catch (_) {
        return null;
    }
}

function gnomeBackgroundSettings() {
    try {
        return new Gio.Settings({schema_id: GNOME_BACKGROUND_SCHEMA_ID});
    } catch (_) {
        return null;
    }
}

function gnomeScreensaverSettings() {
    try {
        return new Gio.Settings({schema_id: GNOME_SCREENSAVER_SCHEMA_ID});
    } catch (_) {
        return null;
    }
}

function settingsString(settings, key) {
    try {
        return settings.get_string(key);
    } catch (_) {
        return '';
    }
}

function setSettingsString(settings, key, value) {
    try {
        settings.set_string(key, value);
    } catch (_) {
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

function stillForUri(uri) {
    const input = fileUriToPath(uri);
    const output = stillPathForUri(uri);
    if (GLib.file_test(output, GLib.FileTest.EXISTS)) {
        appendLog(`Still fallback already cached: ${output}`);
        return output;
    }
    if (!input || input === uri || !GLib.file_test(input, GLib.FileTest.EXISTS))
        return null;

    GLib.mkdir_with_parents(STILL_DIR, 0o755);
    appendLog(`Generating still fallback from first video frame: ${input}`);
    const ffmpegArgs = ['ffmpeg', '-y', '-ss', '00:00:00', '-i', input, '-frames:v', '1', '-vf', 'scale=1920:-1', output];
    const ffmpegResult = runCommandWithOutput(ffmpegArgs);
    appendCommandResult(ffmpegArgs, ffmpegResult);
    if (ffmpegResult.ok) {
        appendLog(`Still fallback written: ${output}`);
        return output;
    }
    const thumbnailerArgs = ['totem-video-thumbnailer', '-s', '1920', input, output];
    const thumbnailerResult = runCommandWithOutput(thumbnailerArgs);
    appendCommandResult(thumbnailerArgs, thumbnailerResult);
    if (thumbnailerResult.ok) {
        appendLog(`Still fallback written: ${output}`);
        return output;
    }

    appendLog(`Still fallback failed for: ${input}`);
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
        this._startTrayIcon();
        this._window.present();
        appendLog('app started');
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._bootstrapUserSession();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildActions() {
        this._addAction('add-video', 'Import video', () => this._chooseVideo());
        this._addAction('open-library', 'Open library folder', () => this._openLibrary());
        this._addAction('refresh-library', 'Refresh library', () => this._refreshLibrary());
        this._addAction('start-daemon', 'Start daemon', () => this._startDaemon());
        this._addAction('play', 'Play selected wallpaper', () => this._callDaemon('PlayRemote'));
        this._addAction('pause', 'Pause wallpaper playback', () => this._callDaemon('PauseRemote'));
        this._addAction('stop', 'Restore normal wallpaper', () => this._restoreWallpaper());
        this._addAction('set-default', 'Save selected video as default', () => this._setDefault());
        this._addAction('apply', 'Save and apply selected video', () => this._saveAndApply());
        this._addAction('settings', 'Toggle settings', () => this._toggleSettings());
        this._addAction('about', 'Show about window', () => this._showAbout());
    }

    _addAction(name, label, callback) {
        const action = new Gio.SimpleAction({name});
        action.connect('activate', () => {
            this._logAction(`Action: ${label}`);
            callback();
        });
        this.add_action(action);
    }

    _connectProxy() {
        try {
            this._proxy = new LivedeskProxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH);
            appendLog('Connected to daemon D-Bus proxy');
        } catch (_) {
            this._proxy = null;
            appendLog('Daemon D-Bus proxy unavailable');
        }
    }

    _startTrayIcon() {
        const installed = GLib.find_program_in_path('livedesk-tray');
        const local = GLib.build_filenamev([GLib.get_current_dir(), 'app', 'livedesk-tray.js']);
        const args = installed
            ? ['livedesk-tray']
            : (GLib.file_test(local, GLib.FileTest.EXISTS) ? ['gjs', local] : null);

        if (!args) {
            appendLog('Tray icon skipped: livedesk-tray helper not found');
            return;
        }

        try {
            GLib.spawn_async(
                null,
                args,
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
            appendLog(`Tray icon helper spawned: ${args.join(' ')}`);
        } catch (e) {
            appendLog(`Tray icon helper failed: ${e.message}`);
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
        header.pack_end(this._iconButton('user-desktop-symbolic', 'Restore normal wallpaper', () => this._restoreWallpaper()));
        header.pack_end(this._iconButton('media-playback-stop-symbolic', 'Stop and restore normal wallpaper', () => this._restoreWallpaper()));
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
        this._setDefaultButton.connect('clicked', () => {
            this._logAction('Button: Set Default');
            this._setDefault();
        });
        footer.append(this._setDefaultButton);

        this._saveApplyButton = new Gtk.Button({label: 'Save and Apply'});
        this._saveApplyButton.add_css_class('suggested-action');
        this._saveApplyButton.connect('clicked', () => {
            this._logAction('Button: Save and Apply');
            this._saveAndApply();
        });
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
        button.connect('clicked', () => {
            this._logAction(`Button: ${tooltip}`);
            callback();
        });
        return button;
    }

    _toggleSettings() {
        if (this._stack.visible_child_name === 'settings')
            this._showGallery();
        else
            this._showSettings();
    }

    _showGallery() {
        this._logAction('View: gallery');
        this._stack.visible_child_name = 'gallery';
        this._backButton.visible = false;
        this._footer.visible = true;
    }

    _showSettings() {
        this._logAction('View: settings');
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

        const setupRow = new Adw.ActionRow({
            title: 'Setup current session',
            subtitle: 'Starts the daemon and checks whether GNOME Shell is using the Livedesk-native background patch.',
        });
        const setupButton = new Gtk.Button({
            label: 'Run Setup',
            valign: Gtk.Align.CENTER,
        });
        setupButton.add_css_class('suggested-action');
        setupButton.connect('clicked', () => {
            this._logAction('Button: Run Setup');
            this._runSetupHelper();
        });
        setupRow.add_suffix(setupButton);
        setupRow.activatable_widget = setupButton;
        group.add(setupRow);

        this._setupStatusRow = new Adw.ActionRow({
            title: 'User action needed',
            subtitle: this._setupStatusText(),
        });
        group.add(this._setupStatusRow);

        this._lastActionRow = new Adw.ActionRow({
            title: 'Last action',
            subtitle: `Log file: ${LOG_PATH}`,
        });
        group.add(this._lastActionRow);

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
        widget.connect('notify::active', () => {
            if (!this._updatingServiceSwitches) {
                this._logAction(`Switch: ${title} -> ${widget.active ? 'on' : 'off'}`);
                onChanged(widget.active);
            }
        });
        row.add_suffix(widget);
        row.activatable_widget = widget;
        group.add(row);
        return widget;
    }

    _bootstrapUserSession() {
        this._logAction('Checking user session services');
        if (programExists('systemctl')) {
            this._runLoggedCommand(['systemctl', '--user', 'daemon-reload']);
            if (!this._config.service_mode_disabled) {
                if (!this._config.autostart_disabled) {
                    if (commandSucceeds(['systemctl', '--user', 'is-enabled', '--quiet', 'livedesk-daemon.service']))
                        this._logAction('Autostart already enabled');
                    else
                        this._runLoggedCommand(['systemctl', '--user', 'enable', 'livedesk-daemon.service']);
                }

                if (commandSucceeds(['systemctl', '--user', 'is-active', '--quiet', 'livedesk-daemon.service']))
                    this._logAction('Livedesk daemon already running');
                else
                    this._runLoggedCommand(['systemctl', '--user', 'start', 'livedesk-daemon.service']);
            }
        }

        this._connectProxy();
        this._refreshServiceSwitches();
        this._refreshSetupStatus();

        const message = this._setupNeedsActionText();
        if (message)
            this._showError(message);
    }

    _refreshServiceSwitches() {
        this._updatingServiceSwitches = true;
        if (this._serviceSwitch)
            this._serviceSwitch.active = commandSucceeds(['systemctl', '--user', 'is-active', '--quiet', 'livedesk-daemon.service']);
        if (this._autostartSwitch)
            this._autostartSwitch.active = commandSucceeds(['systemctl', '--user', 'is-enabled', '--quiet', 'livedesk-daemon.service']);
        this._updatingServiceSwitches = false;
    }

    _nativeShellConfigured() {
        const result = runCommandWithOutput(['livedesk-setup', '--check-native']);
        return result.ok;
    }

    _setupState() {
        const hasSystemctl = programExists('systemctl');
        const serviceActive = hasSystemctl
            && commandSucceeds(['systemctl', '--user', 'is-active', '--quiet', 'livedesk-daemon.service']);
        const autostartEnabled = hasSystemctl
            && commandSucceeds(['systemctl', '--user', 'is-enabled', '--quiet', 'livedesk-daemon.service']);
        const nativeShellConfigured = programExists('livedesk-setup')
            && this._nativeShellConfigured();

        return {
            hasSystemctl,
            serviceActive,
            autostartEnabled,
            nativeShellConfigured,
        };
    }

    _setupNeedsActionText() {
        const state = this._setupState();
        const actions = [];

        if (!state.hasSystemctl) {
            actions.push('systemctl is not available. Install user systemd support, then run livedesk-setup.');
        } else {
            if (!state.serviceActive && !this._config.service_mode_disabled)
                actions.push('Start the background service with Run Setup, Enable service mode, or livedesk-setup.');
            if (!state.autostartEnabled && !this._config.autostart_disabled)
                actions.push('Enable Autostart on login, or run livedesk-setup.');
        }

        if (!state.nativeShellConfigured)
            actions.push('Run setup, then log out and back in once so GNOME Shell starts with the Livedesk-native background patch.');

        if (actions.length === 0)
            return '';
        return actions.join('\n\n');
    }

    _setupStatusText() {
        const state = this._setupState();
        if (!state.hasSystemctl)
            return 'Run livedesk-setup in a terminal after installing user systemd support.';
        if (!state.nativeShellConfigured)
            return 'Run setup, then log out and back in once so GNOME Shell uses the native background patch.';
        if (!state.serviceActive && !this._config.service_mode_disabled)
            return 'Run setup or enable service mode to start the background daemon.';
        if (!state.autostartEnabled && !this._config.autostart_disabled)
            return 'Enable Autostart on login, or run setup again.';
        return 'Setup is complete. Pick a video and click Save and Apply.';
    }

    _refreshSetupStatus() {
        if (this._setupStatusRow)
            this._setupStatusRow.subtitle = this._setupStatusText();
    }

    _runSetupHelper() {
        this._logAction('Running livedesk-setup');
        const result = programExists('livedesk-setup')
            ? runCommandWithOutput(['livedesk-setup'])
            : {ok: false, stdout: '', stderr: 'livedesk-setup was not found in PATH.', status: -1};
        this._logCommandResult(['livedesk-setup'], result);

        if (result.ok) {
            this._config.service_mode_disabled = false;
            this._config.autostart_disabled = false;
            this._saveConfigOnly();
        }

        this._connectProxy();
        this._refreshServiceSwitches();
        this._refreshSetupStatus();

        if (result.ok) {
            this._showError(this._setupNeedsActionText() || 'Setup is complete. Pick a video and click Save and Apply.');
            return;
        }

        const detail = (result.stderr || result.stdout || `Exit status ${result.status}`).trim();
        this._showError(`Setup could not finish automatically.\n\n${detail}\n\nYou can still run livedesk-setup in a terminal, then log out and back in so GNOME Shell sees the native background patch.`);
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
            this._logAction(`Tile double-click: ${displayNameForUri(uri)}`);
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
        label.add_controller(this._doubleClick(() => {
            this._logAction(`Title double-click: ${displayNameForUri(uri)}`);
            this._editTitle(uri);
        }));
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
        button.connect('clicked', () => {
            this._logAction('Button: Open library from empty gallery');
            this._openLibrary();
        });
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
        this._logAction(`Saving title for ${displayNameForUri(uri)}: ${title || '(default)'}`);
        this._config.titles = this._config.titles ?? {};
        if (!title || title === displayNameForUri(uri))
            delete this._config.titles[uri];
        else
            this._config.titles[uri] = title;
        this._saveConfigOnly();
        this._reloadGallery();
    }

    _selectVideo(uri) {
        this._logAction(`Selected video: ${fileUriToPath(uri)}`);
        this._config.selected = uri;
        if (this._selectedRow)
            this._selectedRow.subtitle = fileUriToPath(uri);
        this._updateActionButtons();
        this._reloadGallery();
    }

    _chooseVideo() {
        if (this._importDialog) {
            this._logAction('Import dialog already open');
            this._importDialog.show();
            return;
        }
        this._logAction('Opening video import dialog');

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
                    this._logAction(`Imported video: ${fileUriToPath(uri)}`);
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
        this._logAction(`Opening library folder: ${this._config.library_dir}`);
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
        this._logAction('Refreshing video library');
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
        if (!this._config.selected) {
            this._logAction('Set Default ignored: no selected video');
            return;
        }
        this._logAction(`Saving default video: ${fileUriToPath(this._config.selected)}`);
        this._saveConfigOnly();
    }

    _saveConfigOnly() {
        const monitor = this._activeMonitor();
        this._config.monitors = this._config.monitors ?? {};
        this._config.monitors[monitor] = this._activeMonitorConfig();
        this._config.muted = this._mutedSwitch?.active ?? this._config.muted ?? true;
        saveConfig(this._config);
        appendLog(`Saved config: monitor=${monitor} muted=${this._config.muted} selected=${fileUriToPath(this._config.selected)}`);
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
            this._logAction(active ? 'Enabling service mode' : 'Disabling service mode');
            this._config.service_mode_disabled = !active;
            this._saveConfigOnly();
            if (active) {
                this._runLoggedCommand(['systemctl', '--user', 'start', 'livedesk-daemon.service']);
                this._connectProxy();
            } else {
                this._runLoggedCommand(['systemctl', '--user', 'stop', 'livedesk-daemon.service']);
            }
            this._refreshSetupStatus();
        } catch (e) {
            this._showError(`Failed to ${active ? 'start' : 'stop'} service: ${e.message}`);
        }
    }

    _setAutostartActive(active) {
        try {
            this._logAction(active ? 'Enabling autostart' : 'Disabling autostart');
            this._config.autostart_disabled = !active;
            this._saveConfigOnly();
            if (active) {
                this._runLoggedCommand(['systemctl', '--user', 'enable', 'livedesk-daemon.service']);
            } else {
                this._runLoggedCommand(['systemctl', '--user', 'disable', 'livedesk-daemon.service']);
            }
            this._refreshSetupStatus();
        } catch (e) {
            this._showError(`Failed to update autostart: ${e.message}`);
        }
    }

    _saveAndApply() {
        this._logAction(`Applying selected video: ${fileUriToPath(this._config.selected)}`);
        this._saveConfigOnly();
        this._applyGnomeBackground(this._config.selected);
        this._connectProxy();

        if (!this._proxy) {
            this._showError(`Saved ${CONFIG_PATH}. Start the daemon to apply it now.`);
            return;
        }

        const monitor = this._activeMonitor();
        const uri = this._config.selected;
        const monitorConfig = this._activeMonitorConfig();
        if (uri) {
            this._logAction(`D-Bus: SetMonitorSource monitor=${monitor} size=${monitorConfig.width}x${monitorConfig.height}`);
            this._proxy.SetMonitorSourceRemote(
                monitor,
                uri,
                monitorConfig.width,
                monitorConfig.height
            );
        }
        this._logAction(`D-Bus: SetMuted monitor=${monitor} muted=${this._mutedSwitch?.active ?? this._config.muted ?? true}`);
        this._proxy.SetMutedRemote(monitor, this._mutedSwitch?.active ?? this._config.muted ?? true);
        if (uri) {
            this._logAction(`D-Bus: Play monitor=${monitor}`);
            this._proxy.PlayRemote(monitor);
        }
    }

    _playSelected() {
        this._logAction(`Playing selected video: ${fileUriToPath(this._config.selected)}`);
        this._saveConfigOnly();
        this._applyGnomeBackground(this._config.selected);
        this._connectProxy();
        if (!this._proxy || !this._config.selected)
            return;

        const monitor = this._activeMonitor();
        const monitorConfig = this._activeMonitorConfig();
        this._logAction(`D-Bus: SetMonitorSource monitor=${monitor} size=${monitorConfig.width}x${monitorConfig.height}`);
        this._proxy.SetMonitorSourceRemote(
            monitor,
            this._config.selected,
            monitorConfig.width,
            monitorConfig.height
        );
        this._logAction(`D-Bus: SetMuted monitor=${monitor} muted=${this._mutedSwitch?.active ?? this._config.muted ?? true}`);
        this._proxy.SetMutedRemote(monitor, this._mutedSwitch?.active ?? this._config.muted ?? true);
        this._logAction(`D-Bus: Play monitor=${monitor}`);
        this._proxy.PlayRemote(monitor);
    }

    _callDaemon(method) {
        this._logAction(`D-Bus requested: ${method}`);
        if (method === 'PlayRemote')
            this._applyGnomeBackground(this._config.selected);
        this._connectProxy();
        if (!this._proxy) {
            this._showError('Daemon is not available.');
            return;
        }
        this._logAction(`D-Bus: ${method} monitor=${this._activeMonitor()}`);
        this._proxy[method](this._activeMonitor());
    }

    _applyGnomeBackground(uri) {
        if (!uri)
            return;

        const settings = gnomeBackgroundSettings();
        if (!settings) {
            this._showError('GNOME background settings are not available.');
            return;
        }

        const current = settingsString(settings, PICTURE_URI_KEY);
        const currentDark = settingsString(settings, PICTURE_URI_DARK_KEY);
        const still = stillForUri(uri);
        const stillUri = still ? Gio.File.new_for_path(still).get_uri() : '';
        const visibleUri = stillUri || uri;

        if (current && current !== uri && current !== stillUri && !isVideoName(current))
            this._config.previous_background_uri = current;
        if (currentDark && currentDark !== uri && currentDark !== stillUri && !isVideoName(currentDark))
            this._config.previous_background_uri_dark = currentDark;

        this._logAction(`GNOME background picture-uri -> ${visibleUri}`);
        setSettingsString(settings, PICTURE_URI_KEY, visibleUri);
        setSettingsString(settings, PICTURE_URI_DARK_KEY, visibleUri);

        this._config.still_uri = stillUri;
        const screensaver = gnomeScreensaverSettings();
        if (stillUri && screensaver) {
            const currentScreensaver = settingsString(screensaver, PICTURE_URI_KEY);
            if (currentScreensaver && currentScreensaver !== stillUri)
                this._config.previous_screensaver_uri = currentScreensaver;
            this._logAction(`GNOME screensaver picture-uri -> ${this._config.still_uri}`);
            setSettingsString(screensaver, PICTURE_URI_KEY, this._config.still_uri);
        }

        const lsettings = livedeskSettings();
        if (lsettings) {
            this._logAction(`Livedesk video-uri -> ${uri}`);
            setSettingsString(lsettings, VIDEO_URI_KEY, uri);
            setSettingsString(lsettings, STILL_URI_KEY, stillUri);
            lsettings.set_boolean('muted', this._mutedSwitch?.active ?? this._config.muted ?? true);
        }

        this._saveConfigOnly();
    }

    _restoreWallpaper() {
        this._logAction('Restoring previous normal wallpaper');
        const settings = gnomeBackgroundSettings();
        if (settings) {
            if (this._config.previous_background_uri) {
                this._logAction(`GNOME background picture-uri -> ${this._config.previous_background_uri}`);
                setSettingsString(settings, PICTURE_URI_KEY, this._config.previous_background_uri);
            }
            if (this._config.previous_background_uri_dark) {
                this._logAction(`GNOME background picture-uri-dark -> ${this._config.previous_background_uri_dark}`);
                setSettingsString(settings, PICTURE_URI_DARK_KEY, this._config.previous_background_uri_dark);
            }
        }

        const screensaver = gnomeScreensaverSettings();
        if (screensaver && this._config.previous_screensaver_uri) {
            this._logAction(`GNOME screensaver picture-uri -> ${this._config.previous_screensaver_uri}`);
            setSettingsString(screensaver, PICTURE_URI_KEY, this._config.previous_screensaver_uri);
        }

        const lsettings = livedeskSettings();
        if (lsettings) {
            this._logAction('Livedesk video-uri -> (empty)');
            setSettingsString(lsettings, VIDEO_URI_KEY, '');
            setSettingsString(lsettings, STILL_URI_KEY, '');
        }

        this._connectProxy();
        if (this._proxy) {
            for (const monitor of this._monitors ?? []) {
                this._logAction(`D-Bus: Stop monitor=${monitor.name}`);
                this._proxy.StopRemote(monitor.name);
            }
        }
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

    _logAction(message) {
        appendLog(message);
        if (this._lastActionRow)
            this._lastActionRow.subtitle = message;
    }

    _logCommandResult(args, result) {
        const detail = commandResultText(args, result);
        appendLog(detail);
        if (this._lastActionRow)
            this._lastActionRow.subtitle = detail;
    }

    _runLoggedCommand(args) {
        const result = runCommandWithOutput(args);
        this._logCommandResult(args, result);
        return result.ok;
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
