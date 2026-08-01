use std::collections::{HashMap, HashSet};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

use thiserror::Error;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    CoUninitialize, SAFEARRAY,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationEventHandler,
    IUIAutomationEventHandler_Impl, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationScrollPattern, IUIAutomationSelectionItemPattern,
    IUIAutomationStructureChangedEventHandler, IUIAutomationStructureChangedEventHandler_Impl,
    IUIAutomationValuePattern, ScrollAmount_LargeDecrement, ScrollAmount_LargeIncrement,
    ScrollAmount_NoAmount, ScrollAmount_SmallDecrement, ScrollAmount_SmallIncrement,
    StructureChangeType, TreeScope_Descendants, TreeScope_Subtree, UIA_EVENT_ID,
    UIA_ExpandCollapsePatternId, UIA_InvokePatternId, UIA_LayoutInvalidatedEventId,
    UIA_ScrollPatternId, UIA_SelectionItemPatternId, UIA_Text_TextChangedEventId,
    UIA_Text_TextSelectionChangedEventId, UIA_ValuePatternId, UIA_Window_WindowClosedEventId,
    UIA_Window_WindowOpenedEventId,
};
use windows::core::{BSTR, Interface, Ref, implement};

use crate::protocol::{ComputerAction, ElementAction};
use crate::uia_policy::{
    RawUiaNode, UiaRect, UiaTreeError, UiaTreeSnapshot, UiaTreeState, allow_value_write,
    can_reuse_uia_cache,
};

const MAX_TREE_ELEMENTS: usize = 100_000;
const MAX_TREE_TEXT_BYTES: usize = 2_000_000;
const MAX_CACHE_AGE: Duration = Duration::from_secs(1);
const CACHE_INVALIDATION_EVENTS: [UIA_EVENT_ID; 5] = [
    UIA_LayoutInvalidatedEventId,
    UIA_Text_TextChangedEventId,
    UIA_Text_TextSelectionChangedEventId,
    UIA_Window_WindowOpenedEventId,
    UIA_Window_WindowClosedEventId,
];

#[implement(IUIAutomationEventHandler, IUIAutomationStructureChangedEventHandler)]
struct UiaChangeHandler {
    generation: Arc<AtomicU64>,
}

impl UiaChangeHandler {
    fn invalidate(&self) {
        increment_generation(&self.generation);
    }
}

#[allow(non_snake_case)]
impl IUIAutomationEventHandler_Impl for UiaChangeHandler_Impl {
    fn HandleAutomationEvent(
        &self,
        _sender: Ref<'_, IUIAutomationElement>,
        _eventid: UIA_EVENT_ID,
    ) -> windows::core::Result<()> {
        self.invalidate();
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IUIAutomationStructureChangedEventHandler_Impl for UiaChangeHandler_Impl {
    fn HandleStructureChangedEvent(
        &self,
        _sender: Ref<'_, IUIAutomationElement>,
        _changetype: StructureChangeType,
        _runtimeid: *const SAFEARRAY,
    ) -> windows::core::Result<()> {
        self.invalidate();
        Ok(())
    }
}

struct UiaEventSubscription {
    hwnd: isize,
    root: IUIAutomationElement,
    automation_handler: IUIAutomationEventHandler,
    structure_handler: IUIAutomationStructureChangedEventHandler,
}

#[derive(Debug, Error)]
pub enum UiaError {
    #[error("UI Automation is unavailable")]
    Unavailable,
    #[error("the requested UI Automation tree is stale")]
    StaleTree,
    #[error("the requested UI Automation element does not exist")]
    ElementNotFound,
    #[error("the requested semantic action is unsupported")]
    UnsupportedAction,
    #[error("sensitive UI Automation values cannot be read or written")]
    SensitiveElement,
    #[error("UI Automation operation failed")]
    OperationFailed,
}

pub struct UiaRuntime {
    automation: IUIAutomation,
    tree: UiaTreeState,
    elements: HashMap<String, IUIAutomationElement>,
    secure_runtime_keys: HashSet<String>,
    cached_nodes: Vec<RawUiaNode>,
    cached_hwnd: Option<isize>,
    cached_generation: u64,
    last_traversal: Option<Instant>,
    dirty_generation: Arc<AtomicU64>,
    subscription: Option<UiaEventSubscription>,
    com_initialized: bool,
}

impl UiaRuntime {
    pub fn new() -> Result<Self, UiaError> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|_| UiaError::Unavailable)?;
        let automation = match unsafe {
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        } {
            Ok(automation) => automation,
            Err(_) => {
                unsafe { CoUninitialize() };
                return Err(UiaError::Unavailable);
            }
        };
        Ok(Self {
            automation,
            tree: UiaTreeState::new(),
            elements: HashMap::new(),
            secure_runtime_keys: HashSet::new(),
            cached_nodes: Vec::new(),
            cached_hwnd: None,
            cached_generation: 0,
            last_traversal: None,
            dirty_generation: Arc::new(AtomicU64::new(1)),
            subscription: None,
            com_initialized: true,
        })
    }

