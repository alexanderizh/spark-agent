use thiserror::Error;

use crate::protocol::ComputerAction;

pub const MAX_TEXT_UTF16_UNITS: usize = 20_000;
pub const MAX_KEY_CHORD_KEYS: usize = 8;
pub const MAX_DRAG_DURATION_MS: u32 = 250;
const MAX_COORDINATE: i32 = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScreenPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VirtualDesktop {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

impl VirtualDesktop {
    pub fn new(left: i32, top: i32, width: i32, height: i32) -> Result<Self, InputPolicyError> {
        let right = left
            .checked_add(width)
            .ok_or(InputPolicyError::InvalidCoordinate)?;
        let bottom = top
            .checked_add(height)
            .ok_or(InputPolicyError::InvalidCoordinate)?;
        if width <= 0
            || height <= 0
            || left.unsigned_abs() > MAX_COORDINATE as u32
            || top.unsigned_abs() > MAX_COORDINATE as u32
            || right.unsigned_abs() > MAX_COORDINATE as u32
            || bottom.unsigned_abs() > MAX_COORDINATE as u32
        {
            return Err(InputPolicyError::InvalidCoordinate);
        }
        Ok(Self {
            left,
            top,
            width,
            height,
        })
    }

    pub fn contains(&self, point: ScreenPoint) -> bool {
        let right = self.left.saturating_add(self.width);
        let bottom = self.top.saturating_add(self.height);
        point.x >= self.left && point.x < right && point.y >= self.top && point.y < bottom
    }

    pub fn to_absolute(&self, point: ScreenPoint) -> Result<ScreenPoint, InputPolicyError> {
        if !self.contains(point) {
            return Err(InputPolicyError::InvalidCoordinate);
        }
        let x_span = i64::from(self.width.saturating_sub(1).max(1));
        let y_span = i64::from(self.height.saturating_sub(1).max(1));
        Ok(ScreenPoint {
            x: ((i64::from(point.x - self.left) * 65_535) / x_span) as i32,
            y: ((i64::from(point.y - self.top) * 65_535) / y_span) as i32,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InputAction {
    Click { x: i32, y: i32 },
    Move { x: i32, y: i32 },
    Drag { from: ScreenPoint, to: ScreenPoint },
    Scroll { x: i32, y: i32 },
    TypeText(String),
    KeyPress { virtual_keys: Vec<u16> },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetWindow {
    pub hwnd: isize,
    pub process_id: u32,
    pub executable_identity: String,
    pub foreground: bool,
    pub secure_desktop: bool,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum InputPolicyError {
    #[error("secure desktop input is forbidden")]
    SecureDesktop,
    #[error("target window identity changed")]
    FocusMismatch,
    #[error("input payload exceeds the configured limit")]
    ResourceLimit,
    #[error("coordinate is outside the supported virtual desktop")]
    InvalidCoordinate,
}

pub struct InputPolicy;

impl InputPolicy {
    pub fn validate(
        action: &InputAction,
        expected: &TargetWindow,
        current: &TargetWindow,
    ) -> Result<(), InputPolicyError> {
        if current.secure_desktop {
            return Err(InputPolicyError::SecureDesktop);
        }
        if !current.foreground
            || expected.hwnd != current.hwnd
            || expected.process_id != current.process_id
            || expected.executable_identity != current.executable_identity
        {
            return Err(InputPolicyError::FocusMismatch);
        }
        match action {
            InputAction::Click { x, y }
            | InputAction::Move { x, y }
            | InputAction::Scroll { x, y }
                if invalid_coordinate(*x, *y) =>
            {
                Err(InputPolicyError::InvalidCoordinate)
            }
            InputAction::Drag { from, to }
                if invalid_coordinate(from.x, from.y) || invalid_coordinate(to.x, to.y) =>
            {
                Err(InputPolicyError::InvalidCoordinate)
            }
            InputAction::TypeText(value)
                if value.is_empty() || value.encode_utf16().count() > MAX_TEXT_UTF16_UNITS =>
            {
                Err(InputPolicyError::ResourceLimit)
            }
            InputAction::KeyPress { virtual_keys }
                if virtual_keys.is_empty() || virtual_keys.len() > MAX_KEY_CHORD_KEYS =>
            {
                Err(InputPolicyError::ResourceLimit)
            }
            _ => Ok(()),
        }
    }

    pub fn validate_for_desktop(
        action: &InputAction,
        expected: &TargetWindow,
        current: &TargetWindow,
        desktop: &VirtualDesktop,
    ) -> Result<(), InputPolicyError> {
        Self::validate(action, expected, current)?;
        let points = match action {
            InputAction::Click { x, y }
            | InputAction::Move { x, y }
            | InputAction::Scroll { x, y } => vec![ScreenPoint { x: *x, y: *y }],
            InputAction::Drag { from, to } => vec![*from, *to],
            InputAction::TypeText(_) | InputAction::KeyPress { .. } => Vec::new(),
        };
        if points.iter().all(|point| desktop.contains(*point)) {
            Ok(())
        } else {
            Err(InputPolicyError::InvalidCoordinate)
        }
    }
}

fn invalid_coordinate(x: i32, y: i32) -> bool {
    x.unsigned_abs() > MAX_COORDINATE as u32 || y.unsigned_abs() > MAX_COORDINATE as u32
}

pub fn secure_field_allows(action: &ComputerAction) -> bool {
    match action {
        ComputerAction::TypeText { .. } => false,
        ComputerAction::Keypress { keys } => keys.iter().all(|key| {
            matches!(
                key.as_str(),
                "Escape"
                    | "Tab"
                    | "ArrowDown"
                    | "ArrowLeft"
                    | "ArrowRight"
                    | "ArrowUp"
                    | "Home"
                    | "End"
                    | "PageDown"
                    | "PageUp"
            )
        }),
        _ => true,
    }
}
