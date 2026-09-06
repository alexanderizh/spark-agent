//! Background input channel: `PostMessageW` delivers synthesized mouse and
//! keyboard messages directly to the target window without touching the
//! foreground — the Windows counterpart of the macOS `background_pid`
//! (CGEventPostToPid) lane, closing the same capability gap (control a
//! background window while the user keeps working in another app).
//!
//! Honesty about the transport: message-level input reaches standard Win32
//! controls, Chromium/Electron renderers, and most framework windows, but
//! apps that poll `GetAsyncKeyState` or read the hardware input stream will
//! ignore it. The protocol handles this the same way Codex does — the action
//! reply carries a skyshot, so a non-responding target shows up as "no effect"
//! to the model, which then switches strategy (semantic action, focus, …).
//! Drag stays on the foreground SendInput lane because message-based drag
//! cannot feed `SetCapture`/hit-testing state.

use std::thread;
use std::time::Duration;

use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::SystemServices::{MK_LBUTTON, MK_MBUTTON, MK_RBUTTON};
use windows::Win32::UI::Input::KeyboardAndMouse::{MAPVK_VK_TO_VSC, MapVirtualKeyW};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, GetWindowThreadProcessId, IsWindow, PostMessageW, WM_CHAR, WM_KEYDOWN, WM_KEYUP,
    WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP,
    WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN, WM_RBUTTONUP,
};

use crate::protocol::{ComputerAction, MouseButton, NormalizedPoint};

const WM_PASTE: u32 = 0x0302;

/// How long a synthesized press is held and the pacing between repeated
/// clicks — mirrors the macOS human click rhythm (40ms press, 100ms gap).
const PRESS_DOWN_MS: u64 = 40;
const INTER_CLICK_MS: u64 = 100;

#[derive(Debug, thiserror::Error)]
pub enum PostError {
    #[error("the requested action is not supported by the background channel")]
    Unsupported,
    #[error("the target window could not be inspected")]
    WindowUnavailable,
    #[error("PostMessageW rejected the synthesized event")]
    PostFailed,
    #[error("the user cancelled the in-flight action")]
    Cancelled,
}

pub fn supports(action: &ComputerAction) -> bool {
    matches!(
        action,
        ComputerAction::Click { .. }
            | ComputerAction::Move { .. }
            | ComputerAction::Scroll { .. }
            | ComputerAction::Keypress { .. }
            | ComputerAction::TypeText { .. }
            | ComputerAction::PasteText { .. }
    )
}