    pub fn observe(
        &mut self,
        hwnd: isize,
        previous_tree_version: Option<&str>,
        full_tree: bool,
    ) -> Result<UiaTreeSnapshot, UiaError> {
        let root = unsafe { self.automation.ElementFromHandle(HWND(hwnd as *mut _)) }
            .map_err(|_| UiaError::Unavailable)?;
        if self.subscription.as_ref().map(|value| value.hwnd) != Some(hwnd) {
            self.replace_subscription(hwnd, &root);
        }
        let generation = self.dirty_generation.load(Ordering::Acquire);
        let can_reuse = self.last_traversal.is_some_and(|traversal| {
            can_reuse_uia_cache(
                self.cached_hwnd == Some(hwnd),
                self.subscription.is_some(),
                self.cached_nodes.len(),
                self.cached_generation,
                generation,
                traversal.elapsed(),
                MAX_CACHE_AGE,
            )
        });
        if can_reuse {
            return self.publish_nodes(self.cached_nodes.clone(), previous_tree_version, full_tree);
        }
        let condition =
            unsafe { self.automation.CreateTrueCondition() }.map_err(|_| UiaError::Unavailable)?;
        let descendants = unsafe { root.FindAll(TreeScope_Descendants, &condition) }
            .map_err(|_| UiaError::OperationFailed)?;
        let length = unsafe { descendants.Length() }
            .map_err(|_| UiaError::OperationFailed)?
            .max(0) as usize;
        if length >= MAX_TREE_ELEMENTS {
            return Err(UiaError::OperationFailed);
        }

        let mut raw_nodes = Vec::with_capacity(length.saturating_add(1));
        let mut elements = HashMap::with_capacity(length.saturating_add(1));
        let mut secure_runtime_keys = HashSet::new();
        self.collect_element(
            hwnd,
            0,
            root,
            &mut raw_nodes,
            &mut elements,
            &mut secure_runtime_keys,
        );
        for index in 0..length {
            let Ok(element) = (unsafe { descendants.GetElement(index as i32) }) else {
                continue;
            };
            self.collect_element(
                hwnd,
                index.saturating_add(1),
                element,
                &mut raw_nodes,
                &mut elements,
                &mut secure_runtime_keys,
            );
        }
        let snapshot = self.publish_nodes(raw_nodes.clone(), previous_tree_version, full_tree)?;
        self.elements = elements;
        self.secure_runtime_keys = secure_runtime_keys;
        self.cached_nodes = raw_nodes;
        self.cached_hwnd = Some(hwnd);
        self.cached_generation = generation;
        self.last_traversal = Some(Instant::now());
        Ok(snapshot)
    }

