use std::thread;
use std::time::Duration;

use sha2::{Digest, Sha256};
use thiserror::Error;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, RECT};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS, GetUserObjectInformationW,
    OpenInputDesktop, UOI_NAME,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowThreadProcessId,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};
use windows::core::PWSTR;

use crate::input_policy::{
    InputAction, InputPolicy, InputPolicyError, ScreenPoint, TargetWindow, VirtualDesktop,
};
use crate::protocol::{ComputerAction, MouseButton, NormalizedPoint};

#[derive(Debug, Error)]
pub enum InputError {
    #[error(transparent)]
    Policy(#[from] InputPolicyError),
    #[error("the requested action is not supported by SendInput")]
    Unsupported,
    #[error("the target window could not be inspected")]
    WindowUnavailable,
    #[error("SendInput did not inject the complete action")]
    InjectionFailed,
    #[error("the user took over the target window")]
    UserTakeover,
}

pub fn is_available() -> bool {
    interactive_desktop().unwrap_or(false)
        && VirtualDesktop::new(
            unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
            unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
        )
        .is_ok()
}

pub fn target_window(window_id: &str) -> Result<TargetWindow, InputError> {
    let expected_hwnd = window_id
        .parse::<isize>()
        .ok()
        .filter(|value| *value != 0)
        .ok_or(InputError::WindowUnavailable)?;
    let hwnd = unsafe { GetForegroundWindow() };
    let foreground = hwnd.0 as isize == expected_hwnd;
    let mut process_id = 0_u32;
    unsafe { GetWindowThreadProcessId(HWND(expected_hwnd as *mut _), Some(&mut process_id)) };
    if process_id == 0 {
        return Err(InputError::WindowUnavailable);
    }
    Ok(TargetWindow {
        hwnd: expected_hwnd,
        process_id,
        executable_identity: process_identity(process_id)?,
        foreground,
        secure_desktop: !interactive_desktop()?,
    })
}

pub fn execute(
    action: &ComputerAction,
    expected: &TargetWindow,
    should_stop: impl Fn() -> bool,
) -> Result<(), InputError> {
    stop_if_requested(&should_stop)?;
    let current = target_window(&expected.hwnd.to_string())?;
    let desktop = virtual_desktop()?;
    let rect = window_rect(expected.hwnd)?;
    match action {
        ComputerAction::Click {
            point,
            button,
            count,
        } => {
            let point = screen_point(*point, rect)?;
            let policy_action = InputAction::Click {
                x: point.x,
                y: point.y,
            };
            InputPolicy::validate_for_desktop(&policy_action, expected, &current, &desktop)?;
            stop_if_requested(&should_stop)?;
            move_pointer(point, desktop)?;
            let (down, up) = mouse_button_flags(button.unwrap_or(MouseButton::Left));
            for _ in 0..*count {
                stop_if_requested(&should_stop)?;
                validate_live_foreground(expected, true)?;
                send_one(mouse_event(0, 0, 0, down))?;
                let mut releases = InputReleaseGuard::default();
                releases.arm(mouse_event(0, 0, 0, up));
                releases.release_all()?;
            }
        }
        ComputerAction::Move { point } => {
            let point = screen_point(*point, rect)?;
            let policy_action = InputAction::Move {
                x: point.x,
                y: point.y,
            };
            InputPolicy::validate_for_desktop(&policy_action, expected, &current, &desktop)?;
            stop_if_requested(&should_stop)?;
            move_pointer(point, desktop)?;
        }
        ComputerAction::Drag {
            from,
            to,
            duration_ms,
        } => {
            let from = screen_point(*from, rect)?;
            let to = screen_point(*to, rect)?;
            let policy_action = InputAction::Drag { from, to };
            InputPolicy::validate_for_desktop(&policy_action, expected, &current, &desktop)?;
            stop_if_requested(&should_stop)?;
            move_pointer(from, desktop)?;
            send_one(mouse_event(0, 0, 0, MOUSEEVENTF_LEFTDOWN))?;
            let mut releases = InputReleaseGuard::default();
            releases.arm(mouse_event(0, 0, 0, MOUSEEVENTF_LEFTUP));
            let duration = duration_ms.unwrap_or(250);
            let steps = (duration / 16).clamp(1, 120);
            for step in 1..=steps {
                stop_if_requested(&should_stop)?;
                let current = target_window(&expected.hwnd.to_string())?;
                InputPolicy::validate_for_desktop(&policy_action, expected, &current, &desktop)?;
                let ratio = f64::from(step) / f64::from(steps);
                let point = ScreenPoint {
                    x: f64::from(from.x)
                        .mul_add(1.0 - ratio, f64::from(to.x) * ratio)
                        .round() as i32,
                    y: f64::from(from.y)
                        .mul_add(1.0 - ratio, f64::from(to.y) * ratio)
                        .round() as i32,
                };
                move_pointer(point, desktop)?;
                thread::sleep(Duration::from_millis(u64::from(duration / steps)));
            }
            releases.release_all()?;
        }
        ComputerAction::Scroll {
            point,
            delta_x,
            delta_y,
            ..
        } => {
            let point = screen_point(point.unwrap_or(NormalizedPoint { x: 0.5, y: 0.5 }), rect)?;
            let policy_action = InputAction::Scroll {
                x: point.x,
                y: point.y,
            };
            InputPolicy::validate_for_desktop(&policy_action, expected, &current, &desktop)?;
            stop_if_requested(&should_stop)?;
            move_pointer(point, desktop)?;
            let mut events = Vec::with_capacity(2);
            if *delta_y != 0.0 {
                events.push(mouse_event(
                    0,
                    0,
                    signed_mouse_data(*delta_y),
                    MOUSEEVENTF_WHEEL,
                ));
            }
            if *delta_x != 0.0 {
                events.push(mouse_event(
                    0,
                    0,
                    signed_mouse_data(*delta_x),
                    MOUSEEVENTF_HWHEEL,
                ));
            }
            send(&events)?;
        }
        ComputerAction::Keypress { keys } => {
            let virtual_keys = keys
                .iter()
                .map(|key| virtual_key(key).ok_or(InputError::Unsupported))
                .collect::<Result<Vec<_>, _>>()?;
            let policy_action = InputAction::KeyPress {
                virtual_keys: virtual_keys.clone(),
            };
            InputPolicy::validate(&policy_action, expected, &current)?;
            let mut releases = InputReleaseGuard::default();
            for key in &virtual_keys {
                stop_if_requested(&should_stop)?;
                validate_live_foreground(expected, true)?;
                send_one(key_event(*key, KEYBD_EVENT_FLAGS(0)))?;
                releases.arm(key_event(*key, KEYEVENTF_KEYUP));
            }
            releases.release_all()?;
        }
        ComputerAction::TypeText { text, .. } => {
            let policy_action = InputAction::TypeText(text.clone());
            InputPolicy::validate(&policy_action, expected, &current)?;
            let mut releases = InputReleaseGuard::default();
            for (index, unit) in text.encode_utf16().enumerate() {
                stop_if_requested(&should_stop)?;
                validate_live_foreground(expected, index % 64 == 0)?;
                send_one(unicode_event(unit, KEYBD_EVENT_FLAGS(0)))?;
                releases.arm(unicode_event(unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                releases.release_all()?;
            }
        }
        _ => return Err(InputError::Unsupported),
    }
    stop_if_requested(&should_stop)?;
    let after = target_window(&expected.hwnd.to_string())?;
    InputPolicy::validate(&InputAction::Move { x: 0, y: 0 }, expected, &after)?;
    Ok(())
}

fn stop_if_requested(should_stop: &impl Fn() -> bool) -> Result<(), InputError> {
    if should_stop() {
        Err(InputError::UserTakeover)
    } else {
        Ok(())
    }
}

fn virtual_desktop() -> Result<VirtualDesktop, InputError> {
    VirtualDesktop::new(
        unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
        unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
        unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
        unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
    )
    .map_err(InputError::from)
}

fn window_rect(hwnd: isize) -> Result<RECT, InputError> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(HWND(hwnd as *mut _), &mut rect) }
        .map_err(|_| InputError::WindowUnavailable)?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return Err(InputError::WindowUnavailable);
    }
    Ok(rect)
}

