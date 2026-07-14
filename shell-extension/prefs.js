import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensionPrefs/prefs.js';

const PROJECT_URL = 'https://github.com/TamKungZ/livedesk-live-wallpaper-for-gnome';
const RELEASES_URL = `${PROJECT_URL}/releases`;

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

export default class VideoWallpaperPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

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
            label: 'Choose…',
            valign: Gtk.Align.CENTER,
        });
        chooseButton.connect('clicked', () => {
            const dialog = new Gtk.FileChooserDialog({
                title: 'Select a video',
                action: Gtk.FileChooserAction.OPEN,
                transient_for: window,
                modal: true,
            });
            dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
            dialog.add_button('Open', Gtk.ResponseType.ACCEPT);

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
            });
            dialog.show();
        });
        fileRow.add_suffix(chooseButton);
        sourceGroup.add(fileRow);

        const playbackGroup = new Adw.PreferencesGroup({title: 'Playback'});
        page.add(playbackGroup);

        const fpsRow = new Adw.SpinRow({
            title: 'Frame rate',
            subtitle: 'How often the extension redraws the background (frames/sec)',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 60, step_increment: 1}),
        });
        settings.bind('frame-rate', fpsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        playbackGroup.add(fpsRow);

        const mutedRow = new Adw.SwitchRow({
            title: 'Mute audio',
        });
        settings.bind('muted', mutedRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        playbackGroup.add(mutedRow);

        const powerGroup = new Adw.PreferencesGroup({title: 'Power saving'});
        page.add(powerGroup);

        const fsRow = new Adw.SwitchRow({
            title: 'Pause when a window is fullscreen',
        });
        settings.bind('pause-on-fullscreen', fsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        powerGroup.add(fsRow);

        const lockRow = new Adw.SwitchRow({
            title: 'Pause when the screen is locked',
        });
        settings.bind('pause-when-locked', lockRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        powerGroup.add(lockRow);

        const batteryRow = new Adw.SwitchRow({
            title: 'Pause on battery power',
        });
        settings.bind('pause-on-battery', batteryRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        powerGroup.add(batteryRow);
    }
}
