use std::sync::mpsc::{self, SyncSender};
use std::time::Duration;

use thiserror::Error;
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{ImageEncoder, ImageEncoderPixelFormat, ImageFormat};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::GraphicsCaptureApi;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::input_policy::{InputAction, InputPolicy, TargetWindow};

use super::input;

pub struct CapturedWindow {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("requested window is not focused")]
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
        let result = (|| {
            let buffer = frame.buffer().map_err(|error| error.to_string())?;
            let mut contiguous = Vec::new();
            let pixels = buffer.as_nopadding_buffer(&mut contiguous);
            let png = ImageEncoder::new(ImageFormat::Png, ImageEncoderPixelFormat::Bgra8)
                .map_err(|error| error.to_string())?
                .encode(pixels, width, height)
                .map_err(|error| error.to_string())?;
            Ok(CapturedWindow { png, width, height })
        })();
        let _ = self.sender.try_send(result);
        control.stop();
        Ok(())
    }
}

pub fn capture_focused_window(
    window_id: &str,
    expected_target: &TargetWindow,
) -> Result<CapturedWindow, CaptureError> {
    let expected = parse_window_id(window_id)?;
    if foreground_window_id()? != expected || !target_identity_matches(expected_target, window_id) {
        return Err(CaptureError::FocusMismatch);
    }
    let window = Window::enumerate()
        .map_err(|_| CaptureError::CaptureFailed)?
        .into_iter()
        .find(|window| window.as_raw_hwnd() as isize == expected)
        .ok_or(CaptureError::WindowNotFound)?;
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
    if foreground_window_id()? != expected || !target_identity_matches(expected_target, window_id) {
        return Err(CaptureError::FocusMismatch);
    }
    Ok(captured)
}

fn target_identity_matches(expected: &TargetWindow, window_id: &str) -> bool {
    input::target_window(window_id).is_ok_and(|current| {
        InputPolicy::validate(&InputAction::Move { x: 0, y: 0 }, expected, &current).is_ok()
    })
}

fn parse_window_id(value: &str) -> Result<isize, CaptureError> {
    value
        .parse::<isize>()
        .ok()
        .filter(|value| *value != 0)
        .ok_or(CaptureError::WindowNotFound)
}

fn foreground_window_id() -> Result<isize, CaptureError> {
    Ok(Window::foreground()
        .map_err(|_| CaptureError::FocusMismatch)?
        .as_raw_hwnd() as isize)
}