    pub fn execute(&mut self, action: &ComputerAction, tree_version: &str) -> Result<(), UiaError> {
        self.mark_dirty();
        match action {
            ComputerAction::InvokeElement { element_id, action } => {
                let element = self.resolve(element_id, tree_version)?;
                match action.unwrap_or(ElementAction::Invoke) {
                    ElementAction::Invoke => unsafe {
                        element
                            .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                            .and_then(|pattern| pattern.Invoke())
                    },
                    ElementAction::Select => unsafe {
                        element
                            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                                UIA_SelectionItemPatternId,
                            )
                            .and_then(|pattern| pattern.Select())
                    },
                    ElementAction::Focus => unsafe { element.SetFocus() },
                    ElementAction::Expand => unsafe {
                        element
                            .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                                UIA_ExpandCollapsePatternId,
                            )
                            .and_then(|pattern| pattern.Expand())
                    },
                    ElementAction::Collapse => unsafe {
                        element
                            .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                                UIA_ExpandCollapsePatternId,
                            )
                            .and_then(|pattern| pattern.Collapse())
                    },
                }
                .map_err(|_| UiaError::OperationFailed)
            }
            ComputerAction::SetValue {
                element_id,
                value,
                sensitive,
            } => {
                let runtime_key = self.runtime_key(element_id, tree_version)?.to_owned();
                if !allow_value_write(
                    self.secure_runtime_keys.contains(&runtime_key),
                    sensitive.unwrap_or(false),
                ) {
                    return Err(UiaError::SensitiveElement);
                }
                let element = self
                    .elements
                    .get(&runtime_key)
                    .ok_or(UiaError::ElementNotFound)?;
                let value = BSTR::from(value.as_str());
                unsafe {
                    element
                        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                        .and_then(|pattern| pattern.SetValue(&value))
                }
                .map_err(|_| UiaError::OperationFailed)
            }
            ComputerAction::Scroll {
                element_id: Some(element_id),
                delta_x,
                delta_y,
                ..
            } => {
                let element = self.resolve(element_id, tree_version)?;
                let horizontal = scroll_amount(*delta_x);
                let vertical = scroll_amount(*delta_y);
                unsafe {
                    element
                        .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
                        .and_then(|pattern| pattern.Scroll(horizontal, vertical))
                }
                .map_err(|_| UiaError::OperationFailed)
            }
            _ => Err(UiaError::UnsupportedAction),
        }
    }

    pub fn focused_element_is_secure(&self) -> Result<bool, UiaError> {
        let element = unsafe { self.automation.GetFocusedElement() }
            .map_err(|_| UiaError::SensitiveElement)?;
        let is_password = unsafe { element.CurrentIsPassword() }
            .map(|value| value.as_bool())
            .unwrap_or(true);
        if is_password {
            return Ok(true);
        }
        let role = bstr_or(&unsafe { element.CurrentLocalizedControlType() }, "unknown");
        let name = bstr_or(&unsafe { element.CurrentName() }, "");
        let automation_id = bstr_or(&unsafe { element.CurrentAutomationId() }, "");
        let class_name = bstr_or(&unsafe { element.CurrentClassName() }, "");
        Ok(is_sensitive_provider(
            &role,
            &name,
            &automation_id,
            &class_name,
        ))
    }

    fn resolve(
        &self,
        element_id: &str,
        tree_version: &str,
    ) -> Result<&IUIAutomationElement, UiaError> {
        let key = self.runtime_key(element_id, tree_version)?;
        self.elements.get(key).ok_or(UiaError::ElementNotFound)
    }

    fn runtime_key(&self, element_id: &str, tree_version: &str) -> Result<&str, UiaError> {
        self.tree
            .resolve(element_id, tree_version)
            .map_err(|error| match error {
                UiaTreeError::StaleTree => UiaError::StaleTree,
                UiaTreeError::ElementNotFound => UiaError::ElementNotFound,
            })
    }

    fn collect_element(
        &self,
        hwnd: isize,
        index: usize,
        element: IUIAutomationElement,
        nodes: &mut Vec<RawUiaNode>,
        elements: &mut HashMap<String, IUIAutomationElement>,
        secure_runtime_keys: &mut HashSet<String>,
    ) {
        let role = bstr_or(&unsafe { element.CurrentLocalizedControlType() }, "unknown");
        let name = bstr_or(&unsafe { element.CurrentName() }, "");
        let automation_id = bstr_or(&unsafe { element.CurrentAutomationId() }, "");
        let class_name = bstr_or(&unsafe { element.CurrentClassName() }, "");
        let is_password = unsafe { element.CurrentIsPassword() }
            .map(|value| value.as_bool())
            .unwrap_or(true);
        let provider_secure = is_sensitive_provider(&role, &name, &automation_id, &class_name);
        let runtime_key = format!("{hwnd}:{index}:{automation_id}:{class_name}:{role}");
        let bounds = unsafe { element.CurrentBoundingRectangle() }
            .ok()
            .map(|rect| UiaRect {
                x: f64::from(rect.left),
                y: f64::from(rect.top),
                width: f64::from(rect.right.saturating_sub(rect.left).max(0)),
                height: f64::from(rect.bottom.saturating_sub(rect.top).max(0)),
            })
            .unwrap_or_default();
        let enabled = unsafe { element.CurrentIsEnabled() }
            .map(|value| value.as_bool())
            .unwrap_or(false);
        let focused = unsafe { element.CurrentHasKeyboardFocus() }
            .map(|value| value.as_bool())
            .unwrap_or(false);
        let mut actions = Vec::with_capacity(5);
        if unsafe { element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) }
            .is_ok()
        {
            actions.push("invoke".into());
        }
        let value_pattern =
            unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
                .ok();
        if value_pattern.is_some() && !is_password && !provider_secure {
            actions.push("set_value".into());
        }
        if unsafe {
            element.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                UIA_SelectionItemPatternId,
            )
        }
        .is_ok()
        {
            actions.push("select".into());
        }
        if unsafe { element.GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId) }
            .is_ok()
        {
            actions.push("scroll".into());
        }
        if unsafe { element.CurrentIsKeyboardFocusable() }
            .map(|value| value.as_bool())
            .unwrap_or(false)
        {
            actions.push("focus".into());
        }
        if unsafe {
            element.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                UIA_ExpandCollapsePatternId,
            )
        }
        .is_ok()
        {
            actions.push("expand".into());
            actions.push("collapse".into());
        }
        let value = if is_password || provider_secure {
            None
        } else {
            value_pattern
                .and_then(|pattern| unsafe { pattern.CurrentValue() }.ok())
                .map(|value| value.to_string())
        };
        let mut node = RawUiaNode::text(name, value.as_deref().unwrap_or_default())
            .with_runtime_key(&runtime_key);
        node.role = role;
        node.value = value;
        node.bounds = bounds;
        node.enabled = enabled;
        node.focused = focused;
        node.actions = actions;
        node.is_password = is_password;
        node.provider_secure = provider_secure;
        if is_password || provider_secure {
            secure_runtime_keys.insert(runtime_key.clone());
        }
        nodes.push(node);
        elements.insert(runtime_key, element);
    }

    fn publish_nodes(
        &mut self,
        nodes: Vec<RawUiaNode>,
        previous_tree_version: Option<&str>,
        full_tree: bool,
    ) -> Result<UiaTreeSnapshot, UiaError> {
        let snapshot = self.tree.observe(nodes, previous_tree_version, full_tree);
        if snapshot.elements.len() > MAX_TREE_ELEMENTS || snapshot.text.len() > MAX_TREE_TEXT_BYTES
        {
            return Err(UiaError::OperationFailed);
        }
        Ok(snapshot)
    }

    fn mark_dirty(&self) {
        increment_generation(&self.dirty_generation);
    }

    fn replace_subscription(&mut self, hwnd: isize, root: &IUIAutomationElement) {
        self.remove_subscription();
        self.mark_dirty();
        self.cached_hwnd = None;
        self.cached_nodes.clear();
        self.last_traversal = None;

        let event_handler: IUIAutomationEventHandler = UiaChangeHandler {
            generation: Arc::clone(&self.dirty_generation),
        }
        .into();
        let Ok(structure_handler) =
            event_handler.cast::<IUIAutomationStructureChangedEventHandler>()
        else {
            return;
        };
        let Ok(cache_request) = (unsafe { self.automation.CreateCacheRequest() }) else {
            return;
        };
        let mut registered_events = Vec::with_capacity(CACHE_INVALIDATION_EVENTS.len());
        for event_id in CACHE_INVALIDATION_EVENTS {
            if unsafe {
                self.automation.AddAutomationEventHandler(
                    event_id,
                    root,
                    TreeScope_Subtree,
                    &cache_request,
                    &event_handler,
                )
            }
            .is_err()
            {
                self.remove_registered_events(root, &event_handler, &registered_events);
                return;
            }
            registered_events.push(event_id);
        }
        if unsafe {
            self.automation.AddStructureChangedEventHandler(
                root,
                TreeScope_Subtree,
                &cache_request,
                &structure_handler,
            )
        }
        .is_err()
        {
            self.remove_registered_events(root, &event_handler, &registered_events);
            return;
        }
        self.subscription = Some(UiaEventSubscription {
            hwnd,
            root: root.clone(),
            automation_handler: event_handler,
            structure_handler,
        });
    }

    fn remove_registered_events(
        &self,
        root: &IUIAutomationElement,
        handler: &IUIAutomationEventHandler,
        event_ids: &[UIA_EVENT_ID],
    ) {
        for event_id in event_ids {
            let _ = unsafe {
                self.automation
                    .RemoveAutomationEventHandler(*event_id, root, handler)
            };
        }
    }

    fn remove_subscription(&mut self) {
        let Some(subscription) = self.subscription.take() else {
            return;
        };
        self.remove_registered_events(
            &subscription.root,
            &subscription.automation_handler,
            &CACHE_INVALIDATION_EVENTS,
        );
        let _ = unsafe {
            self.automation.RemoveStructureChangedEventHandler(
                &subscription.root,
                &subscription.structure_handler,
            )
        };
    }
}

