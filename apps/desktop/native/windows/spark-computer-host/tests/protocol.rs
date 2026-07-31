use serde_json::{Value, json};
use spark_computer_host::protocol::{ComputerAction, HostRequest, PermissionRequest};

fn request(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap()
}

fn valid_envelope(action: Value) -> Value {
    let execution_lane = match action.get("type").and_then(Value::as_str) {
        Some("invoke_element" | "set_value" | "select_text") => "background_semantic",
        Some("observe" | "wait_for") => "passive",
        _ => "foreground_input",
    };
    json!({
        "computerSessionId": "session-1",
        "actionId": "action-1",
        "actuatorLeaseId": "lease-1",
        "observedFrameId": "frame-1",
        "observedTreeVersion": "tree-1",
        "targetAppId": "app-1",
        "targetWindowId": "100",
        "action": action,
        "executionLane": execution_lane,
        "policyContext": {
            "effect": "reversible_local",
            "target": { "kind": "window", "id": "100" },
            "dataClasses": []
        },
        "intent": "Click the requested control"
    })
}

#[test]
fn rejects_execution_lane_mismatches() {
    let mut envelope = valid_envelope(json!({
        "type": "click",
        "point": { "x": 0.5, "y": 0.5 }
    }));
    envelope["executionLane"] = json!("background_semantic");
    assert!(
        HostRequest::parse(&request(json!({
            "protocolVersion": 1,
            "requestId": "request-lane",
            "type": "execute_action",
            "envelope": envelope
        })))
        .is_err()
    );
}

#[test]
fn matches_shared_execution_lane_rules_for_scroll_and_observe() {
    for (request_id, action) in [
        (
            "request-scroll-lane",
            json!({
                "type": "scroll",
                "elementId": "list-1",
                "deltaX": 0.0,
                "deltaY": 120.0
            }),
        ),
        (
            "request-observe-lane",
            json!({
                "type": "observe",
                "fullTree": false
            }),
        ),
    ] {
        assert!(
            HostRequest::parse(&request(json!({
                "protocolVersion": 1,
                "requestId": request_id,
                "type": "execute_action",
                "envelope": valid_envelope(action)
            })))
            .is_ok()
        );
    }
}

#[test]
fn infers_execution_lane_for_legacy_envelopes() {
    let mut envelope = valid_envelope(json!({
        "type": "click",
        "point": { "x": 0.5, "y": 0.5 }
    }));
    envelope.as_object_mut().unwrap().remove("executionLane");
    let parsed = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-legacy-lane",
        "type": "execute_action",
        "envelope": envelope
    })))
    .unwrap();
    assert!(matches!(
        parsed,
        HostRequest::ExecuteAction { envelope, .. }
            if envelope.effective_execution_lane() == spark_computer_host::protocol::ExecutionLane::ForegroundInput
    ));
}

#[test]
fn parses_all_control_requests_with_strict_shapes() {
    let permissions = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-1",
        "type": "request_permissions",
        "permissions": ["screen", "accessibility"]
    })))
    .unwrap();
    assert!(matches!(
        permissions,
        HostRequest::RequestPermissions {
            permissions,
            ..
        } if permissions == vec![PermissionRequest::Screen, PermissionRequest::Accessibility]
    ));

    let observe = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-2",
        "type": "observe",
        "snapshotId": "snapshot-1",
        "appId": "app-1",
        "windowId": "100",
        "previousTreeVersion": null,
        "fullTree": true
    })))
    .unwrap();
    assert!(matches!(
        observe,
        HostRequest::Observe {
            full_tree: true,
            ..
        }
    ));

    let execute = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-3",
        "type": "execute_action",
        "envelope": valid_envelope(json!({
            "type": "click",
            "point": { "x": 0.25, "y": 0.75 },
            "button": "left",
            "count": 2
        }))
    })))
    .unwrap();
    assert!(matches!(
        execute,
        HostRequest::ExecuteAction { envelope, .. }
            if matches!(envelope.action, ComputerAction::Click { count: 2, .. })
    ));

    let cancel = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-4",
        "type": "cancel_session",
        "computerSessionId": "session-1"
    })))
    .unwrap();
    assert!(matches!(cancel, HostRequest::CancelSession { .. }));

    let clear_value = HostRequest::parse(&request(json!({
        "protocolVersion": 1,
        "requestId": "request-5",
        "type": "execute_action",
        "envelope": valid_envelope(json!({
            "type": "set_value",
            "elementId": "field-1",
            "value": ""
        }))
    })))
    .unwrap();
    assert!(matches!(
        clear_value,
        HostRequest::ExecuteAction { envelope, .. }
            if matches!(&envelope.action, ComputerAction::SetValue { value, .. } if value.is_empty())
    ));
}

