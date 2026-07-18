#!/usr/bin/env gjs

imports.gi.versions.Gtk = '3.0';
imports.gi.versions.AyatanaAppIndicator3 = '0.1';

const AyatanaAppIndicator3 = imports.gi.AyatanaAppIndicator3;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;

const TRAY_BUS_NAME = 'me.tamkungz.Livedesk.Tray';
const ICON_ID = 'me.tamkungz.Livedesk';
const DBUS_NAME = 'me.tamkungz.Livedesk';
const DBUS_PATH = '/me/tamkungz/Livedesk';
const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'livedesk', 'config.json']);
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'livedesk']);
const LOG_PATH = GLib.build_filenamev([CACHE_DIR, 'livedesk.log']);
const GNOME_BACKGROUND_SCHEMA_ID = 'org.gnome.desktop.background';
const GNOME_SCREENSAVER_SCHEMA_ID = 'org.gnome.desktop.screensaver';
const LIVEDESK_SCHEMA_ID = 'me.tamkungz.Livedesk';
const PICTURE_URI_KEY = 'picture-uri';
const PICTURE_URI_DARK_KEY = 'picture-uri-dark';
const VIDEO_URI_KEY = 'video-uri';
const STILL_URI_KEY = 'still-uri';

const DBUS_IFACE_XML = `
<node>
  <interface name="me.tamkungz.Livedesk">
    <method name="Play">
      <arg type="s" direction="in" name="monitor"/>
    </method>
    <method name="Pause">
      <arg type="s" direction="in" name="monitor"/>
    </method>
    <method name="Stop">
      <arg type="s" direction="in" name="monitor"/>
    </method>
  </interface>
</node>`;
const LivedeskProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);

function appendLog(message) {
    const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H:%M:%S');
    const line = `[${stamp}] tray: ${message}\n`;
    try {
        GLib.mkdir_with_parents(CACHE_DIR, 0o755);
        const stream = Gio.File.new_for_path(LOG_PATH).append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(new TextEncoder().encode(line), null);
        stream.close(null);
    } catch (_) {
    }
    print(`livedesk-tray: ${message}`);
}

function loadConfig() {
    try {
        const [, bytes] = GLib.file_get_contents(CONFIG_PATH);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
        return {};
    }
}

function settings(schemaId) {
    try {
        return new Gio.Settings({schema_id: schemaId});
    } catch (_) {
        return null;
    }
}

function setString(settingsObj, key, value) {
    try {
        settingsObj.set_string(key, value);
    } catch (_) {
    }
}

function spawn(args) {
    appendLog(`spawn: ${args.join(' ')}`);
    try {
        GLib.spawn_async(null, args, null, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (e) {
        appendLog(`spawn failed: ${e.message}`);
    }
}

function proxy() {
    try {
        return new LivedeskProxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH);
    } catch (e) {
        appendLog(`daemon proxy unavailable: ${e.message}`);
        return null;
    }
}

function activeMonitor() {
    const config = loadConfig();
    return Object.keys(config.monitors ?? {})[0] ?? 'monitor-0';
}

function callDaemon(method) {
    const p = proxy();
    if (!p)
        return;
    const monitor = activeMonitor();
    appendLog(`D-Bus: ${method} ${monitor}`);
    try {
        p[method](monitor);
    } catch (e) {
        appendLog(`D-Bus failed: ${e.message}`);
    }
}

function restoreWallpaper() {
    appendLog('restore wallpaper');
    const config = loadConfig();
    const bg = settings(GNOME_BACKGROUND_SCHEMA_ID);
    const saver = settings(GNOME_SCREENSAVER_SCHEMA_ID);
    const livedesk = settings(LIVEDESK_SCHEMA_ID);

    if (bg) {
        if (config.previous_background_uri)
            setString(bg, PICTURE_URI_KEY, config.previous_background_uri);
        if (config.previous_background_uri_dark)
            setString(bg, PICTURE_URI_DARK_KEY, config.previous_background_uri_dark);
    }
    if (saver && config.previous_screensaver_uri)
        setString(saver, PICTURE_URI_KEY, config.previous_screensaver_uri);
    if (livedesk) {
        setString(livedesk, VIDEO_URI_KEY, '');
        setString(livedesk, STILL_URI_KEY, '');
    }

    callDaemon('StopRemote');
}

function menuItem(label, callback) {
    const item = new Gtk.MenuItem({label});
    item.connect('activate', callback);
    item.show();
    return item;
}

function buildTray() {
    const indicator = AyatanaAppIndicator3.Indicator.new(
        'livedesk-tray',
        ICON_ID,
        AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS);
    indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE);

    const menu = new Gtk.Menu();
    menu.append(menuItem('Open Livedesk', () => spawn(['livedesk'])));
    menu.append(menuItem('Play', () => callDaemon('PlayRemote')));
    menu.append(menuItem('Pause', () => callDaemon('PauseRemote')));
    menu.append(menuItem('Restore Wallpaper', restoreWallpaper));
    menu.append(menuItem('Show Logs', () => spawn(['xdg-open', LOG_PATH])));
    menu.append(new Gtk.SeparatorMenuItem());
    menu.append(menuItem('Quit Tray', () => Gtk.main_quit()));
    menu.show_all();

    indicator.set_menu(menu);
    appendLog('tray started');
}

Gio.bus_own_name(
    Gio.BusType.SESSION,
    TRAY_BUS_NAME,
    Gio.BusNameOwnerFlags.NONE,
    () => {},
    () => buildTray(),
    () => {
        appendLog('tray already running or bus name unavailable');
        Gtk.main_quit();
    });

Gtk.init(null);
Gtk.main();
