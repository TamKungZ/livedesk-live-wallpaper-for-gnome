//! D-Bus control surface, built on the classic `dbus` + `dbus-crossroads`
//! crates (synchronous, libdbus-based) rather than zbus+tokio, to keep the
//! dependency tree small and easy to build with whatever Rust toolchain
//! your distro ships.
//!
//! Bus name:  me.tamkungz.Livedesk
//! Object:    /me/tamkungz/Livedesk
//! Interface: me.tamkungz.Livedesk
//!
//! Per-frame data never goes over D-Bus (far too slow/chatty) -- this is
//! only for coarse control: change source, play/pause/stop, mute. The
//! shell extension calls these in response to things like "a window went
//! fullscreen" or "the screen locked".

use crate::pipeline::MonitorPipeline;
use dbus::blocking::Connection;
use dbus_crossroads::{Context, Crossroads, MethodErr};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

pub struct WallpaperService {
    pub monitors: Mutex<HashMap<String, MonitorPipeline>>,
}

impl WallpaperService {
    fn with_monitor<T>(
        &self,
        monitor: &str,
        f: impl FnOnce(&MonitorPipeline) -> anyhow::Result<T>,
    ) -> Result<T, MethodErr> {
        let monitors = self.monitors.lock().unwrap();
        match monitors.get(monitor) {
            Some(p) => f(p).map_err(|e| MethodErr::failed(&e.to_string())),
            None => Err(MethodErr::failed(&format!("unknown monitor '{monitor}'"))),
        }
    }

    fn ensure_monitor(&self, monitor: &str) -> Result<(), MethodErr> {
        self.ensure_monitor_size(monitor, 1920, 1080)
    }

    fn ensure_monitor_size(&self, monitor: &str, width: u32, height: u32) -> Result<(), MethodErr> {
        let mut monitors = self.monitors.lock().unwrap();
        if let Some(existing) = monitors.get(monitor) {
            if existing.dimensions() == (width, height) {
                return Ok(());
            }
        }

        if width == 0 || height == 0 {
            return Err(MethodErr::failed(
                "monitor dimensions must be greater than zero",
            ));
        }

        if monitors.contains_key(monitor) {
            monitors.remove(monitor);
        }

        let pipeline = MonitorPipeline::new(monitor, width, height)
            .map_err(|e| MethodErr::failed(&e.to_string()))?;
        monitors.insert(monitor.to_string(), pipeline);
        Ok(())
    }

    fn set_monitor_source(
        &self,
        monitor: &str,
        uri: &str,
        width: u32,
        height: u32,
    ) -> Result<(), MethodErr> {
        self.ensure_monitor_size(monitor, width, height)?;
        self.with_monitor(monitor, |p| p.set_source(uri))
    }

    fn set_source_legacy(&self, monitor: &str, uri: &str) -> Result<(), MethodErr> {
        self.ensure_monitor(monitor)?;
        self.with_monitor(monitor, |p| p.set_source(uri))
    }

    fn set_muted_legacy(&self, monitor: &str, muted: bool) -> Result<(), MethodErr> {
        self.with_monitor(monitor, |p| {
            p.set_muted(muted);
            Ok(())
        })
    }
}

/// Registers the interface on a Crossroads instance and blocks serving
/// requests forever (call this from `main`; it does not return under
/// normal operation).
pub fn serve(service: WallpaperService) -> anyhow::Result<()> {
    let conn = Connection::new_session()?;
    conn.request_name("me.tamkungz.Livedesk", false, true, false)?;

    let mut cr = Crossroads::new();

    let iface_token = cr.register("me.tamkungz.Livedesk", |b| {
        b.method(
            "SetSource",
            ("monitor", "uri"),
            (),
            |_ctx: &mut Context, svc: &mut WallpaperService, (monitor, uri): (String, String)| {
                svc.set_source_legacy(&monitor, &uri)
            },
        );

        b.method(
            "SetMonitorSource",
            ("monitor", "uri", "width", "height"),
            (),
            |_ctx: &mut Context,
             svc: &mut WallpaperService,
             (monitor, uri, width, height): (String, String, u32, u32)| {
                svc.set_monitor_source(&monitor, &uri, width, height)
            },
        );

        b.method(
            "Play",
            ("monitor",),
            (),
            |_ctx: &mut Context, svc: &mut WallpaperService, (monitor,): (String,)| {
                svc.with_monitor(&monitor, |p| p.play())
            },
        );

        b.method(
            "Pause",
            ("monitor",),
            (),
            |_ctx: &mut Context, svc: &mut WallpaperService, (monitor,): (String,)| {
                svc.with_monitor(&monitor, |p| p.pause())
            },
        );

        b.method(
            "Stop",
            ("monitor",),
            (),
            |_ctx: &mut Context, svc: &mut WallpaperService, (monitor,): (String,)| {
                svc.with_monitor(&monitor, |p| p.stop())
            },
        );

        b.method(
            "SetMuted",
            ("monitor", "muted"),
            (),
            |_ctx: &mut Context, svc: &mut WallpaperService, (monitor, muted): (String, bool)| {
                svc.set_muted_legacy(&monitor, muted)
            },
        );

        b.method(
            "FramePath",
            ("monitor",),
            ("path",),
            |_ctx: &mut Context, _svc: &mut WallpaperService, (monitor,): (String,)| {
                let path = crate::frame::default_frame_path(&monitor)
                    .to_string_lossy()
                    .to_string();
                Ok((path,))
            },
        );

        b.method(
            "ListMonitors",
            (),
            ("monitors",),
            |_ctx: &mut Context, svc: &mut WallpaperService, ()| {
                let names: Vec<String> = svc.monitors.lock().unwrap().keys().cloned().collect();
                Ok((names,))
            },
        );
    });

    cr.insert("/me/tamkungz/Livedesk", &[iface_token], service);

    println!("livedesk-daemon ready on me.tamkungz.Livedesk");

    // Blocks forever, dispatching incoming method calls to the closures
    // above. GStreamer's own streaming/bus threads keep running
    // independently of this loop.
    cr.serve(&conn)?;
    // cr.serve only returns on connection loss; give the caller a chance
    // to decide whether that's fatal.
    Ok(())
}

/// Convenience used by `main` for a graceful poll-based loop when you'd
/// rather not block on `cr.serve` directly.
#[allow(dead_code)]
pub fn process_for(conn: &Connection, timeout: Duration) -> anyhow::Result<()> {
    conn.process(timeout)?;
    Ok(())
}
