//! Shared-memory frame buffer.
//!
//! Layout (all little-endian):
//!   [0..4)   magic:  b"GVW1"
//!   [4..8)   width:  u32
//!   [8..12)  height: u32
//!   [12..16) reserved
//!   [16..24) seq:    u64   (seqlock: odd while writer is mid-write, even when stable)
//!   [24..)   pixels: width * height * 4 bytes, RGBA8888, tightly packed
//!
//! The daemon (writer) owns this file. The GNOME Shell extension (reader)
//! only ever mmaps it read-only and follows the seqlock protocol below.
//! This keeps frame handoff lock-free and avoids the extension ever
//! blocking the compositor's draw thread on the daemon.

use anyhow::{Context, Result};
use memmap2::MmapMut;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAGIC: &[u8; 4] = b"GVW1";
pub const HEADER_LEN: usize = 24;

pub struct FrameBuffer {
    mmap: MmapMut,
    width: u32,
    height: u32,
    path: PathBuf,
}

impl FrameBuffer {
    /// Create (or recreate) the backing file sized for `width` x `height`
    /// RGBA frames, and map it into memory.
    pub fn create(path: impl AsRef<Path>, width: u32, height: u32) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating runtime dir {parent:?}"))?;
        }

        let frame_bytes = (width as u64) * (height as u64) * 4;
        let total_len = HEADER_LEN as u64 + frame_bytes;

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .with_context(|| format!("opening frame file {path:?}"))?;
        file.set_len(total_len)?;

        let mut mmap = unsafe { MmapMut::map_mut(&file)? };

        mmap[0..4].copy_from_slice(MAGIC);
        mmap[4..8].copy_from_slice(&width.to_le_bytes());
        mmap[8..12].copy_from_slice(&height.to_le_bytes());
        mmap[12..16].copy_from_slice(&0u32.to_le_bytes());
        mmap[16..24].copy_from_slice(&0u64.to_le_bytes());

        Ok(Self {
            mmap,
            width,
            height,
            path,
        })
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn seq_ptr(&mut self) -> *mut u64 {
        self.mmap[16..24].as_mut_ptr() as *mut u64
    }

    /// Write one RGBA frame using the seqlock write protocol:
    /// bump seq to odd, copy pixels, bump seq to even.
    /// `pixels` must be exactly width*height*4 bytes, row-major, no padding.
    pub fn write_frame(&mut self, pixels: &[u8]) -> Result<()> {
        let expected = (self.width as usize) * (self.height as usize) * 4;
        anyhow::ensure!(
            pixels.len() == expected,
            "frame size mismatch: got {} expected {}",
            pixels.len(),
            expected
        );

        // SAFETY: seq_ptr points inside our own mmap allocation and is
        // 8-byte aligned because it starts at a fixed offset (16) within
        // a page-aligned mapping.
        let seq = unsafe { AtomicU64::from_ptr(self.seq_ptr()) };

        let cur = seq.load(Ordering::Relaxed);
        seq.store(cur.wrapping_add(1), Ordering::Release); // now odd => "writing"

        self.mmap[HEADER_LEN..HEADER_LEN + expected].copy_from_slice(pixels);

        seq.store(cur.wrapping_add(2), Ordering::Release); // back to even => "stable"

        Ok(())
    }
}

/// Convenience: the default per-monitor path the extension will look for,
/// under $XDG_RUNTIME_DIR (falls back to /tmp).
pub fn default_frame_path(monitor: &str) -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("livedesk")
        .join(format!("{monitor}.frame"))
}