impl Drop for UiaRuntime {
    fn drop(&mut self) {
        self.remove_subscription();
        if self.com_initialized {
            unsafe { CoUninitialize() };
            self.com_initialized = false;
        }
    }
}

fn increment_generation(generation: &AtomicU64) {
    let _ = generation.fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
        Some(if current == u64::MAX { 1 } else { current + 1 })
    });
}

fn bstr_or(value: &windows::core::Result<BSTR>, fallback: &str) -> String {
    value
        .as_ref()
        .map(BSTR::to_string)
        .unwrap_or_else(|_| fallback.into())
}

fn is_sensitive_provider(role: &str, name: &str, automation_id: &str, class_name: &str) -> bool {
    let combined = format!("{role} {name} {automation_id} {class_name}").to_ascii_lowercase();
    [
        "password",
        "passwd",
        "passcode",
        "credential",
        "security code",
        "secure text",
    ]
    .iter()
    .any(|marker| combined.contains(marker))
}

fn scroll_amount(value: f64) -> windows::Win32::UI::Accessibility::ScrollAmount {
    if value <= -1_000.0 {
        ScrollAmount_LargeDecrement
    } else if value < 0.0 {
        ScrollAmount_SmallDecrement
    } else if value >= 1_000.0 {
        ScrollAmount_LargeIncrement
    } else if value > 0.0 {
        ScrollAmount_SmallIncrement
    } else {
        ScrollAmount_NoAmount
    }
}