/// Delivers the action as window messages to `expected.hwnd`. Never changes
/// the foreground and never moves the physical cursor.
pub fn execute(
    action: &ComputerAction,
    expected: &crate::input_policy::TargetWindow,
    should_stop: impl Fn() -> bool,
) -> Result<(), PostError> {
    let hwnd = HWND(expected.hwnd as *mut _);
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err(PostError::WindowUnavailable);
    }
    let mut process_id = 0_u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    if process_id != expected.process_id {
        return Err(PostError::WindowUnavailable);
    }
    let origin = client_origin(hwnd)?;
    match action {
        ComputerAction::Click {
            point,
            button,
            count,
        } => {
            let (x, y) = normalized_client(*point, expected, origin)?;
            let button = button.unwrap_or(MouseButton::Left);
            let clicks = (*count).clamp(1, 3);
            for index in 0..clicks {
                stop_check(&should_stop)?;
                // Standard double-click message sequence: second press of a
                // pair is delivered as the DBLCLK message.
                let (down_msg, down_flags) = mouse_down_message(button, index > 0);
                post(hwnd, down_msg, WPARAM(down_flags as usize), lparam(x, y))?;
                thread::sleep(Duration::from_millis(PRESS_DOWN_MS));
                stop_check(&should_stop)?;
                let (up_msg, up_flags) = mouse_up_message(button);
                post(hwnd, up_msg, WPARAM(up_flags as usize), lparam(x, y))?;
                if index < clicks - 1 {
                    thread::sleep(Duration::from_millis(INTER_CLICK_MS));
                }
            }
        }
        ComputerAction::Move { point } => {
            let (x, y) = normalized_client(*point, expected, origin)?;
            post(hwnd, WM_MOUSEMOVE, WPARAM(0), lparam(x, y))?;
        }
        ComputerAction::Scroll {
            point,
            delta_x,
            delta_y,
            ..
        } => {
            // Wheel messages take the SCREEN point in lParam (not client) so
            // the app can hit-test the window under the cursor.
            let at = point.unwrap_or(NormalizedPoint { x: 0.5, y: 0.5 });
            let (x, y) = normalized_screen(at, expected)?;
            if *delta_y != 0.0 {
                post(
                    hwnd,
                    WM_MOUSEWHEEL,
                    WPARAM(wheel_wparam(*delta_y, 0)),
                    screen_lparam(x, y),
                )?;
            }
            if *delta_x != 0.0 {
                post(
                    hwnd,
                    WM_MOUSEHWHEEL,
                    WPARAM(wheel_wparam(*delta_x, 0)),
                    screen_lparam(x, y),
                )?;
            }
        }
        ComputerAction::Keypress { keys } => {
            if keys.is_empty() {
                return Err(PostError::Unsupported);
            }
            // Chord order: all modifiers down, main keys down+up, modifiers up
            // (the inverse of the press order) — same shape SendInput uses.
            let (modifiers, main): (Vec<u16>, Vec<u16>) = keys
                .iter()
                .map(|key| virtual_key(key).ok_or(PostError::Unsupported))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .partition(|vk| matches!(vk, 0x10 | 0x11 | 0x12 | 0x5B));
            let mut held: Vec<u16> = Vec::new();
            for vk in &modifiers {
                stop_check(&should_stop)?;
                key_post(hwnd, *vk, true)?;
                held.push(*vk);
            }
            for vk in &main {
                stop_check(&should_stop)?;
                key_post(hwnd, *vk, true)?;
                thread::sleep(Duration::from_millis(PRESS_DOWN_MS));
                key_post(hwnd, *vk, false)?;
            }
            for vk in held.iter().rev() {
                key_post(hwnd, *vk, false)?;
            }
        }
        ComputerAction::TypeText { text, .. } => {
            // WM_CHAR carries the UTF-16 unit directly — the channel standard
            // edit controls and Chromium treat as real text input regardless
            // of the active keyboard layout.
            for unit in text.encode_utf16() {
                stop_check(&should_stop)?;
                post(hwnd, WM_CHAR, WPARAM(unit as usize), LPARAM(0))?;
            }
        }
        ComputerAction::PasteText { text, .. } => {
            use crate::windows_host::input as sendinput;
            // Clipboard first (shared with the foreground lane), then WM_PASTE
            // — the standard edit-control paste message, delivered to the
            // background window. Chromium ignores it; the skyshot feedback
            // loop shows that to the model, which can fall back to Ctrl+V.
            sendinput::write_clipboard(text).map_err(|error| match error {
                sendinput::InputError::ClipboardFailed => PostError::PostFailed,
                _ => PostError::WindowUnavailable,
            })?;
            stop_check(&should_stop)?;
            post(hwnd, WM_PASTE, WPARAM(0), LPARAM(0))?;
            thread::sleep(Duration::from_millis(PRESS_DOWN_MS));
        }
        _ => return Err(PostError::Unsupported),
    }
    Ok(())
}

fn stop_check(should_stop: &impl Fn() -> bool) -> Result<(), PostError> {
    if should_stop() {
        Err(PostError::Cancelled)
    } else {
        Ok(())
    }
}

fn post(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> Result<(), PostError> {
    let sent = unsafe { PostMessageW(Some(hwnd), message, wparam, lparam) };
    sent.ok().map(|_| ()).ok_or(PostError::PostFailed)
}

fn key_post(hwnd: HWND, vk: u16, down: bool) -> Result<(), PostError> {
    let scan = unsafe { MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC) };
    let message = if down { WM_KEYDOWN } else { WM_KEYUP };
    let lparam = key_lparam(vk, scan, down);
    post(hwnd, message, WPARAM(vk as usize), LPARAM(lparam))
}

