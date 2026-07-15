const Adw = imports.gi.Adw;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const ExtensionUtils = imports.misc.extensionUtils;

const PROJECT_URL = 'https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome';
const RELEASES_URL = PROJECT_URL + '/releases';
let fileDialog = null;

function init() {
}

function openUri(uri) {
    Gio.AppInfo.launch_default_for_uri(uri, null);
}

function addInfoRow(group, title, subtitle) {
    group.add(new Adw.ActionRow({title, subtitle}));
}

function addLinkRow(group, title, subtitle, label, uri) {
    const row = new Adw.ActionRow({title, subtitle});
    const button = new Gtk.Button({
        label,
        valign: Gtk.Align.CENTER,
    });
    button.connect('clicked', () => openUri(uri));
    row.add_suffix(button);
    group.add(row);
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings('me.tamkungz.Livedesk');

    const page = new Adw.PreferencesPage();
    window.add(page);

    const installGroup = new Adw.PreferencesGroup({
        title: 'Complete installation required',
        description: 'The GNOME Extensions zip installs only the Shell integration. Livedesk also needs the native daemon and GTK app.',
    });
    page.add(installGroup);

    addInfoRow(
        installGroup,
        'Install the native package',
        'Use the .deb, .rpm, or source installer from GitHub, then enable and start the daemon.'
    );
    addInfoRow(
        installGroup,
        'After installing',
        'Run: systemctl --user enable --now livedesk-daemon'
    );
    addInfoRow(
        installGroup,
        'Open the app',
        'Run: livedesk'
    );
    addLinkRow(
        installGroup,
        'Downloads',
        'Get the complete Livedesk package.',
        'Releases',
        RELEASES_URL
    );
    addLinkRow(
        installGroup,
        'Source install',
        'Build and install from the repository with ./install.sh.',
        'GitHub',
        PROJECT_URL
    );

    const sourceGroup = new Adw.PreferencesGroup({title: 'Video source'});
    page.add(sourceGroup);

    const fileRow = new Adw.ActionRow({
        title: 'Video file',
        subtitle: settings.get_string('video-uri') || 'No file selected',
    });
    const chooseButton = new Gtk.Button({
        label: 'Choose',
        valign: Gtk.Align.CENTER,
    });
    chooseButton.connect('clicked', () => {
        if (fileDialog) {
            fileDialog.show();
            return;
        }

        const dialog = new Gtk.FileChooserNative({
            title: 'Select a video',
            action: Gtk.FileChooserAction.OPEN,
            transient_for: window,
            modal: true,
        });
        fileDialog = dialog;

        const filter = new Gtk.FileFilter();
        filter.set_name('Video files');
        filter.add_mime_type('video/*');
        dialog.add_filter(filter);

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const uri = dlg.get_file().get_uri();
                settings.set_string('video-uri', uri);
                fileRow.subtitle = uri;
            }
            dlg.destroy();
            if (fileDialog === dialog)
                fileDialog = null;
        });
        dialog.show();
    });
    fileRow.add_suffix(chooseButton);
    sourceGroup.add(fileRow);

    const playbackGroup = new Adw.PreferencesGroup({title: 'Playback'});
    page.add(playbackGroup);

    const fpsSpin = new Gtk.SpinButton({
        valign: Gtk.Align.CENTER,
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 60,
            step_increment: 1,
            value: settings.get_int('frame-rate'),
        }),
    });
    settings.bind('frame-rate', fpsSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
    const fpsRow = new Adw.ActionRow({
        title: 'Frame rate',
        subtitle: 'How often the extension redraws the background',
    });
    fpsRow.add_suffix(fpsSpin);
    playbackGroup.add(fpsRow);

    const mutedSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind('muted', mutedSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    const mutedRow = new Adw.ActionRow({title: 'Mute audio'});
    mutedRow.add_suffix(mutedSwitch);
    mutedRow.activatable_widget = mutedSwitch;
    playbackGroup.add(mutedRow);

    const powerGroup = new Adw.PreferencesGroup({title: 'Power saving'});
    page.add(powerGroup);

    addSwitchRow(powerGroup, settings, 'pause-on-fullscreen', 'Pause when a window is fullscreen');
    addSwitchRow(powerGroup, settings, 'pause-when-locked', 'Pause when the screen is locked');
    addSwitchRow(powerGroup, settings, 'pause-on-battery', 'Pause on battery power');
}

function addSwitchRow(group, settings, key, title) {
    const widget = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
    const row = new Adw.ActionRow({title});
    row.add_suffix(widget);
    row.activatable_widget = widget;
    group.add(row);
}
