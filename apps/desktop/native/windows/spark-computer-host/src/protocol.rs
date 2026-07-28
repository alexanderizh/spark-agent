use std::collections::HashSet;

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use serde_json::Value;
use thiserror::Error;

use crate::input_policy::{MAX_DRAG_DURATION_MS, MAX_KEY_CHORD_KEYS, MAX_TEXT_UTF16_UNITS};

pub const PROTOCOL_VERSION: u32 = 1;
const MAX_IDENTIFIER_UTF16_UNITS: usize = 200;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRequest {
    Screen,
    Accessibility,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementAction {
    Invoke,
    Select,
    Focus,
    Expand,
    Collapse,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum WaitCondition {
    #[serde(rename = "loading_stopped")]
    LoadingStopped,
    #[serde(rename = "element_present")]
    ElementPresent {
        #[serde(rename = "elementId", deserialize_with = "deserialize_identifier")]
        element_id: String,
    },
    #[serde(rename = "element_absent")]
    ElementAbsent {
        #[serde(rename = "elementId", deserialize_with = "deserialize_identifier")]
        element_id: String,
    },
    #[serde(rename = "window_focused")]
    WindowFocused {
        #[serde(rename = "windowId", deserialize_with = "deserialize_identifier")]
        window_id: String,
    },
    #[serde(rename = "snapshot_changed")]
    SnapshotChanged {
        #[serde(
            rename = "previousFrameId",
            deserialize_with = "deserialize_identifier"
        )]
        previous_frame_id: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ComputerAction {
    #[serde(rename = "observe")]
    Observe {
        #[serde(rename = "fullTree")]
        full_tree: Option<bool>,
    },
    #[serde(rename = "invoke_element")]
    InvokeElement {
        #[serde(rename = "elementId", deserialize_with = "deserialize_identifier")]
        element_id: String,
        action: Option<ElementAction>,
    },
    #[serde(rename = "set_value")]
    SetValue {
        #[serde(rename = "elementId", deserialize_with = "deserialize_identifier")]
        element_id: String,
        value: String,
        sensitive: Option<bool>,
    },
    #[serde(rename = "select_text")]
    SelectText {
        #[serde(rename = "elementId", deserialize_with = "deserialize_identifier")]
        element_id: String,
        text: String,
        prefix: Option<String>,
        suffix: Option<String>,
    },
    #[serde(rename = "click")]
    Click {
        point: NormalizedPoint,
        button: Option<MouseButton>,
        #[serde(default = "default_click_count")]
        count: u8,
    },
    #[serde(rename = "move")]
    Move { point: NormalizedPoint },
    #[serde(rename = "drag")]
    Drag {
        from: NormalizedPoint,
        to: NormalizedPoint,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u32>,
    },
    #[serde(rename = "scroll")]
    Scroll {
        #[serde(
            rename = "elementId",
            default,
            deserialize_with = "deserialize_optional_identifier"
        )]
        element_id: Option<String>,
        point: Option<NormalizedPoint>,
        #[serde(rename = "deltaX")]
        delta_x: f64,
        #[serde(rename = "deltaY")]
        delta_y: f64,
    },
    #[serde(rename = "keypress")]
    Keypress { keys: Vec<String> },
    #[serde(rename = "type_text")]
    TypeText {
        text: String,
        sensitive: Option<bool>,
    },
    #[serde(rename = "wait_for")]
    WaitFor {
        condition: WaitCondition,
        #[serde(rename = "timeoutMs")]
        timeout_ms: u32,
    },
    #[serde(rename = "focus_window")]
    FocusWindow {
        #[serde(rename = "windowId", deserialize_with = "deserialize_identifier")]
        window_id: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyTarget {
    pub kind: String,
    #[serde(deserialize_with = "deserialize_identifier")]
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyContext {
    pub effect: String,
    pub target: PolicyTarget,
    #[serde(rename = "dataClasses")]
    pub data_classes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerActionEnvelope {
    #[serde(
        rename = "computerSessionId",
        deserialize_with = "deserialize_identifier"
    )]
    pub computer_session_id: String,
    #[serde(rename = "actionId", deserialize_with = "deserialize_identifier")]
    pub action_id: String,
    #[serde(
        rename = "actuatorLeaseId",
        deserialize_with = "deserialize_identifier"
    )]
    pub actuator_lease_id: String,
    #[serde(
        rename = "observedFrameId",
        deserialize_with = "deserialize_identifier"
    )]
    pub observed_frame_id: String,
    #[serde(
        rename = "observedTreeVersion",
        deserialize_with = "deserialize_identifier"
    )]
    pub observed_tree_version: String,
    #[serde(rename = "targetAppId", deserialize_with = "deserialize_identifier")]
    pub target_app_id: String,
    #[serde(rename = "targetWindowId", deserialize_with = "deserialize_identifier")]
    pub target_window_id: String,
    pub action: ComputerAction,
    #[serde(rename = "policyContext")]
    pub policy_context: PolicyContext,
    pub intent: String,
    #[serde(rename = "expectedPostcondition")]
    pub expected_postcondition: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum HostRequest {
    #[serde(rename = "get_capabilities")]
    GetCapabilities {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
    },
    #[serde(rename = "request_permissions")]
    RequestPermissions {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
        permissions: Vec<PermissionRequest>,
    },
    #[serde(rename = "list_windows")]
    ListWindows {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
    },
    #[serde(rename = "capture_window")]
    CaptureWindow {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
        #[serde(rename = "snapshotId", deserialize_with = "deserialize_identifier")]
        snapshot_id: String,
        #[serde(rename = "windowId", deserialize_with = "deserialize_identifier")]
        window_id: String,
    },
    #[serde(rename = "observe")]
    Observe {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
        #[serde(rename = "snapshotId", deserialize_with = "deserialize_identifier")]
        snapshot_id: String,
        #[serde(rename = "appId", deserialize_with = "deserialize_identifier")]
        app_id: String,
        #[serde(rename = "windowId", deserialize_with = "deserialize_identifier")]
        window_id: String,
        #[serde(
            rename = "previousTreeVersion",
            default,
            deserialize_with = "deserialize_optional_identifier"
        )]
        previous_tree_version: Option<String>,
        #[serde(rename = "fullTree")]
        full_tree: bool,
    },
    #[serde(rename = "execute_action")]
    ExecuteAction {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
        envelope: Box<ComputerActionEnvelope>,
    },
    #[serde(rename = "cancel_session")]
    CancelSession {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
        #[serde(
            rename = "computerSessionId",
            deserialize_with = "deserialize_identifier"
        )]
        computer_session_id: String,
    },
    #[serde(rename = "ping")]
    Ping {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId", deserialize_with = "deserialize_identifier")]
        request_id: String,
    },
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid JSON request")]
    Json(#[from] serde_json::Error),
    #[error("invalid request fields: {0}")]
    Invalid(&'static str),
}

impl HostRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self, ProtocolError> {
        let request: Self = serde_json::from_slice(bytes)?;
        request.validate()?;
        Ok(request)
    }

    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::RequestPermissions { permissions, .. } => {
                if permissions.is_empty() || permissions.len() > 2 {
                    return Err(ProtocolError::Invalid("permissions length"));
                }
                let unique = permissions.iter().copied().collect::<HashSet<_>>();
                if unique.len() != permissions.len() {
                    return Err(ProtocolError::Invalid("permissions must be unique"));
                }
            }
            Self::ExecuteAction { envelope, .. } => envelope.validate()?,
            _ => {}
        }
        Ok(())
    }

    pub fn request_id(&self) -> &str {
        match self {
            Self::GetCapabilities { request_id, .. }
            | Self::RequestPermissions { request_id, .. }
            | Self::ListWindows { request_id, .. }
            | Self::CaptureWindow { request_id, .. }
            | Self::Observe { request_id, .. }
            | Self::ExecuteAction { request_id, .. }
            | Self::CancelSession { request_id, .. }
            | Self::Ping { request_id, .. } => request_id,
        }
    }

    pub fn validate_version(&self) -> bool {
        match self {
            Self::GetCapabilities {
                protocol_version, ..
            }
            | Self::RequestPermissions {
                protocol_version, ..
            }
            | Self::ListWindows {
                protocol_version, ..
            }
            | Self::CaptureWindow {
                protocol_version, ..
            }
            | Self::Observe {
                protocol_version, ..
            }
            | Self::ExecuteAction {
                protocol_version, ..
            }
            | Self::CancelSession {
                protocol_version, ..
            }
            | Self::Ping {
                protocol_version, ..
            } => *protocol_version == PROTOCOL_VERSION,
        }
    }
}