#[test]
fn rejects_unknown_fields_duplicate_permissions_and_invalid_identifiers() {
    for invalid in [
        json!({
            "protocolVersion": 1,
            "requestId": "request-1",
            "type": "request_permissions",
            "permissions": ["screen", "screen"]
        }),
        json!({
            "protocolVersion": 1,
            "requestId": "request-1\nforged",
            "type": "ping"
        }),
        json!({
            "protocolVersion": 1,
            "requestId": "request-1",
            "type": "ping",
            "extra": true
        }),
        json!({
            "protocolVersion": 1,
            "requestId": "request-1",
            "type": "execute_action",
            "envelope": {
                "unexpected": true
            }
        }),
        json!({
            "protocolVersion": 1,
            "requestId": "request-1",
            "type": "execute_action",
            "envelope": valid_envelope(json!({
                "type": "move",
                "point": { "x": 0.5, "y": 0.5 },
                "shellCommand": "whoami"
            }))
        }),
        json!({
            "protocolVersion": 1,
            "requestId": "request-1",
            "type": "execute_action",
            "envelope": {
                "computerSessionId": "session-1",
                "actionId": "action-1",
                "actuatorLeaseId": "lease-1",
                "observedFrameId": "frame-1",
                "observedTreeVersion": "tree-1",
                "targetAppId": "app-1",
                "targetWindowId": "100",
                "action": { "type": "move", "point": { "x": 0.5, "y": 0.5 } },
                "policyContext": {
                    "effect": "run_arbitrary_code",
                    "target": { "kind": "shell", "id": "100" },
                    "dataClasses": ["credential", "credential"]
                },
                "intent": "invalid policy"
            }
        }),
    ] {
        assert!(HostRequest::parse(&request(invalid)).is_err());
    }
}

#[test]
fn rejects_oversized_keyboard_and_text_actions_at_the_wire_boundary() {
    let too_many_keys = json!({
        "protocolVersion": 1,
        "requestId": "request-1",
        "type": "execute_action",
        "envelope": valid_envelope(json!({
            "type": "keypress",
            "keys": ["Control", "Shift", "Alt", "Meta", "A", "B", "C", "D", "E"]
        }))
    });
    assert!(HostRequest::parse(&request(too_many_keys)).is_err());

    let oversized_text = json!({
        "protocolVersion": 1,
        "requestId": "request-2",
        "type": "execute_action",
        "envelope": valid_envelope(json!({
            "type": "type_text",
            "text": "x".repeat(20_001)
        }))
    });
    assert!(HostRequest::parse(&request(oversized_text)).is_err());

    let oversized_drag = json!({
        "protocolVersion": 1,
        "requestId": "request-3",
        "type": "execute_action",
        "envelope": valid_envelope(json!({
            "type": "drag",
            "from": { "x": 0.1, "y": 0.1 },
            "to": { "x": 0.9, "y": 0.9 },
            "durationMs": 251
        }))
    });
    assert!(HostRequest::parse(&request(oversized_drag)).is_err());
}
