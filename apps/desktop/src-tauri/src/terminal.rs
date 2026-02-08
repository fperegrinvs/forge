use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
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
const OUTPUT_BUFFER_MAX_CHUNKS: usize = 256;

struct Session {
    child: Box<dyn portable_pty::Child + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    input_tx: mpsc::Sender<Vec<u8>>,
    output_tx: broadcast::Sender<Vec<u8>>,
    // Stores output produced while there are no WebSocket receivers.
    // When a receiver attaches, we drain and flush this buffer into the socket.
    output_buffer: Arc<Mutex<VecDeque<Vec<u8>>>>,
    created_at: Instant,
}

pub struct SessionAttach {
    pub input_tx: mpsc::Sender<Vec<u8>>,
    pub output_rx: broadcast::Receiver<Vec<u8>>,
}

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

        // Codex CLI has been observed to abort on macOS when spawned directly under a PTY.
        // Wrapping through `script` allocates a PTY in a way Codex is happier with.
        let mut cmd = if cfg!(target_os = "macos") && config.command == "codex" {
            let mut cb = portable_pty::CommandBuilder::new("/usr/bin/script");
            cb.arg("-q");
            cb.arg("/dev/null");
            cb.arg("codex");
            cb
        } else {
            portable_pty::CommandBuilder::new(&config.command)
        };

        for arg in &config.args {
            cmd.arg(arg);
        }
        for (k, v) in &config.env {
            cmd.env(k, v);
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

        let (output_tx, _output_rx) = broadcast::channel::<Vec<u8>>(256);
        let output_buffer: Arc<Mutex<VecDeque<Vec<u8>>>> = Arc::new(Mutex::new(VecDeque::new()));
        let had_receivers: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
        let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(256);

        // Keep the PTY master open and draining even if the WS disconnects.
        // This avoids the child seeing EIO on stdout when the master closes.
        {
            let output_tx = output_tx.clone();
            let output_buffer = Arc::clone(&output_buffer);
            let had_receivers = Arc::clone(&had_receivers);
            let mut reader = reader;
            std::thread::spawn(move || {
                use std::io::Read;
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let chunk = buf[..n].to_vec();
                            let has_receivers = output_tx.receiver_count() > 0;
                            if has_receivers {
                                had_receivers.store(true, Ordering::Relaxed);
                                // Ignore send errors (e.g. lagged receivers); keep draining.
                                let _ = output_tx.send(chunk);
                            } else {
                                // On transition from connected -> disconnected, clear any old buffer so
                                // new attaches only replay output that was missed.
                                if had_receivers.swap(false, Ordering::Relaxed) {
                                    if let Ok(mut q) = output_buffer.lock() {
                                        q.clear();
                                    }
                                }
                                if let Ok(mut q) = output_buffer.lock() {
                                    q.push_back(chunk);
                                    while q.len() > OUTPUT_BUFFER_MAX_CHUNKS {
                                        q.pop_front();
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("terminal: pty read error: {e}");
                            break;
                        }
                    }
                }
            });
        }

        {
            let mut writer = writer;
            std::thread::spawn(move || {
                use std::io::Write;
                while let Some(data) = input_rx.blocking_recv() {
                    if let Err(e) = writer.write_all(&data) {
                        eprintln!("terminal: pty write error: {e}");
                        break;
                    }
                    let _ = writer.flush();
                }
            });
        }

        let id = uuid::Uuid::new_v4().to_string();
        let session = Session {
            child,
            master: pair.master,
            input_tx,
            output_tx,
            output_buffer,
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
            Some(mut session) => {
                let _ = session.child.kill();
                Ok(())
            }
            None => Err(format!("session not found: {id}")),
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        match sessions.get(id) {
            Some(session) => {
                session
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

    pub fn attach(&self, id: &str) -> Result<SessionAttach, String> {
        let sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        let session = sessions.get(id).ok_or_else(|| format!("session not found: {id}"))?;
        Ok(SessionAttach {
            input_tx: session.input_tx.clone(),
            output_rx: session.output_tx.subscribe(),
        })
    }

    pub fn drain_output_buffer(&self, id: &str) -> Result<Vec<Vec<u8>>, String> {
        let sessions = self.sessions.lock().map_err(|e| format!("lock: {e}"))?;
        let session = sessions.get(id).ok_or_else(|| format!("session not found: {id}"))?;
        let mut out = Vec::new();
        if let Ok(mut q) = session.output_buffer.lock() {
            while let Some(chunk) = q.pop_front() {
                out.push(chunk);
            }
        }
        Ok(out)
    }

    pub fn cleanup_stale(&self) -> usize {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };

        let stale_ids: Vec<String> = sessions
            .iter()
            .filter_map(|(id, session)| {
                if session.created_at.elapsed() >= SESSION_TIMEOUT {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        let mut removed: Vec<Session> = Vec::new();
        for id in &stale_ids {
            if let Some(session) = sessions.remove(id) {
                removed.push(session);
            }
        }
        drop(sessions);

        for mut session in removed {
            let _ = session.child.kill();
        }

        stale_ids.len()
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

    pub fn session_exists(&self, id: &str) -> bool {
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
            env: HashMap::new(),
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
        // When the session is attached
        let result = mgr.attach(&id);
        // Then attach succeeds and session remains
        assert!(result.is_ok());
        assert!(mgr.session_exists(&id));
    }
}
