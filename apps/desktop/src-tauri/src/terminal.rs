use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

const SESSION_TIMEOUT: Duration = Duration::from_secs(30 * 60); // 30 minutes

struct Session {
    _child: Box<dyn portable_pty::Child + Send>,
    writer: Box<dyn std::io::Write + Send>,
    reader: Box<dyn std::io::Read + Send>,
    _pair: portable_pty::PtyPair,
    created_at: Instant,
}

pub type SessionIo = (
    Box<dyn std::io::Read + Send>,
    Box<dyn std::io::Write + Send>,
);

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(&self, config: SpawnConfig) -> Result<String, String> {
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = portable_pty::CommandBuilder::new(&config.command);
        for arg in &config.args {
            cmd.arg(arg);
        }
        if let Some(ref cwd) = config.cwd {
            cmd.cwd(cwd);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer: {e}"))?;

        let id = uuid::Uuid::new_v4().to_string();
        let session = Session {
            _child: child,
            writer,
            reader,
            _pair: pair,
            created_at: Instant::now(),
        };

        self.sessions
            .lock()
            .map_err(|e| format!("lock: {e}"))?
            .insert(id.clone(), session);

        Ok(id)
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        match sessions.remove(id) {
            Some(_session) => Ok(()),
            None => Err(format!("session not found: {id}")),
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        match sessions.get(id) {
            Some(session) => {
                session
                    ._pair
                    .master
                    .resize(portable_pty::PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|e| format!("resize: {e}"))
            }
            None => Err(format!("session not found: {id}")),
        }
    }

    pub fn take_io(&self, id: &str) -> Result<SessionIo, String> {
        let mut sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        match sessions.remove(id) {
            Some(session) => Ok((session.reader, session.writer)),
            None => Err(format!("session not found: {id}")),
        }
    }

    pub fn cleanup_stale(&self) -> usize {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };
        let before = sessions.len();
        sessions.retain(|_, session| session.created_at.elapsed() < SESSION_TIMEOUT);
        before - sessions.len()
    }

    pub async fn run_cleanup_loop(self) {
        let interval = SESSION_TIMEOUT / 2;
        loop {
            tokio::time::sleep(interval).await;
            let removed = self.cleanup_stale();
            if removed > 0 {
                eprintln!("terminal: cleaned up {removed} stale session(s)");
            }
        }
    }

    #[cfg(test)]
    fn session_exists(&self, id: &str) -> bool {
        self.sessions
            .lock()
            .map(|s| s.contains_key(id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manager() -> TerminalManager {
        TerminalManager::new()
    }

    fn echo_config() -> SpawnConfig {
        // Use /bin/sh -c "echo hello" as a quick cross-platform command
        SpawnConfig {
            command: "/bin/sh".to_string(),
            args: vec!["-c".to_string(), "echo hello && sleep 1".to_string()],
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn spawn_creates_session() {
        // Given a terminal manager
        let mgr = make_manager();
        // When a session is spawned
        let id = mgr.spawn(echo_config()).expect("spawn should succeed");
        // Then the session exists
        assert!(mgr.session_exists(&id));
    }

    #[test]
    fn kill_removes_session() {
        // Given a spawned session
        let mgr = make_manager();
        let id = mgr.spawn(echo_config()).expect("spawn should succeed");
        // When the session is killed
        mgr.kill(&id).expect("kill should succeed");
        // Then the session no longer exists
        assert!(!mgr.session_exists(&id));
    }

    #[test]
    fn kill_unknown_returns_error() {
        // Given a terminal manager with no sessions
        let mgr = make_manager();
        // When killing an unknown session
        let result = mgr.kill("nonexistent");
        // Then an error is returned
        assert!(result.is_err());
    }

    #[test]
    fn resize_changes_pty_size() {
        // Given a spawned session
        let mgr = make_manager();
        let id = mgr.spawn(echo_config()).expect("spawn should succeed");
        // When the session is resized
        let result = mgr.resize(&id, 120, 40);
        // Then resize succeeds
        assert!(result.is_ok());
    }

    #[test]
    fn resize_unknown_returns_error() {
        // Given a terminal manager with no sessions
        let mgr = make_manager();
        // When resizing an unknown session
        let result = mgr.resize("nonexistent", 80, 24);
        // Then an error is returned
        assert!(result.is_err());
    }

    #[test]
    fn take_io_removes_session_and_returns_handles() {
        // Given a spawned session
        let mgr = make_manager();
        let id = mgr.spawn(echo_config()).expect("spawn should succeed");
        // When IO handles are taken
        let result = mgr.take_io(&id);
        // Then handles are returned and session is removed
        assert!(result.is_ok());
        assert!(!mgr.session_exists(&id));
    }
}
