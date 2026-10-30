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
    /// Tokens of connected integrations, for their HTTPS hosts.
    #[serde(skip)]
    pub tokens: Vec<HostToken>,
}

/// A connected integration's token, presented to git for one HTTPS host.
#[derive(Clone, Debug, PartialEq)]
pub struct HostToken {
    /// `host[:port]`, as in `https://<host>/owner/repo.git`.
    pub host: String,
    pub username: String,
    pub token: String,
}

/// The remotes a network operation talks to. Git receives only the tokens
/// for their hosts, and local operations receive none, so hooks, filters and
/// tools started by git never see credentials they don't need.
pub enum Reach<'a> {
    /// Every remote of the repository (`fetch --all`, `pull`, `push`).
    Remotes,
    /// One remote of the repository, by name.
    Remote(&'a str),
    /// The URLs of the repository's submodules.
    Submodules,
    /// A URL that is not a remote yet (`clone`).
    Url(&'a str),
}

static CONFIG: RwLock<Option<CliConfig>> = RwLock::new(None);

pub fn configure(mut cfg: CliConfig) {
    let mut cur = CONFIG.write().unwrap();
    if let Some(old) = cur.as_ref() {
        cfg.tokens = old.tokens.clone();
    }
    *cur = Some(cfg);
}

pub fn set_tokens(tokens: Vec<HostToken>) {
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
    no_window(&mut c);
    c
}

/// `command`, serving the integration tokens for the hosts `reach` talks to.
/// The empty helper resets any configured helpers for such a host so ours is
/// the only one asked.
fn network_command(cwd: &str, reach: &Reach) -> Result<Command> {
    let mut c = command(cwd);
    let urls = reach_urls(cwd, reach)?;
    for (i, t) in tokens_for(&config().tokens, &urls).into_iter().enumerate() {
        let var = format!("CORVUS_TOKEN_{i}");
        c.env(&var, &t.token);
        c.arg("-c").arg(format!("credential.https://{}.helper=", t.host));
        c.arg("-c").arg(format!(
            "credential.https://{}.helper=!f() {{ test \"$1\" = get && echo username={} && echo password=${var}; }}; f",
            t.host, t.username
        ));
    }
    Ok(c)
}

/// The fetch and push URLs `reach` stands for.
fn reach_urls(cwd: &str, reach: &Reach) -> Result<Vec<String>> {
    let repo = || super::open(cwd);
    match reach {
        Reach::Url(url) => Ok(vec![url.to_string()]),
        Reach::Remote(name) => remote_urls(&repo()?, name),
        Reach::Remotes => {
            let repo = repo()?;
            let mut urls = Vec::new();
            for name in repo.remotes()?.iter().flatten().flatten() {
                urls.extend(remote_urls(&repo, name)?);
            }
            Ok(urls)
        }
        Reach::Submodules => Ok(repo()?.submodules()?.iter().filter_map(|s| s.url().ok().flatten().map(String::from)).collect()),
    }
}

fn remote_urls(repo: &git2::Repository, name: &str) -> Result<Vec<String>> {
    let remote = repo.find_remote(name)?;
    let mut urls = vec![remote.url()?.to_string()];
    urls.extend(remote.pushurl()?.map(String::from));
    Ok(urls)
}

/// The tokens whose host one of `urls` points at over HTTPS.
fn tokens_for<'a>(tokens: &'a [HostToken], urls: &[String]) -> Vec<&'a HostToken> {
    let hosts: Vec<&str> = urls.iter().filter_map(|u| https_host(u)).collect();
    tokens
        .iter()
        .filter(|t| hosts.iter().any(|h| h.eq_ignore_ascii_case(&t.host)))
        .collect()
}

/// The `host[:port]` of an `https://` URL, without any user info.
fn https_host(url: &str) -> Option<&str> {
    let scheme = url.get(..8)?;
    if !scheme.eq_ignore_ascii_case("https://") {
        return None;
    }
    let authority = url[8..].split(['/', '?', '#']).next()?;
    Some(authority.rsplit_once('@').map_or(authority, |(_, host)| host))
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

/// Runs a git network operation that reaches `reach`.
pub fn run_remote(cwd: &str, args: &[&str], reach: Reach) -> Result<String> {
    run_remote_streaming(cwd, args, reach, |_| {})
}

/// Runs a git network operation that reaches `reach`, reporting each progress
/// line (stderr, split on `\r`/`\n`).
pub fn run_remote_streaming(cwd: &str, args: &[&str], reach: Reach, mut on_line: impl FnMut(&str)) -> Result<String> {
    let start = Instant::now();
    let mut c = network_command(cwd, &reach)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn token(host: &str) -> HostToken {
        HostToken { host: host.into(), username: "x-access-token".into(), token: format!("secret-{host}") }
    }

    #[test]
    fn https_host_strips_user_info_and_path() {
        assert_eq!(https_host("https://github.com/o/r.git"), Some("github.com"));
        assert_eq!(https_host("HTTPS://user:pw@git.example.com:8443/o/r"), Some("git.example.com:8443"));
        assert_eq!(https_host("https://gitlab.com"), Some("gitlab.com"));
        assert_eq!(https_host("http://github.com/o/r"), None);
        assert_eq!(https_host("git@github.com:o/r.git"), None);
        assert_eq!(https_host("/home/me/repo"), None);
    }

    #[test]
    fn only_tokens_for_reached_hosts_are_served() {
        let tokens = [token("github.com"), token("gitlab.com"), token("git.example.com")];
        let urls = ["https://GitHub.com/o/r.git".to_string(), "git@gitlab.com:o/r.git".to_string()];
        assert_eq!(tokens_for(&tokens, &urls), [&tokens[0]]);
        assert!(tokens_for(&tokens, &[]).is_empty());
    }
}
