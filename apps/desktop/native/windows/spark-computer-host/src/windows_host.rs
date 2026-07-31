use std::io::{Read, Write};
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::frame_codec::{FrameDecoder, FrameKind, MAX_FRAME_PAYLOAD_BYTES, encode_frame};
use crate::input_policy::{
    InputAction, InputPolicy, InputPolicyError, TargetWindow, secure_field_allows,
};
use crate::protocol::{ComputerAction, ExecutionLane};
use crate::protocol::{HostRequest, PROTOCOL_VERSION, encode_error};

mod capture;
mod input;
mod inventory;
mod runtime_auth;
mod uia;
mod user_input;

const MAX_SCREENSHOT_DIMENSION: u32 = 32_768;

pub fn run() -> ExitCode {
    if runtime_auth::authorize_parent().is_err() {
        eprintln!("[spark-computer-host] parent process authorization failed");
        return ExitCode::from(77);
    }
    let mut state = HostState::new();
    match serve(
        std::io::stdin().lock(),
        std::io::stdout().lock(),
        &mut state,
    ) {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!("[spark-computer-host] fatal native host protocol failure");
            ExitCode::from(76)
        }
    }
}

fn serve(mut input: impl Read, mut output: impl Write, state: &mut HostState) -> Result<(), ()> {
    let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES).map_err(|_| ())?;
    let mut chunk = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut chunk).map_err(|_| ())?;
        if count == 0 {
            break;
        }
        for frame in decoder.push(&chunk[..count]).map_err(|_| ())? {
            if frame.kind != FrameKind::Json {
                return Err(());
            }
            let request = HostRequest::parse(&frame.payload).map_err(|_| ())?;
            let request_id = request.request_id().to_owned();
            if !request.validate_version() {
                write_json(
                    &mut output,
                    &encode_error(
                        &request_id,
                        "native_host_incompatible",
                        "Native Host protocol version mismatch",
                        false,
                    )
                    .map_err(|_| ())?,
                )?;
                continue;
            }
            handle_request(request, &mut output, state)?;
        }
    }
    decoder.finish().map_err(|_| ())
}

struct ObservationBinding {
    frame_id: String,
    tree_version: String,
    app_id: String,
    window_id: String,
    target: TargetWindow,
    observed_at: std::time::Instant,
}

struct HostState {
    uia: Option<uia::UiaRuntime>,
    input_available: bool,
    observation: Option<ObservationBinding>,
    canceled_sessions: CanceledSessionRegistry,
    user_input: Option<user_input::WindowsUserInputMonitor>,
}

impl HostState {
    fn new() -> Self {
        let user_input = user_input::WindowsUserInputMonitor::new();
        Self {
            uia: uia::UiaRuntime::new().ok(),
            input_available: input::is_available() && user_input.is_some(),
            observation: None,
            canceled_sessions: CanceledSessionRegistry::default(),
            user_input,
        }
    }

    fn refresh_capabilities(&mut self) {
        if self.uia.is_none() {
            self.uia = uia::UiaRuntime::new().ok();
        }
        self.input_available = input::is_available() && self.user_input.is_some();
    }
}

