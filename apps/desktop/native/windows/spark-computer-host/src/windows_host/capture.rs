use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::time::{Duration, Instant};

use thiserror::Error;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{ImageEncoder, ImageEncoderPixelFormat, ImageFormat};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::GraphicsCaptureApi;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::input_policy::{InputPolicy, TargetWindow};

use super::input;

pub struct CapturedWindow {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

const MAX_PERSISTENT_RAW_BYTES: usize = 64 * 1024 * 1024;

struct PersistentFrame {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    captured_at: Instant,
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("requested window identity no longer matches")]
    FocusMismatch,
    #[error("window was not found")]
    WindowNotFound,
    #[error("Windows Graphics Capture failed")]
    CaptureFailed,
    #[error("Windows Graphics Capture timed out")]
    Timeout,
}

/// Probe the actual Windows Graphics Capture API instead of advertising a
/// static capability. This covers both OS support and the WinRT capture
/// contract used by the frame pipeline.
pub fn is_available() -> bool {
    GraphicsCaptureApi::is_supported().unwrap_or(false)
}

struct OneFrameCapture {
    sender: SyncSender<Result<CapturedWindow, String>>,
}

impl GraphicsCaptureApiHandler for OneFrameCapture {
    type Flags = SyncSender<Result<CapturedWindow, String>>;
    type Error = String;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            sender: context.flags,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let width = frame.width();
        let height = frame.height();
        let result = encode_png(frame, width, height);
        let _ = self.sender.try_send(result);
        control.stop();
        Ok(())
    }
}

struct PersistentFrameCapture {
    sender: SyncSender<Result<PersistentFrame, String>>,
}

impl GraphicsCaptureApiHandler for PersistentFrameCapture {
    type Flags = SyncSender<Result<PersistentFrame, String>>;
    type Error = String;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            sender: context.flags,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let result = copy_persistent_frame(frame, frame.width(), frame.height());
        let _ = self.sender.try_send(result);
        Ok(())
    }
}

pub struct PersistentCaptureSession {
    window_id: isize,
    target: TargetWindow,
    receiver: Receiver<Result<PersistentFrame, String>>,
    control: Option<CaptureControl<PersistentFrameCapture, String>>,
}

impl PersistentCaptureSession {
    fn start(
        window_id: &str,
        expected_target: &TargetWindow,
        require_foreground: bool,
    ) -> Result<Self, CaptureError> {
        let expected = parse_window_id(window_id)?;
        validate_target(expected, expected_target, window_id, require_foreground)?;
        let window = find_window(expected)?;
        let (sender, receiver) = mpsc::sync_channel(2);
        let settings = Settings::new(
            window,
            CursorCaptureSettings::WithoutCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Exclude,
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(100)),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            sender,
        );
        let control = PersistentFrameCapture::start_free_threaded(settings)
            .map_err(|_| CaptureError::CaptureFailed)?;
        Ok(Self {
            window_id: expected,
            target: expected_target.clone(),
            receiver,
            control: Some(control),
        })
    }

    fn matches(&self, window_id: isize, expected_target: &TargetWindow) -> bool {
        self.window_id == window_id && self.target == *expected_target
    }

    fn next_fresh(&self) -> Result<CapturedWindow, CaptureError> {
        let requested_at = Instant::now();
        let deadline = requested_at + Duration::from_secs(2);
        loop {
            match self.receiver.try_recv() {
                Ok(Ok(frame)) if frame.captured_at >= requested_at => {
                    return encode_persistent_frame(frame);
                }
                Ok(Ok(_)) => continue,
                Ok(Err(_)) => return Err(CaptureError::CaptureFailed),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Err(CaptureError::CaptureFailed),
            }
        }
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(CaptureError::Timeout)?;
            let frame = self
                .receiver
                .recv_timeout(remaining)
                .map_err(|_| CaptureError::Timeout)?
                .map_err(|_| CaptureError::CaptureFailed)?;
            if frame.captured_at >= requested_at {
                return encode_persistent_frame(frame);
            }
        }
    }
}

impl Drop for PersistentCaptureSession {
    fn drop(&mut self) {
        if let Some(control) = self.control.take() {
            let _ = control.stop();
        }
    }
}