impl ComputerActionEnvelope {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.intent.trim().is_empty() || self.intent.encode_utf16().count() > 4_000 {
            return Err(ProtocolError::Invalid("intent"));
        }
        const EFFECTS: &[&str] = &[
            "read_only",
            "reversible_local",
            "external_write",
            "high_impact",
            "restricted",
        ];
        const TARGET_KINDS: &[&str] = &[
            "application",
            "window",
            "element",
            "domain",
            "recipient",
            "file_policy",
            "system_setting",
            "account",
            "unknown",
        ];
        const DATA_CLASSES: &[&str] = &[
            "public",
            "internal",
            "personal",
            "sensitive",
            "credential",
            "financial",
            "health",
            "legal",
        ];
        if !EFFECTS.contains(&self.policy_context.effect.as_str())
            || !TARGET_KINDS.contains(&self.policy_context.target.kind.as_str())
            || self.policy_context.data_classes.len() > DATA_CLASSES.len()
            || self
                .policy_context
                .data_classes
                .iter()
                .any(|class| !DATA_CLASSES.contains(&class.as_str()))
            || self
                .policy_context
                .data_classes
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != self.policy_context.data_classes.len()
        {
            return Err(ProtocolError::Invalid("policy context"));
        }
        self.action.validate()
    }
}