fn handle_request(
    request: HostRequest,
    output: &mut impl Write,
    state: &mut HostState,
) -> Result<(), ()> {
    match request {
        HostRequest::GetCapabilities { request_id, .. } => write_value(
            output,
            &json!({
                "protocolVersion": PROTOCOL_VERSION,
                "type": "capabilities",
                "requestId": request_id,
                "manifest": capability_manifest(state),
            }),
        ),
        HostRequest::RequestPermissions { request_id, .. } => {
            state.refresh_capabilities();
            write_value(
                output,
                &json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "capabilities",
                    "requestId": request_id,
                    "manifest": capability_manifest(state),
                }),
            )
        }
        HostRequest::ListWindows { request_id, .. } => match inventory::list_windows() {
            Ok(windows) => write_value(
                output,
                &json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "windows",
                    "requestId": request_id,
                    "windows": windows,
                }),
            ),
            Err(_) => write_platform_error(
                output,
                &request_id,
                "native_host_incompatible",
                "Windows window inventory failed",
                false,
            ),
        },
        HostRequest::CaptureWindow {
            request_id,
            snapshot_id,
            window_id,
            ..
        } => {
            let target = match input::target_window(&window_id) {
                Ok(target) if target.foreground && !target.secure_desktop => target,
                Ok(target) if target.secure_desktop => {
                    return write_platform_error(
                        output,
                        &request_id,
                        "sensitive_input_blocked",
                        "Capture is forbidden on the secure desktop",
                        false,
                    );
                }
                _ => {
                    return write_platform_error(
                        output,
                        &request_id,
                        "focus_mismatch",
                        "The requested window is no longer the focused window",
                        true,
                    );
                }
            };
            match capture::capture_focused_window(&window_id, &target) {
                Ok(captured) => {
                    if captured.width == 0
                        || captured.height == 0
                        || captured.width > MAX_SCREENSHOT_DIMENSION
                        || captured.height > MAX_SCREENSHOT_DIMENSION
                        || captured.png.is_empty()
                        || captured.png.len() > MAX_FRAME_PAYLOAD_BYTES
                    {
                        return write_platform_error(
                            output,
                            &request_id,
                            "native_host_incompatible",
                            "Windows Graphics Capture returned invalid image data",
                            false,
                        );
                    }
                    let digest = Sha256::digest(&captured.png);
                    write_value(
                        output,
                        &json!({
                            "protocolVersion": PROTOCOL_VERSION,
                            "type": "capture_result",
                            "requestId": request_id,
                            "snapshotId": snapshot_id,
                            "width": captured.width,
                            "height": captured.height,
                            "payload": {
                                "kind": "image_png",
                                "byteLength": captured.png.len(),
                                "sha256": hex::encode(digest),
                            },
                        }),
                    )?;
                    let binary = encode_frame(FrameKind::Binary, &captured.png).map_err(|_| ())?;
                    output.write_all(&binary).map_err(|_| ())?;
                    output.flush().map_err(|_| ())
                }
                Err(capture::CaptureError::FocusMismatch) => write_platform_error(
                    output,
                    &request_id,
                    "focus_mismatch",
                    "The requested window is no longer the focused window",
                    true,
                ),
                Err(_) => write_platform_error(
                    output,
                    &request_id,
                    "native_host_incompatible",
                    "Windows Graphics Capture failed",
                    false,
                ),
            }
        }
        HostRequest::Observe {
            request_id,
            snapshot_id,
            app_id,
            window_id,
            previous_tree_version,
            full_tree,
            ..
        } => observe(
            output,
            state,
            ObserveInput {
                request_id: &request_id,
                snapshot_id: &snapshot_id,
                app_id: &app_id,
                window_id: &window_id,
                previous_tree_version: previous_tree_version.as_deref(),
                full_tree,
            },
        ),
        HostRequest::ExecuteAction {
            request_id,
            envelope,
            ..
        } => execute_action(output, state, &request_id, *envelope),
        HostRequest::CancelSession {
            request_id,
            computer_session_id,
            ..
        } => {
            state.observation = None;
            if let Some(monitor) = state.user_input {
                monitor.clear_session(&computer_session_id);
            }
            state.canceled_sessions.cancel(computer_session_id);
            write_value(
                output,
                &json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "ack",
                    "requestId": request_id,
                }),
            )
        }
        HostRequest::Ping { request_id, .. } => write_value(
            output,
            &json!({
                "protocolVersion": PROTOCOL_VERSION,
                "type": "pong",
                "requestId": request_id,
            }),
        ),
    }
}

fn capability_manifest(state: &HostState) -> Value {
    let uia_available = state.uia.is_some();
    let input_available = state.input_available;
    let capture_available = capture::is_available();
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "platform": "windows",
        "architecture": if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" },
        "backends": {
            "screen": if capture_available { "windows_graphics_capture" } else { "unavailable" },
            "accessibility": if uia_available { "uia" } else { "unavailable" },
            "input": if input_available { "send_input" } else { "unavailable" },
        },
        "features": {
            "listWindows": true,
            "captureWindow": capture_available,
            "fullTree": uia_available,
            "diffTree": uia_available,
            "semanticActions": uia_available,
            "absolutePointer": input_available,
            "keyboard": input_available,
            "clipboard": false,
        },
        "permissions": {
            "screen": if capture_available { "granted" } else { "restricted" },
            "accessibility": if uia_available { "granted" } else { "restricted" },
            "input": if input_available { "granted" } else { "restricted" },
        },
        "limits": {
            "maxMessageBytes": MAX_FRAME_PAYLOAD_BYTES,
            "maxScreenshotWidth": MAX_SCREENSHOT_DIMENSION,
            "maxScreenshotHeight": MAX_SCREENSHOT_DIMENSION,
            "maxTreeElements": 100_000,
        },
    })
}

