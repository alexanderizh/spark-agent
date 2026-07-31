use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, OnceLock, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GA_ROOT, GetAncestor, GetForegroundWindow, GetMessageW, KBDLLHOOKSTRUCT,
    LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, SetWindowsHookExW, UnhookWindowsHookEx,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WindowFromPoint,
};

const IDLE_WINDOW: Duration = Duration::from_millis(300);
const MAX_IDLE_WAIT: Duration = Duration::from_secs(5);
const RECENT_CLICK_WINDOW: Duration = Duration::from_secs(5);

static STATE: OnceLock<Arc<Mutex<UserInputState>>> = OnceLock::new();
static AVAILABLE: OnceLock<bool> = OnceLock::new();

#[derive(Default)]
struct UserInputState {
    bindings: HashMap<String, isize>,
    takeover: HashSet<String>,
    recent_clicks: VecDeque<(Instant, isize)>,
    last_real_input: Option<Instant>,
}

#[derive(Clone, Copy)]
pub struct WindowsUserInputMonitor;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserInputError {
    Takeover,
    Busy,
}

impl WindowsUserInputMonitor {
    pub fn new() -> Option<Self> {
        STATE.get_or_init(|| Arc::new(Mutex::new(UserInputState::default())));
        let available = *AVAILABLE.get_or_init(start_hooks);
        available.then_some(Self)
    }

    pub fn bind_session(&self, session_id: &str, hwnd: isize, observed_at: Instant) {
        let mut state = lock_state();
        let previous = state.bindings.insert(session_id.to_owned(), hwnd);
        if previous.is_some_and(|value| value != hwnd) {
            state.takeover.remove(session_id);
        }
        let now = Instant::now();
        state
            .recent_clicks
            .retain(|(at, _)| now.duration_since(*at) <= RECENT_CLICK_WINDOW);
        if state
            .recent_clicks
            .iter()
            .any(|(at, clicked_hwnd)| *at >= observed_at && *clicked_hwnd == hwnd)
        {
            state.takeover.insert(session_id.to_owned());
        }
    }

    pub fn clear_session(&self, session_id: &str) {
        let mut state = lock_state();
        state.bindings.remove(session_id);
        state.takeover.remove(session_id);
    }

    pub fn takeover_detected(&self, session_id: &str) -> bool {
        lock_state().takeover.contains(session_id)
    }

    pub fn wait_for_idle(&self, session_id: &str) -> Result<(), UserInputError> {
        let started = Instant::now();
        loop {
            let (takeover, idle) = {
                let state = lock_state();
                (
                    state.takeover.contains(session_id),
                    state
                        .last_real_input
                        .is_none_or(|last| last.elapsed() >= IDLE_WINDOW),
                )
            };
            if takeover {
                return Err(UserInputError::Takeover);
            }
            if idle {
                return Ok(());
            }
            if started.elapsed() >= MAX_IDLE_WAIT {
                return Err(UserInputError::Busy);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn start_hooks() -> bool {
    let (sender, receiver) = mpsc::sync_channel(1);
    if thread::Builder::new()
        .name("spark-user-input-monitor".to_owned())
        .spawn(move || unsafe {
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0);
            let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0);
            let (Ok(mouse), Ok(keyboard)) = (&mouse, &keyboard) else {
                if let Ok(mouse) = mouse {
                    let _ = UnhookWindowsHookEx(mouse);
                }
                if let Ok(keyboard) = keyboard {
                    let _ = UnhookWindowsHookEx(keyboard);
                }
                let _ = sender.send(false);
                return;
            };
            let (mouse, keyboard) = (*mouse, *keyboard);
            let _ = sender.send(true);
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {}
            let _ = UnhookWindowsHookEx(mouse);
            let _ = UnhookWindowsHookEx(keyboard);
        })
        .is_err()
    {
        return false;
    }
    receiver
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false)
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if event.flags & LLMHF_INJECTED == 0 {
            let clicked = matches!(
                wparam.0 as u32,
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN
            );
            record_real_input(
                clicked
                    .then(|| unsafe { GetAncestor(WindowFromPoint(event.pt), GA_ROOT).0 as isize }),
            );
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if event.flags.0 & LLKHF_INJECTED.0 == 0 {
            record_real_input(Some(unsafe { GetForegroundWindow().0 as isize }));
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn record_real_input(clicked_hwnd: Option<isize>) {
    let now = Instant::now();
    let mut state = lock_state();
    state.last_real_input = Some(now);
    if let Some(hwnd) = clicked_hwnd.filter(|value| *value != 0) {
        state.recent_clicks.push_back((now, hwnd));
        while state.recent_clicks.len() > 64 {
            state.recent_clicks.pop_front();
        }
        let affected = state
            .bindings
            .iter()
            .filter_map(|(session_id, target)| (*target == hwnd).then_some(session_id.clone()))
            .collect::<Vec<_>>();
        state.takeover.extend(affected);
    }
}

fn lock_state() -> std::sync::MutexGuard<'static, UserInputState> {
    STATE
        .get()
        .expect("user input monitor state must be initialized")
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
