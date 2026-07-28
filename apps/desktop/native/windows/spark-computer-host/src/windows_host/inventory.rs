use serde_json::{Value, json};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic};
use windows_capture::window::Window;

use super::input;

pub fn list_windows() -> Result<Vec<Value>, ()> {
    let foreground = unsafe { GetForegroundWindow() }.0 as isize;
    let windows = Window::enumerate().map_err(|_| ())?;
    Ok(windows
        .into_iter()
        .take(10_000)
        .filter_map(|window| map_window(&window, foreground))
        .collect())
}

pub fn focused_window_descriptor(app_id: &str, window_id: &str) -> Result<Value, ()> {
    list_windows()?
        .into_iter()
        .find(|descriptor| {
            descriptor.get("focused").and_then(Value::as_bool) == Some(true)
                && descriptor.pointer("/app/id").and_then(Value::as_str) == Some(app_id)
                && descriptor.pointer("/window/id").and_then(Value::as_str) == Some(window_id)
        })
        .ok_or(())
}

fn map_window(window: &Window, foreground: isize) -> Option<Value> {
    let hwnd = window.as_raw_hwnd() as isize;
    let title = sanitize_text(window.title().ok()?, 2_000, true)?;
    let process_id = window.process_id().ok()?;
    let process_name = sanitize_text(window.process_name().ok()?, 300, false)?;
    let rect = window.rect().ok()?;
    let width = rect.right.checked_sub(rect.left)?;
    let height = rect.bottom.checked_sub(rect.top)?;
    if width <= 0 || height <= 0 {
        return None;
    }
    let monitor = window.monitor()?;
    let mut monitor_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..MONITORINFO::default()
    };
    if !unsafe {
        GetMonitorInfoW(
            windows::Win32::Graphics::Gdi::HMONITOR(monitor.as_raw_hmonitor()),
            &mut monitor_info,
        )
    }
    .as_bool()
    {
        return None;
    }
    let dpi = unsafe { GetDpiForWindow(windows::Win32::Foundation::HWND(window.as_raw_hwnd())) };
    let scale = if dpi >= 96 {
        f64::from(dpi) / 96.0
    } else {
        1.0
    };
    let display_width = monitor.width().ok()?;
    let display_height = monitor.height().ok()?;
    let device_name = sanitize_identifier(monitor.device_name().ok()?)?;
    // Use the canonical executable path identity used by the input and capture
    // policy. Process names are not unique (and are attacker-controlled), so
    // hashing the display name would allow a different executable with the
    // same basename to inherit a previously observed target lease.
    let executable_identity = input::process_identity(process_id).ok()?;
    let app_id = format!("win32:{process_id}:{}", &executable_identity[7..23]);
    Some(json!({
        "app": {
            "id": app_id,
            "name": process_name,
            "processId": process_id,
            "executableIdentity": executable_identity,
        },
        "window": {
            "id": hwnd.to_string(),
            "title": title,
            "bounds": {
                "x": f64::from(rect.left) / scale,
                "y": f64::from(rect.top) / scale,
                "width": f64::from(width) / scale,
                "height": f64::from(height) / scale,
            },
        },
        "display": {
            "id": device_name,
            "width": display_width,
            "height": display_height,
            "scaleFactor": scale,
        },
        "focused": hwnd == foreground,
        "minimized": unsafe { IsIconic(windows::Win32::Foundation::HWND(window.as_raw_hwnd())) }.as_bool(),
    }))
}

fn sanitize_identifier(value: String) -> Option<String> {
    let sanitized = sanitize_text(value, 200, false)?;
    (!sanitized.chars().any(char::is_control)).then_some(sanitized)
}

fn sanitize_text(value: String, max_utf16: usize, allow_empty: bool) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let trimmed = if allow_empty {
        value
    } else {
        value.trim().to_owned()
    };
    if !allow_empty && trimmed.is_empty() {
        return None;
    }
    let mut units = 0;
    Some(
        trimmed
            .chars()
            .take_while(|character| {
                units += character.len_utf16();
                units <= max_utf16
            })
            .collect(),
    )
}