struct ObserveInput<'a> {
    request_id: &'a str,
    snapshot_id: &'a str,
    app_id: &'a str,
    window_id: &'a str,
    previous_tree_version: Option<&'a str>,
    full_tree: bool,
}

fn observe(
    output: &mut impl Write,
    state: &mut HostState,
    input: ObserveInput<'_>,
) -> Result<(), ()> {
    let ObserveInput {
        request_id,
        snapshot_id,
        app_id,
        window_id,
        previous_tree_version,
        full_tree,
    } = input;
    let observed_at = std::time::Instant::now();
    let Some(uia) = state.uia.as_mut() else {
        return write_platform_error(
            output,
            request_id,
            "environment_unavailable",
            "Windows UI Automation is unavailable",
            false,
        );
    };
    let descriptor = match inventory::focused_window_descriptor(app_id, window_id) {
        Ok(descriptor) => descriptor,
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The requested application window is not foreground",
                true,
            );
        }
    };
    let before = match input::target_window(window_id) {
        Ok(target) if target.foreground && !target.secure_desktop => target,
        Ok(target) if target.secure_desktop => {
            return write_platform_error(
                output,
                request_id,
                "sensitive_input_blocked",
                "Observation is forbidden on the secure desktop",
                false,
            );
        }
        _ => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The requested application window is not foreground",
                true,
            );
        }
    };
    let captured = match capture::capture_focused_window(window_id, &before) {
        Ok(captured) => captured,
        Err(capture::CaptureError::FocusMismatch | capture::CaptureError::WindowNotFound) => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The requested window changed while observing",
                true,
            );
        }
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "native_host_incompatible",
                "Windows Graphics Capture failed while observing",
                false,
            );
        }
    };
    if captured.width == 0
        || captured.height == 0
        || captured.width > MAX_SCREENSHOT_DIMENSION
        || captured.height > MAX_SCREENSHOT_DIMENSION
        || captured.png.is_empty()
        || captured.png.len() > MAX_FRAME_PAYLOAD_BYTES
    {
        return write_platform_error(
            output,
            request_id,
            "native_host_incompatible",
            "Windows Graphics Capture returned invalid observation image data",
            false,
        );
    }
    let tree = match uia.observe(before.hwnd, previous_tree_version, full_tree) {
        Ok(tree) => tree,
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "native_host_incompatible",
                "Windows UI Automation failed while observing",
                false,
            );
        }
    };
    let after = match input::target_window(window_id) {
        Ok(target) => target,
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The foreground application changed while observing",
                true,
            );
        }
    };
    if InputPolicy::validate(&InputAction::Move { x: 0, y: 0 }, &before, &after).is_err() {
        return write_platform_error(
            output,
            request_id,
            "focus_mismatch",
            "The foreground application changed while observing",
            true,
        );
    }
    let captured_at = format_system_time(SystemTime::now());
    let mut frame_digest = Sha256::new();
    frame_digest.update(&captured.png);
    frame_digest.update(tree.tree_version.as_bytes());
    frame_digest.update(captured_at.as_bytes());
    let frame_id = format!("frame-{}", &hex::encode(frame_digest.finalize())[..32]);
    let payload_digest = Sha256::digest(&captured.png);
    let mode = match tree.mode {
        crate::uia_policy::TreeMode::Full => "full",
        crate::uia_policy::TreeMode::Diff => "diff",
    };
    let app = descriptor.get("app").cloned().unwrap_or(Value::Null);
    let window = descriptor.get("window").cloned().unwrap_or(Value::Null);
    let display = descriptor.get("display").cloned().unwrap_or(Value::Null);
    write_value(
        output,
        &json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "observation",
            "requestId": request_id,
            "observation": {
                "frameId": frame_id,
                "treeVersion": tree.tree_version,
                "capturedAt": captured_at,
                "display": display,
                "foreground": { "app": app, "window": window },
                "screenshot": {
                    "snapshotId": snapshot_id,
                    "width": captured.width,
                    "height": captured.height,
                },
                "tree": {
                    "mode": mode,
                    "text": tree.text,
                    "elementCount": tree.elements.len(),
                },
                "elements": tree.elements,
                "loading": false,
                "sensitiveRegions": tree.sensitive_regions,
            },
            "payload": {
                "kind": "image_png",
                "byteLength": captured.png.len(),
                "sha256": hex::encode(payload_digest),
            },
        }),
    )?;
    let binary = encode_frame(FrameKind::Binary, &captured.png).map_err(|_| ())?;
    output.write_all(&binary).map_err(|_| ())?;
    output.flush().map_err(|_| ())?;
    state.observation = Some(ObservationBinding {
        frame_id,
        tree_version: tree.tree_version,
        app_id: app_id.to_owned(),
        window_id: window_id.to_owned(),
        target: before,
        observed_at,
    });
    Ok(())
}