pub fn capture_window_with_session(
    session: &mut Option<PersistentCaptureSession>,
    window_id: &str,
    expected_target: &TargetWindow,
    persistent: bool,
    require_foreground: bool,
) -> Result<CapturedWindow, CaptureError> {
    if !persistent {
        *session = None;
        return capture_window(window_id, expected_target, require_foreground);
    }
    let expected = parse_window_id(window_id)?;
    if session
        .as_ref()
        .is_none_or(|existing| !existing.matches(expected, expected_target))
    {
        *session = None;
        *session =
            match PersistentCaptureSession::start(window_id, expected_target, require_foreground) {
                Ok(started) => Some(started),
                Err(_) => {
                    return capture_window(window_id, expected_target, require_foreground);
                }
            };
    }
    let result = session
        .as_ref()
        .ok_or(CaptureError::CaptureFailed)?
        .next_fresh();
    let captured = match result {
        Ok(captured) => captured,
        Err(_) => {
            *session = None;
            return capture_window(window_id, expected_target, require_foreground);
        }
    };
    if let Err(error) = validate_target(expected, expected_target, window_id, require_foreground) {
        *session = None;
        return Err(error);
    }
    Ok(captured)
}

pub fn capture_window(
    window_id: &str,
    expected_target: &TargetWindow,
    require_foreground: bool,
) -> Result<CapturedWindow, CaptureError> {
    let expected = parse_window_id(window_id)?;
    validate_target(expected, expected_target, window_id, require_foreground)?;
    let window = find_window(expected)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let settings = Settings::new(
        window,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Exclude,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        sender,
    );
    let control =
        OneFrameCapture::start_free_threaded(settings).map_err(|_| CaptureError::CaptureFailed)?;
    let captured = receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| CaptureError::Timeout)?
        .map_err(|_| CaptureError::CaptureFailed)?;
    let _ = control.stop();
    validate_target(expected, expected_target, window_id, require_foreground)?;
    Ok(captured)
}

fn encode_png(frame: &mut Frame, width: u32, height: u32) -> Result<CapturedWindow, String> {
    let buffer = frame.buffer().map_err(|error| error.to_string())?;
    let mut contiguous = Vec::new();
    let pixels = buffer.as_nopadding_buffer(&mut contiguous);
    let png = ImageEncoder::new(ImageFormat::Png, ImageEncoderPixelFormat::Bgra8)
        .map_err(|error| error.to_string())?
        .encode(pixels, width, height)
        .map_err(|error| error.to_string())?;
    Ok(CapturedWindow { png, width, height })
}

fn copy_persistent_frame(
    frame: &mut Frame,
    width: u32,
    height: u32,
) -> Result<PersistentFrame, String> {
    let expected_bytes = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "persistent frame dimensions overflow".to_owned())?;
    if expected_bytes == 0 || expected_bytes > MAX_PERSISTENT_RAW_BYTES {
        return Err("persistent frame exceeds the raw memory budget".into());
    }
    let buffer = frame.buffer().map_err(|error| error.to_string())?;
    let mut contiguous = Vec::new();
    let pixels = buffer.as_nopadding_buffer(&mut contiguous);
    if pixels.len() != expected_bytes {
        return Err("persistent frame buffer length is invalid".into());
    }
    Ok(PersistentFrame {
        pixels: pixels.to_vec(),
        width,
        height,
        captured_at: Instant::now(),
    })
}

fn encode_persistent_frame(frame: PersistentFrame) -> Result<CapturedWindow, CaptureError> {
    let png = ImageEncoder::new(ImageFormat::Png, ImageEncoderPixelFormat::Bgra8)
        .map_err(|_| CaptureError::CaptureFailed)?
        .encode(&frame.pixels, frame.width, frame.height)
        .map_err(|_| CaptureError::CaptureFailed)?;
    Ok(CapturedWindow {
        png,
        width: frame.width,
        height: frame.height,
    })
}

fn find_window(expected: isize) -> Result<Window, CaptureError> {
    Window::enumerate()
        .map_err(|_| CaptureError::CaptureFailed)?
        .into_iter()
        .find(|window| window.as_raw_hwnd() as isize == expected)
        .ok_or(CaptureError::WindowNotFound)
}

fn validate_target(
    _expected: isize,
    expected_target: &TargetWindow,
    window_id: &str,
    require_foreground: bool,
) -> Result<(), CaptureError> {
    if !target_identity_matches(expected_target, window_id, require_foreground) {
        return Err(CaptureError::FocusMismatch);
    }
    Ok(())
}

fn target_identity_matches(
    expected: &TargetWindow,
    window_id: &str,
    require_foreground: bool,
) -> bool {
    input::target_window(window_id).is_ok_and(|current| {
        InputPolicy::validate_identity(expected, &current, require_foreground).is_ok()
    })
}

fn parse_window_id(value: &str) -> Result<isize, CaptureError> {
    value
        .parse::<isize>()
        .ok()
        .filter(|value| *value != 0)
        .ok_or(CaptureError::WindowNotFound)
}
