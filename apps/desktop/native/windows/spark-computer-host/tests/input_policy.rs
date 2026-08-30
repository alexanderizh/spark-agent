use spark_computer_host::input_policy::{
    InputAction, InputPolicy, InputPolicyError, ScreenPoint, TargetWindow, VirtualDesktop,
};
use spark_computer_host::protocol::ComputerAction;

fn target() -> TargetWindow {
    TargetWindow {
        hwnd: 100,
        process_id: 200,
        executable_identity: "sha256:trusted".into(),
        foreground: true,
        secure_desktop: false,
    }
}

#[test]
fn maps_negative_virtual_desktop_coordinates_to_sendinput_space() {
    let desktop = VirtualDesktop::new(-1920, -200, 4480, 1640).unwrap();
    assert_eq!(
        desktop
            .to_absolute(ScreenPoint { x: -1920, y: -200 })
            .unwrap(),
        ScreenPoint { x: 0, y: 0 }
    );
    assert_eq!(
        desktop
            .to_absolute(ScreenPoint { x: 2559, y: 1439 })
            .unwrap(),
        ScreenPoint {
            x: 65_535,
            y: 65_535
        }
    );
    assert_eq!(
        desktop.to_absolute(ScreenPoint { x: 2560, y: 1439 }),
        Err(InputPolicyError::InvalidCoordinate)
    );
}

#[test]
fn rejects_secure_desktop_and_foreground_identity_drift() {
    let expected = target();
    let action = InputAction::Move { x: 10, y: 20 };
    assert_eq!(
        InputPolicy::validate(
            &action,
            &expected,
            &TargetWindow {
                secure_desktop: true,
                ..expected.clone()
            },
        ),
        Err(InputPolicyError::SecureDesktop)
    );
    for changed in [
        TargetWindow {
            hwnd: 101,
            ..expected.clone()
        },
        TargetWindow {
            process_id: 201,
            ..expected.clone()
        },
        TargetWindow {
            executable_identity: "sha256:other".into(),
            ..expected.clone()
        },
        TargetWindow {
            foreground: false,
            ..expected.clone()
        },
    ] {
        assert_eq!(
            InputPolicy::validate(&action, &expected, &changed),
            Err(InputPolicyError::FocusMismatch)
        );
    }
}

#[test]
fn enforces_key_count_and_utf16_text_limits() {
    let target = target();
    assert!(
        InputPolicy::validate(
            &InputAction::KeyPress {
                virtual_keys: vec![0x11, 0x41]
            },
            &target,
            &target,
        )
        .is_ok()
    );
    assert_eq!(
        InputPolicy::validate(
            &InputAction::KeyPress {
                virtual_keys: vec![0x41; 9]
            },
            &target,
            &target,
        ),
        Err(InputPolicyError::ResourceLimit)
    );
    assert_eq!(
        InputPolicy::validate(
            &InputAction::TypeText("😀".repeat(10_001)),
            &target,
            &target,
        ),
        Err(InputPolicyError::ResourceLimit)
    );
}

#[test]
fn secure_fields_allow_navigation_but_reject_text_and_writable_keypresses() {
    assert!(spark_computer_host::input_policy::secure_field_allows(
        &ComputerAction::Keypress {
            keys: vec!["Tab".into()]
        }
    ));
    assert!(!spark_computer_host::input_policy::secure_field_allows(
        &ComputerAction::Keypress {
            keys: vec!["A".into()]
        }
    ));
    assert!(!spark_computer_host::input_policy::secure_field_allows(
        &ComputerAction::TypeText {
            text: "secret".into(),
            sensitive: Some(false),
        }
    ));
}