// ---------------------------------------------------------------------------
// Pure packing helpers (unit-tested)
// ---------------------------------------------------------------------------

/// Screen-space origin of the target's client area.
pub fn client_origin(hwnd: HWND) -> Result<(i32, i32), PostError> {
    let mut point = POINT { x: 0, y: 0 };
    if unsafe { ClientToScreen(hwnd, &mut point) }.as_bool() {
        Ok((point.x, point.y))
    } else {
        Err(PostError::WindowUnavailable)
    }
}

/// Window-relative client point for a normalized coordinate.
pub fn normalized_client(
    point: NormalizedPoint,
    expected: &crate::input_policy::TargetWindow,
    origin: (i32, i32),
) -> Result<(i32, i32), PostError> {
    let screen = normalized_screen(point, expected)?;
    Ok((screen.0 - origin.0, screen.1 - origin.1))
}

fn normalized_screen(
    point: NormalizedPoint,
    expected: &crate::input_policy::TargetWindow,
) -> Result<(i32, i32), PostError> {
    let hwnd = HWND(expected.hwnd as *mut _);
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|_| PostError::WindowUnavailable)?;
    if !(0.0..=1.0).contains(&point.x) || !(0.0..=1.0).contains(&point.y) {
        return Err(PostError::WindowUnavailable);
    }
    let width = (rect.right - rect.left).max(1);
    let height = (rect.bottom - rect.top).max(1);
    Ok((
        rect.left + (point.x * f64::from(width - 1)).round() as i32,
        rect.top + (point.y * f64::from(height - 1)).round() as i32,
    ))
}

/// Packs a client point into the `lParam` mouse layout (low 16 x, high 16 y,
/// signed 16-bit each). The message layer reads only the low 32 bits, so the
/// isize sign extension is inert.
pub fn pack_lparam(x: i32, y: i32) -> isize {
    pack_i16_pair(x, y) as isize
}

fn lparam(x: i32, y: i32) -> LPARAM {
    LPARAM(pack_lparam(x, y))
}

/// Wheel messages carry the screen point the same way.
fn screen_lparam(x: i32, y: i32) -> LPARAM {
    LPARAM(pack_lparam(x, y))
}

fn pack_i16_pair(low: i32, high: i32) -> i32 {
    let low = (low.clamp(i16::MIN as i32, i16::MAX as i32)) as i16 as u16 as u32;
    let high = (high.clamp(i16::MIN as i32, i16::MAX as i32)) as i16 as u16 as u32;
    let packed = low | (high << 16);
    packed as i32
}

/// Wheel `wParam`: high 16 bits = signed delta, low 16 bits = MK_* flags.
pub fn wheel_wparam(delta: f64, flags: u16) -> usize {
    let steps = delta
        .round()
        .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16;
    (((u32::from(steps as u16)) << 16) | u32::from(flags)) as usize
}

/// `WM_KEYDOWN`/`WM_KEYUP` `lParam`: repeat count (1) | scan code << 16 |
/// previous-key-state & transition state bits for the up event.
pub fn key_lparam(vk: u16, scan: u32, down: bool) -> isize {
    let mut value: u32 = 1 | (scan.min(0xFF) << 16);
    if !down {
        // bits 30 (previous state = 1) and 31 (transition = release)
        value |= (1 << 30) | (1 << 31);
    }
    // Extended keys (arrows, etc.) carry bit 24 — the virtual-key range the
    // executor maps already skips them, so no special case needed here.
    let _ = vk;
    (value as i32) as isize
}

