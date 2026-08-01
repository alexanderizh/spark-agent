use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAX_NAME_UTF16_UNITS: usize = 2_000;
const MAX_VALUE_UTF16_UNITS: usize = 20_000;

pub fn can_reuse_uia_cache(
    same_target: bool,
    subscription_active: bool,
    cached_node_count: usize,
    cached_generation: u64,
    current_generation: u64,
    age: Duration,
    max_age: Duration,
) -> bool {
    same_target
        && subscription_active
        && cached_node_count > 0
        && cached_generation == current_generation
        && age <= max_age
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiaRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUiaNode {
    pub runtime_key: String,
    pub role: String,
    pub name: String,
    pub value: Option<String>,
    pub bounds: UiaRect,
    pub enabled: bool,
    pub focused: bool,
    pub actions: Vec<String>,
    pub is_password: bool,
    pub provider_secure: bool,
    pub redacted: bool,
}

impl RawUiaNode {
    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            runtime_key: String::new(),
            role: "text".into(),
            name: name.into(),
            value: Some(value.into()),
            bounds: UiaRect::default(),
            enabled: true,
            focused: false,
            actions: Vec::new(),
            is_password: false,
            provider_secure: false,
            redacted: false,
        }
    }

    pub fn password(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            is_password: true,
            ..Self::text(name, value)
        }
    }

    pub fn with_runtime_key(mut self, runtime_key: impl Into<String>) -> Self {
        self.runtime_key = runtime_key.into();
        self
    }

    pub fn provider_secure(mut self) -> Self {
        self.provider_secure = true;
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedUiaNode {
    pub id: String,
    pub tree_version: String,
    pub role: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub bounds: UiaRect,
    pub enabled: bool,
    pub focused: bool,
    pub actions: Vec<String>,
    #[serde(skip_serializing)]
    pub redacted: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TreeMode {
    Full,
    Diff,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UiaTreeSnapshot {
    pub tree_version: String,
    pub mode: TreeMode,
    pub text: String,
    pub elements: Vec<PublishedUiaNode>,
    pub sensitive_regions: Vec<UiaRect>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum UiaTreeError {
    #[error("element reference belongs to a stale tree")]
    StaleTree,
    #[error("element reference does not exist")]
    ElementNotFound,
}

#[derive(Default)]
pub struct UiaTreeState {
    current_version: Option<String>,
    current_nodes: HashMap<String, PublishedUiaNode>,
    current_runtime_keys: HashMap<String, String>,
}

impl UiaTreeState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(
        &mut self,
        nodes: Vec<RawUiaNode>,
        previous_tree_version: Option<&str>,
        full_tree: bool,
    ) -> UiaTreeSnapshot {
        let sanitized = sanitize_uia_tree(nodes);
        let tree_version = tree_version(&sanitized);
        let published = sanitized
            .iter()
            .map(|node| publish_node(node, &tree_version))
            .collect::<Vec<_>>();
        let next_nodes = published
            .iter()
            .cloned()
            .map(|node| (node.id.clone(), node))
            .collect::<HashMap<_, _>>();
        let can_diff = !full_tree
            && previous_tree_version.is_some()
            && previous_tree_version == self.current_version.as_deref();
        let (mode, elements, text) = if can_diff {
            let changed = published
                .iter()
                .filter(|node| {
                    self.current_nodes
                        .get(&node.id)
                        .map(|previous| comparable(previous) != comparable(node))
                        .unwrap_or(true)
                })
                .cloned()
                .collect::<Vec<_>>();
            let removed = self
                .current_nodes
                .keys()
                .filter(|id| !next_nodes.contains_key(*id))
                .cloned()
                .collect::<Vec<_>>();
            let text = serde_json::to_string(&serde_json::json!({
                "changed": changed,
                "removed": removed,
            }))
            .unwrap_or_else(|_| "{\"changed\":[],\"removed\":[]}".into());
            (TreeMode::Diff, published.clone(), text)
        } else {
            let text = serde_json::to_string(&published).unwrap_or_else(|_| "[]".into());
            (TreeMode::Full, published.clone(), text)
        };
        let sensitive_regions = sanitized
            .iter()
            .filter(|node| node.redacted)
            .map(|node| node.bounds)
            .collect();
        self.current_runtime_keys = sanitized
            .iter()
            .zip(published.iter())
            .map(|(raw, node)| (node.id.clone(), raw.runtime_key.clone()))
            .collect();
        self.current_nodes = next_nodes;
        self.current_version = Some(tree_version.clone());
        UiaTreeSnapshot {
            tree_version,
            mode,
            text,
            elements,
            sensitive_regions,
        }
    }

    pub fn resolve(&self, element_id: &str, tree_version: &str) -> Result<&str, UiaTreeError> {
        if self.current_version.as_deref() != Some(tree_version) {
            return Err(UiaTreeError::StaleTree);
        }
        self.current_runtime_keys
            .get(element_id)
            .map(String::as_str)
            .ok_or(UiaTreeError::ElementNotFound)
    }

    pub fn current_version(&self) -> Option<&str> {
        self.current_version.as_deref()
    }
}

pub fn sanitize_uia_tree(nodes: Vec<RawUiaNode>) -> Vec<RawUiaNode> {
    nodes
        .into_iter()
        .map(|mut node| {
            if node.is_password || node.provider_secure {
                node.value = None;
                node.name = "Sensitive field".into();
                node.redacted = true;
            } else if let Some(value) = &mut node.value {
                sanitize_text(value, MAX_VALUE_UTF16_UNITS);
            }
            sanitize_text(&mut node.name, MAX_NAME_UTF16_UNITS);
            sanitize_text(&mut node.role, 120);
            node.actions.truncate(20);
            node.bounds = sanitize_rect(node.bounds);
            node
        })
        .collect()
}

pub fn allow_value_write(secure_element: bool, _sensitive_envelope: bool) -> bool {
    !secure_element
}

fn sanitize_rect(rect: UiaRect) -> UiaRect {
    const LIMIT: f64 = 131_072.0;
    UiaRect {
        x: finite_or_zero(rect.x).clamp(-LIMIT, LIMIT),
        y: finite_or_zero(rect.y).clamp(-LIMIT, LIMIT),
        width: positive_finite_or_one(rect.width).clamp(1.0, LIMIT),
        height: positive_finite_or_one(rect.height).clamp(1.0, LIMIT),
    }
}

fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn positive_finite_or_one(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        1.0
    }
}

fn publish_node(node: &RawUiaNode, tree_version: &str) -> PublishedUiaNode {
    let id = format!(
        "element-{}",
        &hex::encode(Sha256::digest(node.runtime_key.as_bytes()))[..32]
    );
    PublishedUiaNode {
        id,
        tree_version: tree_version.into(),
        role: if node.role.is_empty() {
            "unknown".into()
        } else {
            node.role.clone()
        },
        name: node.name.clone(),
        value: node.value.clone(),
        bounds: node.bounds,
        enabled: node.enabled,
        focused: node.focused,
        actions: node.actions.clone(),
        redacted: node.redacted,
    }
}

fn tree_version(nodes: &[RawUiaNode]) -> String {
    let bytes = serde_json::to_vec(nodes).unwrap_or_default();
    format!("tree-{}", &hex::encode(Sha256::digest(bytes))[..32])
}

fn comparable(
    node: &PublishedUiaNode,
) -> (&str, &str, Option<&str>, UiaRect, bool, bool, &[String]) {
    (
        &node.role,
        &node.name,
        node.value.as_deref(),
        node.bounds,
        node.enabled,
        node.focused,
        &node.actions,
    )
}

fn sanitize_text(value: &mut String, max_units: usize) {
    value.retain(|character| !character.is_control());
    truncate_utf16(value, max_units);
}

fn truncate_utf16(value: &mut String, max_units: usize) {
    if value.encode_utf16().count() <= max_units {
        return;
    }
    let mut units = 0;
    let end = value
        .char_indices()
        .take_while(|(_, character)| {
            units += character.len_utf16();
            units <= max_units
        })
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    value.truncate(end);
}
