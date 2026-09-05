use spark_computer_host::uia_policy::{
    RawUiaNode, TreeMode, UiaRect, UiaTreeError, UiaTreeState, allow_value_write,
    can_reuse_uia_cache, sanitize_uia_tree,
};
use std::time::Duration;

fn button(runtime_key: &str, name: &str) -> RawUiaNode {
    RawUiaNode::text(name, "").with_runtime_key(runtime_key)
}

#[test]
fn accessibility_cache_requires_matching_target_subscription_generation_and_age() {
    let age = Duration::from_millis(500);
    let max_age = Duration::from_secs(1);
    assert!(can_reuse_uia_cache(true, true, 4, 7, 7, age, max_age));
    assert!(!can_reuse_uia_cache(false, true, 4, 7, 7, age, max_age));
    assert!(!can_reuse_uia_cache(true, false, 4, 7, 7, age, max_age));
    assert!(!can_reuse_uia_cache(true, true, 0, 7, 7, age, max_age));
    assert!(!can_reuse_uia_cache(true, true, 4, 7, 8, age, max_age));
    assert!(!can_reuse_uia_cache(
        true,
        true,
        4,
        7,
        7,
        Duration::from_millis(1_001),
        max_age,
    ));
}

#[test]
fn secure_value_writes_require_an_explicit_sensitive_envelope() {
    assert!(!allow_value_write(true, false));
    assert!(!allow_value_write(true, true));
    assert!(allow_value_write(false, false));
}

#[test]
fn published_bounds_are_finite_and_within_the_wire_contract() {
    let mut node = RawUiaNode::text("oversized", "value").with_runtime_key("node");
    node.bounds = UiaRect {
        x: f64::NAN,
        y: -900_000.0,
        width: 900_000.0,
        height: f64::INFINITY,
    };
    let sanitized = sanitize_uia_tree(vec![node]);
    assert_eq!(
        sanitized[0].bounds,
        UiaRect {
            x: 0.0,
            y: -131_072.0,
            width: 131_072.0,
            height: 1.0,
        }
    );
}

#[test]
fn password_and_provider_secure_nodes_never_publish_values() {
    let nodes = vec![
        RawUiaNode::text("username", "alice").with_runtime_key("user"),
        RawUiaNode::password("password", "correct horse battery staple")
            .with_runtime_key("password"),
        RawUiaNode::text("card security code", "123")
            .with_runtime_key("cvv")
            .provider_secure(),
    ];

    let sanitized = sanitize_uia_tree(nodes);
    assert_eq!(sanitized[0].value.as_deref(), Some("alice"));
    for secure in &sanitized[1..] {
        assert_eq!(secure.value, None);
        assert_eq!(secure.name, "Sensitive field");
        assert!(secure.redacted);
    }
}

#[test]
fn renders_markdown_outline_with_stable_content_hash_version() {
    let mut state = UiaTreeState::new();
    let baseline = state.observe(
        vec![button("root/ok", "OK"), button("root/cancel", "Cancel")],
        None,
        true,
    );
    // Diff mode is retired: every observation is the full Markdown outline.
    assert_eq!(baseline.mode, TreeMode::Full);
    assert_eq!(baseline.elements.len(), 2);
    assert!(baseline.text.contains("- text \"OK\" [1]"));
    assert!(baseline.text.contains("- text \"Cancel\" [2]"));

    let changed = state.observe(
        vec![
            button("root/ok", "Approved"),
            button("root/cancel", "Cancel"),
        ],
        Some(&baseline.tree_version),
        false,
    );
    assert_eq!(changed.mode, TreeMode::Full);
    assert!(changed.text.contains("Approved"));
    assert!(changed.text.contains("Cancel"));
    assert_ne!(changed.tree_version, baseline.tree_version);

    // An unchanged UI re-renders to the identical content-hash version, so
    // "nothing moved" is detectable by comparing versions alone.
    let again = state.observe(
        vec![
            button("root/ok", "Approved"),
            button("root/cancel", "Cancel"),
        ],
        Some(&changed.tree_version),
        false,
    );
    assert_eq!(again.tree_version, changed.tree_version);
}

#[test]
fn element_references_expire_when_tree_version_changes() {
    let mut state = UiaTreeState::new();
    let baseline = state.observe(vec![button("root/ok", "OK")], None, true);
    let element_id = baseline.elements[0].id.clone();
    assert_eq!(
        state.resolve(&element_id, &baseline.tree_version).unwrap(),
        "root/ok"
    );

    let changed = state.observe(
        vec![button("root/ok", "Approved")],
        Some(&baseline.tree_version),
        false,
    );
    assert_eq!(
        state.resolve(&element_id, &baseline.tree_version),
        Err(UiaTreeError::StaleTree)
    );
    assert!(state.resolve(&element_id, &changed.tree_version).is_ok());
}