impl ComputerAction {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::SetValue { value, .. } => {
                if value.encode_utf16().count() > MAX_TEXT_UTF16_UNITS {
                    return Err(ProtocolError::Invalid("text length"));
                }
            }
            Self::TypeText { text, .. } => {
                if text.is_empty() || text.encode_utf16().count() > MAX_TEXT_UTF16_UNITS {
                    return Err(ProtocolError::Invalid("text length"));
                }
            }
            Self::SelectText {
                text,
                prefix,
                suffix,
                ..
            } => {
                if text.is_empty()
                    || text.encode_utf16().count() > MAX_TEXT_UTF16_UNITS
                    || prefix
                        .as_ref()
                        .is_some_and(|value| value.encode_utf16().count() > 2_000)
                    || suffix
                        .as_ref()
                        .is_some_and(|value| value.encode_utf16().count() > 2_000)
                {
                    return Err(ProtocolError::Invalid("selection text length"));
                }
            }
            Self::Click { point, count, .. } => {
                validate_point(point)?;
                if !(1..=3).contains(count) {
                    return Err(ProtocolError::Invalid("click count"));
                }
            }
            Self::Move { point } => validate_point(point)?,
            Self::Drag {
                from,
                to,
                duration_ms,
            } => {
                validate_point(from)?;
                validate_point(to)?;
                if duration_ms.is_some_and(|value| !(50..=MAX_DRAG_DURATION_MS).contains(&value)) {
                    return Err(ProtocolError::Invalid("drag duration"));
                }
            }
            Self::Scroll {
                point,
                delta_x,
                delta_y,
                ..
            } => {
                if let Some(point) = point {
                    validate_point(point)?;
                }
                if !delta_x.is_finite()
                    || !delta_y.is_finite()
                    || delta_x.abs() > 100_000.0
                    || delta_y.abs() > 100_000.0
                    || (*delta_x == 0.0 && *delta_y == 0.0)
                {
                    return Err(ProtocolError::Invalid("scroll delta"));
                }
            }
            Self::Keypress { keys } => {
                if keys.is_empty()
                    || keys.len() > MAX_KEY_CHORD_KEYS
                    || keys.iter().any(|key| !valid_key(key))
                {
                    return Err(ProtocolError::Invalid("keypress"));
                }
            }
            Self::WaitFor { timeout_ms, .. } if !(50..=120_000).contains(timeout_ms) => {
                return Err(ProtocolError::Invalid("wait timeout"));
            }
            _ => {}
        }
        Ok(())
    }
}

fn default_click_count() -> u8 {
    1
}

fn validate_point(point: &NormalizedPoint) -> Result<(), ProtocolError> {
    if point.x.is_finite()
        && point.y.is_finite()
        && (0.0..=1.0).contains(&point.x)
        && (0.0..=1.0).contains(&point.y)
    {
        Ok(())
    } else {
        Err(ProtocolError::Invalid("normalized point"))
    }
}

fn valid_key(key: &str) -> bool {
    const NAMED_KEYS: &[&str] = &[
        "Alt",
        "Backspace",
        "Control",
        "Delete",
        "End",
        "Enter",
        "Escape",
        "Home",
        "Meta",
        "PageDown",
        "PageUp",
        "Shift",
        "Space",
        "Tab",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
    ];
    NAMED_KEYS.contains(&key)
        || matches!(
            key.strip_prefix('F')
                .and_then(|value| value.parse::<u8>().ok()),
            Some(1..=24)
        )
        || (key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric())
}

fn deserialize_identifier<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if valid_identifier(&value) {
        Ok(value)
    } else {
        Err(D::Error::custom("invalid identifier"))
    }
}

fn deserialize_optional_identifier<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    match value {
        Some(value) if valid_identifier(&value) => Ok(Some(value)),
        Some(_) => Err(D::Error::custom("invalid identifier")),
        None => Ok(None),
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty()
        && value.encode_utf16().count() <= MAX_IDENTIFIER_UTF16_UNITS
        && !value.chars().any(char::is_control)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostErrorResponse<'a> {
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub response_type: &'static str,
    pub request_id: &'a str,
    pub error: HostErrorBody<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostErrorBody<'a> {
    pub code: &'a str,
    pub message: &'a str,
    pub retryable: bool,
}

pub fn encode_error(
    request_id: &str,
    code: &str,
    message: &str,
    retryable: bool,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&HostErrorResponse {
        protocol_version: PROTOCOL_VERSION,
        response_type: "error",
        request_id,
        error: HostErrorBody {
            code,
            message,
            retryable,
        },
    })
}