fn execute_action(
    output: &mut impl Write,
    state: &mut HostState,
    request_id: &str,
    envelope: crate::protocol::ComputerActionEnvelope,
) -> Result<(), ()> {
    if state
        .canceled_sessions
        .rejects(&envelope.computer_session_id)
    {
        return write_platform_error(
            output,
            request_id,
            "session_canceled",
            "The computer session was canceled",
            false,
        );
    }
    let Some(binding) = state.observation.as_ref() else {
        return write_platform_error(
            output,
            request_id,
            "stale_frame",
            "A fresh observation is required before executing an action",
            true,
        );
    };
    if binding.frame_id != envelope.observed_frame_id {
        return write_platform_error(
            output,
            request_id,
            "stale_frame",
            "The observed frame is stale",
            true,
        );
    }
    if binding.tree_version != envelope.observed_tree_version {
        return write_platform_error(
            output,
            request_id,
            "stale_tree",
            "The observed UI Automation tree is stale",
            true,
        );
    }
    if binding.app_id != envelope.target_app_id || binding.window_id != envelope.target_window_id {
        return write_platform_error(
            output,
            request_id,
            "focus_mismatch",
            "The action target does not match the observation",
            true,
        );
    }
    let expected = binding.target.clone();
    let current = match input::target_window(&binding.window_id) {
        Ok(current) => current,
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The target window is unavailable",
                true,
            );
        }
    };
    if let Err(error) =
        InputPolicy::validate(&InputAction::Move { x: 0, y: 0 }, &expected, &current)
    {
        return write_input_policy_error(output, request_id, error);
    }
    let session_id = envelope.computer_session_id.as_str();
    let Some(user_input) = state.user_input else {
        return write_platform_error(
            output,
            request_id,
            "environment_unavailable",
            "Windows user-input monitoring is unavailable",
            false,
        );
    };
    user_input.bind_session(session_id, expected.hwnd, binding.observed_at);
    if user_input.takeover_detected(session_id) {
        return write_platform_error(
            output,
            request_id,
            "handoff_required",
            "The user took over the target window",
            false,
        );
    }
    if envelope.effective_execution_lane() == ExecutionLane::ForegroundInput {
        match user_input.wait_for_idle(session_id) {
            Ok(()) => {}
            Err(user_input::UserInputError::Takeover) => {
                return write_platform_error(
                    output,
                    request_id,
                    "handoff_required",
                    "The user took over the target window",
                    false,
                );
            }
            Err(user_input::UserInputError::Busy) => {
                return write_platform_error(
                    output,
                    request_id,
                    "action_timeout",
                    "User input did not become idle before the action deadline",
                    true,
                );
            }
        }
    }
    if matches!(
        envelope.action,
        ComputerAction::TypeText { .. } | ComputerAction::Keypress { .. }
    ) {
        let focused_secure = state
            .uia
            .as_ref()
            .ok_or(uia::UiaError::SensitiveElement)
            .and_then(uia::UiaRuntime::focused_element_is_secure);
        if focused_secure.unwrap_or(true) && !secure_field_allows(&envelope.action) {
            return write_action_error(
                output,
                request_id,
                ActionExecutionError::Uia(uia::UiaError::SensitiveElement),
            );
        }
    }
    let semantic = matches!(
        envelope.action,
        ComputerAction::InvokeElement { .. }
            | ComputerAction::SetValue { .. }
            | ComputerAction::Scroll {
                element_id: Some(_),
                point: None,
                ..
            }
    );
    let result = if semantic {
        state
            .uia
            .as_mut()
            .ok_or(uia::UiaError::Unavailable)
            .and_then(|uia| uia.execute(&envelope.action, &envelope.observed_tree_version))
            .map_err(ActionExecutionError::Uia)
    } else {
        if !state.input_available {
            Err(ActionExecutionError::Input(input::InputError::Unsupported))
        } else {
            input::execute(&envelope.action, &expected, || {
                user_input.takeover_detected(session_id)
            })
            .map_err(ActionExecutionError::Input)
        }
    };
    if let Err(error) = result {
        return write_action_error(output, request_id, error);
    }
    let after = match input::target_window(&binding.window_id) {
        Ok(after) => after,
        Err(_) => {
            return write_platform_error(
                output,
                request_id,
                "focus_mismatch",
                "The target window changed after the action",
                true,
            );
        }
    };
    if let Err(error) = InputPolicy::validate(&InputAction::Move { x: 0, y: 0 }, &expected, &after)
    {
        return write_input_policy_error(output, request_id, error);
    }
    state.observation = None;
    write_value(
        output,
        &json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "action_result",
            "requestId": request_id,
            "actionId": envelope.action_id,
            "status": "executed",
        }),
    )
}

