//! One GStreamer pipeline per monitor: `playbin` with an `appsink` video
//! sink forced to RGBA. Every new sample is copied into the monitor's
//! shared-memory FrameBuffer. Runs entirely on GStreamer's own streaming
//! thread; no GLib main loop is required for the appsink callback path,
//! but we still spawn a small bus-watch thread so errors/EOS don't get
//! silently dropped.

use crate::frame::FrameBuffer;
use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use gstreamer_video as gst_video;
use gstreamer_video::prelude::VideoFrameExt;
use std::sync::{Arc, Mutex};

pub struct MonitorPipeline {
    pub monitor: String,
    pipeline: gst::Element,
    _frame_buf: Arc<Mutex<Option<FrameBuffer>>>,
    width: u32,
    height: u32,
}

impl MonitorPipeline {
    /// `width`/`height` are the *output* frame size written to shared
    /// memory (independent of the source video's native resolution;
    /// videoscale handles the conversion). Pick your monitor's real
    /// resolution here for 1:1 pixels.
    pub fn new(monitor: &str, width: u32, height: u32) -> Result<Self> {
        gst::init().context("gst::init failed")?;

        let playbin = gst::ElementFactory::make("playbin")
            .name(format!("playbin-{monitor}"))
            .build()
            .context("creating playbin (is gstreamer1.0-plugins-base installed?)")?;

        let caps = gst::Caps::builder("video/x-raw")
            .field("format", "RGBA")
            .field("width", width as i32)
            .field("height", height as i32)
            .build();

        let appsink = gst_app::AppSink::builder()
            .caps(&caps)
            .max_buffers(2)
            .drop(true) // always favor the newest frame; never backlog
            .sync(true) // pace output at the video's own framerate
            .build();

        let frame_path = crate::frame::default_frame_path(monitor);
        let frame_buf = Arc::new(Mutex::new(Some(
            FrameBuffer::create(&frame_path, width, height)
                .context("creating shared-memory frame buffer")?,
        )));
        println!("[{monitor}] frame buffer ready at {frame_path:?}");

        let frame_buf_cb = frame_buf.clone();
        appsink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |sink| {
                    let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
                    let caps = sample.caps().ok_or(gst::FlowError::Error)?;
                    let info = gst_video::VideoInfo::from_caps(caps)
                        .map_err(|_| gst::FlowError::Error)?;
                    let frame = gst_video::VideoFrameRef::from_buffer_ref_readable(buffer, &info)
                        .map_err(|_| gst::FlowError::Error)?;

                    // Plane 0 stride may include padding; copy row-by-row
                    // to get a tightly packed buffer matching FrameBuffer's
                    // expected layout.
                    let stride = frame.plane_stride()[0] as usize;
                    let h = frame.height() as usize;
                    let w = frame.width() as usize;
                    let data = frame.plane_data(0).map_err(|_| gst::FlowError::Error)?;

                    let mut packed = Vec::with_capacity(w * h * 4);
                    for row in 0..h {
                        let start = row * stride;
                        packed.extend_from_slice(&data[start..start + w * 4]);
                    }

                    if let Ok(mut guard) = frame_buf_cb.lock() {
                        if let Some(fb) = guard.as_mut() {
                            if let Err(e) = fb.write_frame(&packed) {
                                eprintln!("frame write failed: {e}");
                            }
                        }
                    }

                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );

        playbin.set_property("video-sink", &appsink);
        playbin.set_property_from_str("flags", "video+audio+download");
        // Muted by default: a wallpaper should be silent unless asked.
        playbin.set_property("volume", 0.0f64);

        let bus = playbin.bus().ok_or_else(|| anyhow!("pipeline has no bus"))?;
        let playbin_for_bus = playbin.clone();
        let monitor_name = monitor.to_string();
        std::thread::spawn(move || {
            for msg in bus.iter_timed(gst::ClockTime::NONE) {
                use gst::MessageView;
                match msg.view() {
                    MessageView::Eos(_) => {
                        if let Err(e) = playbin_for_bus.seek_simple(
                            gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                            gst::ClockTime::ZERO,
                        ) {
                            eprintln!("[{monitor_name}] failed to loop video: {e}");
                        }
                    }
                    MessageView::Error(err) => {
                        eprintln!(
                            "[{monitor_name}] pipeline error from {:?}: {} ({:?})",
                            err.src().map(|s| s.path_string()),
                            err.error(),
                            err.debug()
                        );
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            monitor: monitor.to_string(),
            pipeline: playbin,
            _frame_buf: frame_buf,
            width,
            height,
        })
    }

    pub fn set_source(&self, uri: &str) -> Result<()> {
        self.pipeline.set_state(gst::State::Null)?;
        self.pipeline.set_property("uri", uri);
        self.pipeline.set_state(gst::State::Playing)?;
        Ok(())
    }

    pub fn play(&self) -> Result<()> {
        self.pipeline.set_state(gst::State::Playing)?;
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        self.pipeline.set_state(gst::State::Paused)?;
        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        self.pipeline.set_state(gst::State::Null)?;
        Ok(())
    }

    pub fn set_muted(&self, muted: bool) {
        self.pipeline
            .set_property("mute", muted);
    }

    /// Re-seek to the start. The bus watch already does this on EOS, but
    /// keeping it public makes future D-Bus/manual loop controls simpler.
    #[allow(dead_code)]
    pub fn seek_to_start(&self) -> Result<()> {
        self.pipeline.seek_simple(
            gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
            gst::ClockTime::ZERO,
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

impl Drop for MonitorPipeline {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}