fn screen_point(point: NormalizedPoint, rect: RECT) -> Result<ScreenPoint, InputError> {
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if !(0.0..=1.0).contains(&point.x) || !(0.0..=1.0).contains(&point.y) {
        return Err(InputPolicyError::InvalidCoordinate.into());
    }
    Ok(ScreenPoint {
        x: rect.left + (point.x * f64::from(width.saturating_sub(1))).round() as i32,
        y: rect.top + (point.y * f64::from(height.saturating_sub(1))).round() as i32,
    })
}

fn move_pointer(point: ScreenPoint, desktop: VirtualDesktop) -> Result<(), InputError> {
    let absolute = desktop.to_absolute(point)?;
    send(&[mouse_event(
        absolute.x,
        absolute.y,
        0,
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
    )])
}

fn mouse_button_flags(button: MouseButton) -> (MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS) {
    match button {
        MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        MouseButton::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    }
}

fn signed_mouse_data(value: f64) -> u32 {
    (value
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32) as u32
}

fn mouse_event(dx: i32, dy: i32, data: u32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn key_event(virtual_key: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(virtual_key),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn unicode_event(unit: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: unit,
                dwFlags: KEYEVENTF_UNICODE | flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(events: &[INPUT]) -> Result<(), InputError> {
    if events.is_empty() {
        return Ok(());
    }
    let sent = unsafe { SendInput(events, std::mem::size_of::<INPUT>() as i32) };
    if sent == events.len() as u32 {
        Ok(())
    } else {
        Err(InputError::InjectionFailed)
    }
}

fn send_one(event: INPUT) -> Result<(), InputError> {
    send(std::slice::from_ref(&event))
}

fn validate_live_foreground(
    expected: &TargetWindow,
    check_interactive_desktop: bool,
) -> Result<(), InputError> {
    if check_interactive_desktop && !interactive_desktop()? {
        return Err(InputPolicyError::SecureDesktop.into());
    }
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0 as isize != expected.hwnd {
        return Err(InputPolicyError::FocusMismatch.into());
    }
    let mut process_id = 0_u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    if process_id != expected.process_id {
        return Err(InputPolicyError::FocusMismatch.into());
    }
    Ok(())
}

#[derive(Default)]
struct InputReleaseGuard {
    release_events: Vec<INPUT>,
}

impl InputReleaseGuard {
    fn arm(&mut self, release_event: INPUT) {
        self.release_events.push(release_event);
    }

    fn release_all(&mut self) -> Result<(), InputError> {
        while let Some(event) = self.release_events.last() {
            send(std::slice::from_ref(event))?;
            self.release_events.pop();
        }
        Ok(())
    }
}

impl Drop for InputReleaseGuard {
    fn drop(&mut self) {
        while let Some(event) = self.release_events.pop() {
            let _ = unsafe {
                SendInput(
                    std::slice::from_ref(&event),
                    std::mem::size_of::<INPUT>() as i32,
                )
            };
        }
    }
}

fn virtual_key(value: &str) -> Option<u16> {
    let ascii = value.as_bytes();
    if ascii.len() == 1 && ascii[0].is_ascii_alphanumeric() {
        return Some(ascii[0].to_ascii_uppercase().into());
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

pub(crate) fn process_identity(process_id: u32) -> Result<String, InputError> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
        .map_err(|_| InputError::WindowUnavailable)?;
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    result.map_err(|_| InputError::WindowUnavailable)?;
    let path = String::from_utf16(&buffer[..length as usize])
        .map_err(|_| InputError::WindowUnavailable)?;
    Ok(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(path.to_lowercase().as_bytes()))
    ))
}

fn interactive_desktop() -> Result<bool, InputError> {
    let Ok(desktop) =
        (unsafe { OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) })
    else {
        return Ok(false);
    };
    let mut buffer = vec![0_u16; 256];
    let mut needed = 0_u32;
    let result = unsafe {
        GetUserObjectInformationW(
            HANDLE(desktop.0),
            UOI_NAME,
            Some(buffer.as_mut_ptr().cast()),
            (buffer.len() * std::mem::size_of::<u16>()) as u32,
            Some(&mut needed),
        )
    };
    let _ = unsafe { CloseDesktop(desktop) };
    if result.is_err() {
        return Ok(false);
    }
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    let name = String::from_utf16(&buffer[..length]).map_err(|_| InputError::WindowUnavailable)?;
    Ok(name.eq_ignore_ascii_case("Default"))
}
