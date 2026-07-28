use std::collections::HashSet;

pub const MAX_CANCELED_SESSIONS: usize = 10_000;

#[derive(Default)]
pub struct CanceledSessionRegistry {
    sessions: HashSet<String>,
    saturated: bool,
}

impl CanceledSessionRegistry {
    pub fn cancel(&mut self, session_id: String) {
        if self.saturated {
            return;
        }
        if self.sessions.len() >= MAX_CANCELED_SESSIONS {
            self.sessions.clear();
            self.saturated = true;
            return;
        }
        self.sessions.insert(session_id);
    }

    pub fn rejects(&self, session_id: &str) -> bool {
        self.saturated || self.sessions.contains(session_id)
    }

    pub fn is_saturated(&self) -> bool {
        self.saturated
    }
}
