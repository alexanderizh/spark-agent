use spark_computer_host::tree_render::{MAX_TOTAL_UTF16, render_markdown};
use spark_computer_host::uia_policy::RawUiaNode;

fn node(runtime_key: &str, name: &str, depth: u32) -> RawUiaNode {
    let mut node = RawUiaNode::text(name, "").with_runtime_key(runtime_key);
    node.depth = depth;
    node
}

#[test]
fn renders_hierarchical_outline_with_line_index_ids() {
    let nodes = vec![
        node("w", "Settings", 0),
        node("g", "Sidebar", 1),
        node("b1", "General", 2),
        node("b2", "Network", 2),
        node("e", "Search", 1),
    ];
    let refs: Vec<_> = nodes.iter().collect();
    let tree = render_markdown(&refs);
    assert_eq!(
        tree.text,
        "- text \"Settings\" [1]\n  - text \"Sidebar\" [2]\n    - text \"General\" [3]\n    - text \"Network\" [4]\n  - text \"Search\" [5]"
    );
    assert_eq!(tree.lines[2].element_id, "3");
    assert_eq!(tree.lines[2].runtime_key, "b1");
    assert_eq!(tree.omitted_count, 0);
}

#[test]
fn drops_nameless_unactionable_leaf_noise() {
    let nodes = vec![
        node("w", "Window", 0),
        node("pad", "", 1), // layout padder: no name, no value, no actions
        node("btn", "OK", 1),
    ];
    let refs: Vec<_> = nodes.iter().collect();
    let tree = render_markdown(&refs);
    assert!(tree.text.contains("OK"));
    assert_eq!(tree.lines.len(), 2);
    assert_eq!(tree.omitted_count, 1);
    // Ids stay dense after the omission.
    assert!(tree.text.contains("[2]"));
    assert_eq!(tree.lines[1].runtime_key, "btn");
}

#[test]
fn checkbox_values_render_as_state_markers() {
    let mut checkbox = RawUiaNode::text("Connect automatically", "1").with_runtime_key("cb");
    checkbox.depth = 0;
    checkbox.role = "check box".into();
    let refs: Vec<_> = vec![&checkbox];
    let tree = render_markdown(&refs);
    assert!(tree.text.contains("[checked]"));
    assert!(!tree.text.contains("= \"1\""));
}

#[test]
fn budget_overrun_degrades_to_truncation_marker() {
    let mut nodes = Vec::new();
    for index in 0..20_000 {
        nodes.push(node(
            &format!("k{index}"),
            &"long name ".repeat(20),
            0,
        ));
    }
    let refs: Vec<_> = nodes.iter().collect();
    let tree = render_markdown(&refs);
    assert!(tree.text.encode_utf16().count() <= MAX_TOTAL_UTF16 + 80);
    assert!(tree.text.contains("[truncated:"));
    assert!(tree.omitted_count > 0);
}

#[test]
fn identical_input_renders_identical_text() {
    let nodes = vec![node("w", "Window", 0), node("b", "OK", 1)];
    let refs: Vec<_> = nodes.iter().collect();
    assert_eq!(render_markdown(&refs).text, render_markdown(&refs).text);
}
