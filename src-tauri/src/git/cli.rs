//! Thin wrapper around the system `git` executable. Every invocation is
//! recorded in an in-memory activity log, and picks up app-level settings
//! (git path, SSH key, integration tokens) from `CliConfig`.

use super::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfig {
    /// Custom git executable; empty means `git` from PATH.
    pub git_path: String,
    /// Private key to force via GIT_SSH_COMMAND (when not using the agent).
    pub ssh_key: Option<String>,
    /// Keep command output in the activity log.
    pub extended_log: bool,
    /// HTTPS hosts → (username, token) from connected integrations.
    #[serde(skip)]
    pub tokens: Vec<(String, String, String)>,
}

static CONFIG: RwLock<Option<CliConfig>> = RwLock::new(None);

pub fn configure(mut cfg: CliConfig) {
    let mut cur = CONFIG.write().unwrap();
    if let Some(old) = cur.as_ref() {
        cfg.tokens = old.tokens.clone();
    }
    *cur = Some(cfg);
}

pub fn set_tokens(tokens: Vec<(String, String, String)>) {
    let mut cur = CONFIG.write().unwrap();
    cur.get_or_insert_with(CliConfig::default).tokens = tokens;
}

fn config() -> CliConfig {
    CONFIG.read().unwrap().clone().unwrap_or_default()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub time: u64,
    pub cwd: String,
    pub args: String,
    pub ok: bool,
    pub ms: u64,
    pub output: String,
}

static LOG: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());
static LOG_ID: Mutex<u64> = Mutex::new(0);

fn record(cwd: &str, args: &[&str], ok: bool, start: Instant, out: &[u8], err: &[u8]) {
    let cfg = config();
    let mut id = LOG_ID.lock().unwrap();
    *id += 1;
    let output = if cfg.extended_log || !ok {
        let mut s = String::from_utf8_lossy(err).into_owned();
        if cfg.extended_log {
            s.push_str(&String::from_utf8_lossy(out));
        }
        s.chars().take(4000).collect()
    } else {
        String::new()
    };
    let mut log = LOG.lock().unwrap();
    log.push_back(LogEntry {
        id: *id,
        time: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        cwd: cwd.to_string(),
        args: args.join(" "),
        ok,
        ms: start.elapsed().as_millis() as u64,
        output,
    });
    while log.len() > 500 {
        log.pop_front();
    }
}

pub fn activity_log() -> Vec<LogEntry> {
    LOG.lock().unwrap().iter().cloned().collect()
}

pub fn clear_log() {
    LOG.lock().unwrap().clear();
}

/// Hides the console window that Windows would otherwise flash.
pub fn no_window(c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = c;
}

fn command(cwd: &str) -> Command {
    let cfg = config();
    let git = if cfg.git_path.trim().is_empty() { "git" } else { cfg.git_path.trim() };
    let mut c = Command::new(git);
    c.current_dir(cwd)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        // Never block on an interactive prompt; credential helpers still work.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Accept default messages (merge commits, squashes) without an editor.
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no");
    if let Some(key) = cfg.ssh_key.filter(|k| !k.trim().is_empty()) {
        let key = key.replace('\\', "/");
        c.env("GIT_SSH_COMMAND", format!("ssh -i \"{key}\" -o IdentitiesOnly=yes"));
    }
    // Serve integration tokens for their HTTPS hosts. The empty helper resets
    // any configured helpers for that host so ours is the only one asked.
    for (i, (host, user, token)) in cfg.tokens.iter().enumerate() {
        let var = format!("CORVUS_TOKEN_{i}");
        c.env(&var, token);
        c.arg("-c").arg(format!("credential.https://{host}.helper="));
        c.arg("-c").arg(format!(
            "credential.https://{host}.helper=!f() {{ test \"$1\" = get && echo username={user} && echo password=${var}; }}; f"
        ));
    }
    no_window(&mut c);
    c
}

fn failure(args: &[&str], stdout: &[u8], stderr: &[u8]) -> Error {
    let err = String::from_utf8_lossy(stderr);
    let out = String::from_utf8_lossy(stdout);
    let detail = [err.trim(), out.trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Error::Msg(format!("git {} failed\n{}", args.join(" "), detail))
}

pub fn run(cwd: &str, args: &[&str]) -> Result<String> {
    run_with(cwd, args, None, &[])
}

/// Runs git and returns (success, stdout) without treating a non-zero exit
/// as an error (for commands that signal results through the exit code).
pub fn run_status(cwd: &str, args: &[&str]) -> Result<(bool, String)> {
    let start = Instant::now();
    let mut c = command(cwd);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = c.output()?;
    record(cwd, args, out.status.success(), start, &out.stdout, &out.stderr);
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
}

pub fn run_with(
    cwd: &str,
    args: &[&str],
    stdin: Option<&str>,
    envs: &[(&str, &str)],
) -> Result<String> {
    let start = Instant::now();
    let mut c = command(cwd);
    c.args(args)
        .envs(envs.iter().copied())
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn()?;
    if let Some(input) = stdin {
        child.stdin.take().expect("piped stdin").write_all(input.as_bytes())?;
    }
    let out = child.wait_with_output()?;
    record(cwd, args, out.status.success(), start, &out.stdout, &out.stderr);
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(failure(args, &out.stdout, &out.stderr))
    }
}

/// Runs git, reporting each progress line (stderr, split on `\r`/`\n`).
pub fn run_streaming(cwd: &str, args: &[&str], mut on_line: impl FnMut(&str)) -> Result<String> {
    let start = Instant::now();
    let mut c = command(cwd);
    c.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn()?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut all_err = Vec::new();
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stderr.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        for &b in &chunk[..n] {
            all_err.push(b);
            if b == b'\r' || b == b'\n' {
                if !line.is_empty() {
                    on_line(&String::from_utf8_lossy(&line));
                    line.clear();
                }
            } else {
                line.push(b);
            }
        }
    }
    if !line.is_empty() {
        on_line(&String::from_utf8_lossy(&line));
    }
    let status = child.wait()?;
    let out = out_thread.join().unwrap_or_default();
    record(cwd, args, status.success(), start, &out, &all_err);
    if status.success() {
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Err(failure(args, &out, &all_err))
    }
}

/// Forward-slash path, safe to embed in a single-quoted sh string.
pub fn sh_path(p: &std::path::Path) -> String {
    p.to_string_lossy().replace('\\', "/").replace('\'', "'\\''")
}
