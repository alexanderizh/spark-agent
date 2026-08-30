use spark_computer_host::input_policy::{InputAction, InputPolicy, TargetWindow};
use spark_computer_host::parent_auth::{
    ParentIdentity, ParentTrustPolicy, ReleaseBinaryIdentity, ReleaseBinaryTrustPolicy,
    allows_pinned_self_signed_chain_failure,
};
use spark_computer_host::uia_policy::{RawUiaNode, sanitize_uia_tree};

#[test]
fn parent_must_be_the_same_signed_sparkwork_image_and_stable_process() {
    let trusted = ParentIdentity {
        product_name: "SparkWork".into(),
        publisher_thumbprint: "A".repeat(64),
        image_path: r"C:\Program Files\SparkWork\SparkWork.exe".into(),
        signed: true,
        process_id_before: 42,
        process_id_after: 42,
        creation_time_before: 123_456,
        creation_time_after: 123_456,
    };
    ParentTrustPolicy::validate(&trusted, &"A".repeat(64)).unwrap();

    for attacker in [
        ParentIdentity {
            signed: false,
            ..trusted.clone()
        },
        ParentIdentity {
            product_name: "node.exe".into(),
            ..trusted.clone()
        },
        ParentIdentity {
            publisher_thumbprint: "B".repeat(64),
            ..trusted.clone()
        },
        ParentIdentity {
            process_id_after: 43,
            ..trusted.clone()
        },
        ParentIdentity {
            creation_time_after: 654_321,
            ..trusted.clone()
        },
    ] {
        assert!(ParentTrustPolicy::validate(&attacker, &"A".repeat(64)).is_err());
    }
}

#[test]
fn host_binary_must_itself_be_signed_by_the_embedded_release_publisher() {
    let trusted = ReleaseBinaryIdentity {
        publisher_thumbprint: "A".repeat(64),
        signed: true,
    };
    ReleaseBinaryTrustPolicy::validate(&trusted, &"A".repeat(64)).unwrap();
    assert!(
        ReleaseBinaryTrustPolicy::validate(
            &ReleaseBinaryIdentity {
                signed: false,
                ..trusted.clone()
            },
            &"A".repeat(64),
        )
        .is_err()
    );
    assert!(ReleaseBinaryTrustPolicy::validate(&trusted, &"B".repeat(64)).is_err());
}

#[test]
fn pinned_self_signed_release_allows_only_chain_and_revocation_availability_failures() {
    for status in [
        0x800B0109_u32 as i32, // CERT_E_UNTRUSTEDROOT
        0x80092013_u32 as i32, // CRYPT_E_REVOCATION_OFFLINE
        0x800B010E_u32 as i32, // CERT_E_REVOCATION_FAILURE
        0x800B0004_u32 as i32, // TRUST_E_SUBJECT_NOT_TRUSTED
    ] {
        assert!(allows_pinned_self_signed_chain_failure(status));
    }

    for status in [
        0,
        0x80096010_u32 as i32, // TRUST_E_BAD_DIGEST
    ] {
        assert!(!allows_pinned_self_signed_chain_failure(status));
    }
}

#[test]
fn secure_uia_nodes_are_redacted_before_serialization() {
    let nodes = vec![
        RawUiaNode::text("username", "alice"),
        RawUiaNode::password("password", "correct horse battery staple"),
    ];
    let sanitized = sanitize_uia_tree(nodes);
    assert_eq!(sanitized[0].value.as_deref(), Some("alice"));
    assert_eq!(sanitized[1].value, None);
    assert!(sanitized[1].redacted);
}

#[test]
fn input_requires_matching_foreground_identity_and_bounded_actions() {
    let target = TargetWindow {
        hwnd: 100,
        process_id: 200,
        executable_identity: "signed:publisher/app.exe".into(),
        foreground: true,
        secure_desktop: false,
    };
    assert!(InputPolicy::validate(&InputAction::Click { x: 10, y: 20 }, &target, &target).is_ok());
    assert!(
        InputPolicy::validate(&InputAction::TypeText("x".repeat(20_001)), &target, &target)
            .is_err()
    );
    assert!(
        InputPolicy::validate(
            &InputAction::Click { x: 10, y: 20 },
            &target,
            &TargetWindow {
                hwnd: 101,
                ..target.clone()
            },
        )
        .is_err()
    );
    assert!(
        InputPolicy::validate(
            &InputAction::Click { x: 10, y: 20 },
            &target,
            &TargetWindow {
                secure_desktop: true,
                ..target.clone()
            },
        )
        .is_err()
    );
}