enum ActionExecutionError {
    Input(input::InputError),
    Uia(uia::UiaError),
}

fn write_action_error(
    output: &mut impl Write,
    request_id: &str,
    error: ActionExecutionError,
) -> Result<(), ()> {
    match error {
        ActionExecutionError::Input(input::InputError::Policy(error)) => {
            write_input_policy_error(output, request_id, error)
        }
        ActionExecutionError::Input(input::InputError::Unsupported)
        | ActionExecutionError::Uia(uia::UiaError::UnsupportedAction) => write_platform_error(
            output,
            request_id,
            "action_not_allowed",
            "The requested action is not supported by this Native Host",
            false,
        ),
        ActionExecutionError::Uia(uia::UiaError::StaleTree) => write_platform_error(
            output,
            request_id,
            "stale_tree",
            "The UI Automation element reference is stale",
            true,
        ),
        ActionExecutionError::Uia(uia::UiaError::ElementNotFound) => write_platform_error(
            output,
            request_id,
            "stale_tree",
            "The UI Automation element no longer exists",
            true,
        ),
        ActionExecutionError::Uia(uia::UiaError::SensitiveElement) => write_platform_error(
            output,
            request_id,
            "sensitive_input_blocked",
            "Sensitive UI Automation values cannot be accessed",
            false,
        ),
        ActionExecutionError::Input(input::InputError::WindowUnavailable) => write_platform_error(
            output,
            request_id,
            "focus_mismatch",
            "The target window is unavailable",
            true,
        ),
        ActionExecutionError::Input(input::InputError::UserTakeover) => write_platform_error(
            output,
            request_id,
            "handoff_required",
            "The user took over the target window",
            false,
        ),
        ActionExecutionError::Input(input::InputError::InjectionFailed)
        | ActionExecutionError::Uia(uia::UiaError::Unavailable)
        | ActionExecutionError::Uia(uia::UiaError::OperationFailed) => write_platform_error(
            output,
            request_id,
            "action_noop",
            "Windows did not confirm the requested action",
            true,
        ),
    }
}

fn write_input_policy_error(
    output: &mut impl Write,
    request_id: &str,
    error: InputPolicyError,
) -> Result<(), ()> {
    match error {
        InputPolicyError::SecureDesktop => write_platform_error(
            output,
            request_id,
            "sensitive_input_blocked",
            "Input is forbidden on the Windows secure desktop",
            false,
        ),
        InputPolicyError::FocusMismatch => write_platform_error(
            output,
            request_id,
            "focus_mismatch",
            "The foreground application identity changed",
            true,
        ),
        InputPolicyError::ResourceLimit | InputPolicyError::InvalidCoordinate => {
            write_platform_error(
                output,
                request_id,
                "action_not_allowed",
                "The requested input exceeds Native Host safety limits",
                false,
            )
        }
    }
}

fn format_system_time(value: SystemTime) -> String {
    let seconds = value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn write_platform_error(
    output: &mut impl Write,
    request_id: &str,
    code: &str,
    message: &str,
    retryable: bool,
) -> Result<(), ()> {
    write_json(
        output,
        &encode_error(request_id, code, message, retryable).map_err(|_| ())?,
    )
}

fn write_value(output: &mut impl Write, value: &Value) -> Result<(), ()> {
    let payload = serde_json::to_vec(value).map_err(|_| ())?;
    write_json(output, &payload)
}

fn write_json(output: &mut impl Write, payload: &[u8]) -> Result<(), ()> {
    let frame = encode_frame(FrameKind::Json, payload).map_err(|_| ())?;
    output.write_all(&frame).map_err(|_| ())?;
    output.flush().map_err(|_| ())
}
use crate::cancellation_policy::CanceledSessionRegistry;