fn mouse_down_message(button: MouseButton, repeat_press: bool) -> (u32, u32) {
    match button {
        MouseButton::Left if repeat_press => (WM_LBUTTONDBLCLK, u32::from(MK_LBUTTON.0)),
        MouseButton::Left => (WM_LBUTTONDOWN, u32::from(MK_LBUTTON.0)),
        MouseButton::Right => (WM_RBUTTONDOWN, u32::from(MK_RBUTTON.0)),
        MouseButton::Middle => (WM_MBUTTONDOWN, u32::from(MK_MBUTTON.0)),
    }
}

fn mouse_up_message(button: MouseButton) -> (u32, u32) {
    match button {
        MouseButton::Left => (WM_LBUTTONUP, 0),
        MouseButton::Right => (WM_RBUTTONUP, 0),
        MouseButton::Middle => (WM_MBUTTONUP, 0),
    }
}

fn virtual_key(value: &str) -> Option<u16> {
    // MK_ flags for held modifiers ride in the mouse wParam; for chords we map
    // the same virtual-key table the foreground lane uses. Reuse is kept
    // literal here (no cross-module dependency on SendInput internals).
    let ascii = value.as_bytes();
    if ascii.len() == 1 && ascii[0].is_ascii_alphanumeric() {
        return Some(u16::from(ascii[0].to_ascii_uppercase()));
    }
    if let Some(function) = value
        .strip_prefix('F')
        .and_then(|number| number.parse::<u16>().ok())
        .filter(|function| (1..=24).contains(function))
    {
        return Some(0x70 + function - 1);
    }
    Some(match value {
        "Backspace" => 0x08,
        "Tab" => 0x09,
        "Enter" => 0x0D,
        "Shift" => 0x10,
        "Control" => 0x11,
        "Alt" => 0x12,
        "Escape" => 0x1B,
        "Space" => 0x20,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "End" => 0x23,
        "Home" => 0x24,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Delete" => 0x2E,
        "Meta" => 0x5B,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lparam_packs_signed_client_coordinates() {
        assert_eq!(pack_lparam(10, 20), 0x0014_000A);
        assert_eq!(pack_lparam(-1, -1), -1);
        // Large windows clamp into the signed 16-bit halves instead of leaking
        // into the neighbouring field.
        let packed = pack_lparam(200_000, 5);
        assert_eq!(packed & 0xFFFF, 0x7FFF); // i16::MAX
    }

    #[test]
    fn wheel_wparam_encodes_signed_delta_in_high_word() {
        assert_eq!(wheel_wparam(-120.0, 0), (0xFF88u32 << 16) as usize);
        assert_eq!(wheel_wparam(3.0, 0), (3u32 << 16) as usize);
        assert_eq!(wheel_wparam(0.0, 0x0008), 0x0008_0000 | 0x0008);
    }

    #[test]
    fn key_lparam_sets_release_bits_only_on_keyup() {
        let down = key_lparam(0x41, 0x1E, true);
        assert_eq!(down, 0x001E_0001);
        let up = key_lparam(0x41, 0x1E, false);
        assert_eq!(
            up,
            (1u32 << 30 | 1u32 << 31 | 0x1E << 16 | 1) as i32 as isize
        );
    }

    #[test]
    fn supports_covers_background_actions_but_not_drag_or_focus() {
        let click = ComputerAction::Click {
            point: NormalizedPoint { x: 0.5, y: 0.5 },
            button: None,
            count: 1,
        };
        assert!(supports(&click));
        let drag = ComputerAction::Drag {
            from: NormalizedPoint { x: 0.0, y: 0.0 },
            to: NormalizedPoint { x: 1.0, y: 1.0 },
            duration_ms: None,
        };
        assert!(!supports(&drag));
    }

    #[test]
    fn virtual_key_matches_foreground_table_for_common_keys() {
        assert_eq!(virtual_key("Enter"), Some(0x0D));
        assert_eq!(virtual_key("ArrowLeft"), Some(0x25));
        assert_eq!(virtual_key("a"), Some(0x41));
        assert_eq!(virtual_key("F5"), Some(0x74));
        assert_eq!(virtual_key("NotAKey"), None);
    }
}
