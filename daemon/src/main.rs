mod dbus_iface;
mod frame;
mod pipeline;

use anyhow::{Context, Result};
use dbus_iface::WallpaperService;
use pipeline::MonitorPipeline;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Config file: ~/.config/livedesk/config.json
///
/// {
///   "monitors": {
///     "eDP-1": { "uri": "file:///home/you/Videos/loop.webm", "width": 1920, "height": 1080 }
///   }
/// }
///
/// If no config file exists yet, the daemon still starts and just waits
/// for `SetSource` calls over D-Bus (e.g. from the prefs UI on first run).
#[derive(Debug, Deserialize, Default)]
struct Config {
    #[serde(default)]
    monitors: HashMap<String, MonitorConfig>,
}

#[derive(Debug, Deserialize)]
struct MonitorConfig {
    uri: Option<String>,
    #[serde(default = "default_width")]
    width: u32,
    #[serde(default = "default_height")]
    height: u32,
}

fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}

fn config_path() -> PathBuf {
    directories::ProjectDirs::from("me", "tamkungz", "Livedesk")
        .map(|d| d.config_dir().join("config.json"))
        .unwrap_or_else(|| PathBuf::from("config.json"))
}

fn load_config() -> Config {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("warning: failed to parse {path:?}: {e}, using empty config");
            Config::default()
        }),
        Err(_) => {
            println!("no config at {path:?} yet, starting with no monitors configured");
            Config::default()
        }
    }
}

fn main() -> Result<()> {
    let conn = dbus_iface::claim_bus_name()
        .context("failed to claim me.tamkungz.Livedesk on the session bus (already running?)")?;
    let config = load_config();
    let mut monitors = HashMap::new();

    for (name, mcfg) in config.monitors {
        let mp = MonitorPipeline::new(&name, mcfg.width, mcfg.height)
            .with_context(|| format!("setting up pipeline for monitor {name}"))?;
        if let Some(uri) = &mcfg.uri {
            mp.set_source(uri)
                .with_context(|| format!("starting playback for monitor {name}"))?;
        }
        monitors.insert(name, mp);
    }

    let service = WallpaperService {
        monitors: Mutex::new(monitors),
    };

    // Blocks forever, dispatching D-Bus calls; Ctrl+C / SIGTERM just kill
    // the process (GStreamer pipelines are torn down via Drop).
    dbus_iface::serve_on_connection(conn, service).context("lost Livedesk D-Bus service")?;

    Ok(())
}
