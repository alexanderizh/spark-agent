use spark_computer_host::cancellation_policy::{CanceledSessionRegistry, MAX_CANCELED_SESSIONS};

#[test]
fn registry_saturation_fails_closed_instead_of_reauthorizing_old_sessions() {
    let mut registry = CanceledSessionRegistry::default();
    registry.cancel("old-session".into());
    for index in 1..MAX_CANCELED_SESSIONS {
        registry.cancel(format!("session-{index}"));
    }
    assert!(registry.rejects("old-session"));

    registry.cancel("overflow-session".into());
    assert!(registry.is_saturated());
    assert!(registry.rejects("old-session"));
    assert!(registry.rejects("brand-new-session"));
}
