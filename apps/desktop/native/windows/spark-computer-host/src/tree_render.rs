//! Markdown outline renderer for the UIA element tree — the Windows mirror
//! of the macOS `NativeAXTreeRenderer`. The decision model reads the same
//! hierarchical format on both platforms:
//!
//! ```text
//! - window "Settings" [1]
//!   - group "Sidebar" [2]
//!     - button "General" [3]
//!   - edit "Search" = "vpn" [focused] [5]
//!   - checkbox "Connect automatically" [checked] [6]
//! ```
//!
//! Element ids are dense line indexes ("1", "2", ...) stable for the tree
//! version they were rendered in. Invisible leaf noise is dropped; line-level
//! budgets bound the payload so a huge tree degrades into a truncation marker
//! instead of a prompt bomb.

use crate::uia_policy::RawUiaNode;

/// Per-line budgets in UTF-16 units (parity with the macOS renderer).
pub const MAX_NAME_UTF16: usize = 160;
pub const MAX_VALUE_UTF16: usize = 240;
/// Total rendered-text budget: comfortably below the 2 MB wire cap and the
/// 32k-char decision-prompt budget so the TS side never re-truncates.
pub const MAX_TOTAL_UTF16: usize = 90_000;
const MAX_INDENT_DEPTH: usize = 24;

pub struct RenderedLine {
    pub element_id: String,
    pub text: String,
    pub runtime_key: String,
    pub depth: u32,
    /// Index of the source node in the input slice, so callers can recover
    /// the full node (bounds, actions, flags) for the wire element payload.
    pub node_index: usize,
}

pub struct RenderedTree {
    pub lines: Vec<RenderedLine>,
    pub text: String,
    pub omitted_count: usize,
}

/// Renders the flat pre-order node list (each node carrying its `depth`)
/// into the outline. Nodes must be in pre-order; a child always follows its
/// parent with a strictly greater depth.
pub fn render_markdown(nodes: &[&RawUiaNode]) -> RenderedTree {
    let mut lines: Vec<RenderedLine> = Vec::new();
    let mut text_segments: Vec<String> = Vec::new();
    let mut text_units: usize = 0;
    let mut omitted: usize = 0;
    let mut budget_exhausted = false;

    for (index, node) in nodes.iter().enumerate() {
        let depth = node_depth(nodes, index);
        let is_leaf = index + 1 >= nodes.len() || node_depth(nodes, index + 1) <= depth;
        if is_noise(node, is_leaf) {
            omitted += 1;
            continue;
        }
        if budget_exhausted {
            omitted += 1;
            continue;
        }
        let element_id = (lines.len() + 1).to_string();
        let line = render_line(node, depth, &element_id);
        let line_units = line.encode_utf16().count();
        let separator_units = if text_segments.is_empty() { 0 } else { 1 };
        if text_units + separator_units + line_units > MAX_TOTAL_UTF16 {
            budget_exhausted = true;
            omitted += 1;
            continue;
        }
        lines.push(RenderedLine {
            element_id,
            text: line.clone(),
            runtime_key: node.runtime_key.clone(),
            depth,
            node_index: index,
        });
        text_segments.push(line);
        text_units += separator_units + line_units;
    }

    let mut text = text_segments.join("\n");
    if budget_exhausted {
        let marker = format!("[truncated: {omitted} elements omitted]");
        if text.is_empty() {
            text = marker;
        } else {
            text.push('\n');
            text.push_str(&marker);
        }
    }
    RenderedTree {
        lines,
        text,
        omitted_count: omitted,
    }
}

/// Leaf elements with no name, no value, no actions, not focused: layout
/// padders, empty groups, image shells. Dropping them routinely removes more
/// than half of a real UIA tree.
fn is_noise(node: &RawUiaNode, is_leaf: bool) -> bool {
    if !is_leaf {
        return false;
    }
    let empty_name = node.name.trim().is_empty();
    let empty_value = node
        .value
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    empty_name && empty_value && node.actions.is_empty() && !node.focused
}

fn render_line(node: &RawUiaNode, depth: u32, element_id: &str) -> String {
    let indent = "  ".repeat((depth as usize).min(MAX_INDENT_DEPTH));
    let mut parts: Vec<String> = vec![format!("- {}", role_word(node))];
    let name = inline(&node.name, MAX_NAME_UTF16);
    if !name.is_empty() {
        parts.push(format!("\"{name}\""));
    }
    let marker = state_marker(node);
    if let Some(marker) = marker {
        parts.push(marker.to_string());
    }
    let value = inline(node.value.as_deref().unwrap_or(""), MAX_VALUE_UTF16);
    // The state marker already expresses checkbox/radio values; repeating
    // the raw "1"/"0" only adds noise.
    if marker.is_none() && !value.is_empty() {
        parts.push(format!("= \"{value}\""));
    }
    if !node.enabled {
        parts.push("[disabled]".into());
    }
    if node.focused {
        parts.push("[focused]".into());
    }
    parts.push(format!("[{element_id}]"));
    format!("{indent}{}", parts.join(" "))
}

/// Prefer the app's own human wording (UIA LocalizedControlType) over the raw
/// control type string; both already arrive in `role`.
fn role_word(node: &RawUiaNode) -> String {
    if node.role.trim().is_empty() {
        return "unknown".into();
    }
    inline(&node.role, 60)
}

/// Checkbox/radio/switch controls expose 0/1 toggle values that read terribly
/// as text; render them as explicit state markers instead.
fn state_marker(node: &RawUiaNode) -> Option<&'static str> {
    let value = node.value.as_deref().unwrap_or("").trim();
    let role = node.role.to_ascii_lowercase();
    let is_toggle = role.contains("checkbox")
        || role.contains("check box")
        || role.contains("radio")
        || role.contains("switch");
    if !is_toggle {
        return None;
    }
    if value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("on") {
        return Some("[checked]");
    }
    if value == "0" || value.eq_ignore_ascii_case("false") || value.eq_ignore_ascii_case("off") {
        return Some("[unchecked]");
    }
    None
}

/// Collapses whitespace and clips to `limit` UTF-16 units (appends an
/// ellipsis when clipped so the model knows text was cut).
fn inline(value: &str, limit: usize) -> String {
    let normalized: String = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.encode_utf16().count() <= limit {
        return normalized;
    }
    let mut clipped: String = String::new();
    let mut units = 1; // reserve room for the ellipsis
    for ch in normalized.chars() {
        let ch_units = ch.len_utf16();
        if units + ch_units > limit {
            break;
        }
        clipped.push(ch);
        units += ch_units;
    }
    clipped.push('…');
    clipped
}

fn node_depth(nodes: &[&RawUiaNode], index: usize) -> u32 {
    nodes
        .get(index)
        .map(|node| node.depth)
        .unwrap_or_default()
}
