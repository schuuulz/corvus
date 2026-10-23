//! Machine-level helpers: secrets (OS keychain), SSH and GPG keys, external
//! tool detection/launching, and file writes.

use crate::git::{cli, msg, Error, Result};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

const SERVICE: &str = "kraken-craft";

fn entry(key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).map_err(|e| Error::Msg(e.to_string()))
}

pub fn secret_set(key: &str, value: &str) -> Result<()> {
    entry(key)?.set_password(value).map_err(|e| Error::Msg(e.to_string()))
}

pub fn secret_get(key: &str) -> Option<String> {
    entry(key).ok()?.get_password().ok()
}

pub fn secret_delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Msg(e.to_string())),
    }
}

fn tool(program: &str) -> Command {
    let mut c = Command::new(program);
    cli::no_window(&mut c);
    c
}

fn run_tool(c: &mut Command) -> Result<String> {
    let out = c.output().map_err(|e| Error::Msg(format!("{e}")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        msg(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
        .replace('\\', "/")
}

// --- SSH -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyPair {
    pub private_key: String,
    pub public_key: String,
}

pub fn ssh_generate(path: Option<&str>, comment: &str, passphrase: &str) -> Result<SshKeyPair> {
    let path = path
        .map(String::from)
        .unwrap_or_else(|| format!("{}/.ssh/corvus_ed25519", home()));
    if Path::new(&path).exists() {
        return msg(format!("{path} already exists"));
    }
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir)?;
    }
    run_tool(tool("ssh-keygen").args(["-t", "ed25519", "-f", &path, "-N", passphrase, "-C", comment]))?;
    Ok(SshKeyPair { public_key: format!("{path}.pub"), private_key: path })
}

pub fn read_text(path: &str) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

pub fn write_text(path: &str, content: &str) -> Result<()> {
    Ok(std::fs::write(path, content)?)
}

// --- GPG -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpgKey {
    pub id: String,
    pub uid: String,
    pub expires: Option<i64>,
}

pub fn gpg_list(program: &str) -> Result<Vec<GpgKey>> {
    let out = run_tool(tool(program).args(["--list-secret-keys", "--keyid-format=long", "--with-colons"]))?;
    let mut keys: Vec<GpgKey> = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split(':').collect();
        match f.first() {
            Some(&"sec") => keys.push(GpgKey {
                id: f.get(4).unwrap_or(&"").to_string(),
                uid: String::new(),
                expires: f.get(6).and_then(|s| s.parse().ok()),
            }),
            Some(&"uid") => {
                if let Some(k) = keys.last_mut().filter(|k| k.uid.is_empty()) {
                    k.uid = f.get(9).unwrap_or(&"").to_string();
                }
            }
            _ => {}
        }
    }
    Ok(keys)
}

pub fn gpg_generate(program: &str, name: &str, email: &str, passphrase: &str) -> Result<()> {
    let uid = format!("{name} <{email}>");
    let mut c = tool(program);
    c.args(["--batch", "--pinentry-mode", "loopback", "--passphrase", passphrase, "--quick-gen-key", &uid, "rsa4096", "sign", "2y"]);
    run_tool(&mut c).map(|_| ())
}

// --- external tools --------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTool {
    pub id: &'static str,
    pub name: &'static str,
    /// "editor" | "terminal" | "merge"
    pub kind: &'static str,
    pub path: String,
}

fn which(program: &str) -> Option<String> {
    let finder = if cfg!(windows) { "where" } else { "which" };
    let out = tool(finder).arg(program).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn first_existing(paths: &[String]) -> Option<String> {
    paths.iter().find(|p| Path::new(p).exists()).cloned()
}

pub fn detect_tools() -> Vec<ExternalTool> {
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:/Program Files".into());
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:/Program Files (x86)".into());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let candidates: Vec<(&'static str, &'static str, &'static str, Vec<String>, &'static str)> = vec![
        ("vscode", "Visual Studio Code", "editor", vec![format!("{local}/Programs/Microsoft VS Code/Code.exe"), format!("{pf}/Microsoft VS Code/Code.exe")], "code"),
        ("cursor", "Cursor", "editor", vec![format!("{local}/Programs/cursor/Cursor.exe")], "cursor"),
        ("sublime", "Sublime Text", "editor", vec![format!("{pf}/Sublime Text/sublime_text.exe")], "subl"),
        ("notepadpp", "Notepad++", "editor", vec![format!("{pf}/Notepad++/notepad++.exe"), format!("{pf86}/Notepad++/notepad++.exe")], "notepad++"),
        ("idea", "IntelliJ IDEA", "editor", vec![], "idea64"),
        ("wt", "Windows Terminal", "terminal", vec![format!("{local}/Microsoft/WindowsApps/wt.exe")], "wt"),
        ("pwsh", "PowerShell 7", "terminal", vec![format!("{pf}/PowerShell/7/pwsh.exe")], "pwsh"),
        ("powershell", "Windows PowerShell", "terminal", vec![], "powershell"),
        ("gitbash", "Git Bash", "terminal", vec![format!("{pf}/Git/git-bash.exe")], "git-bash"),
        ("cmd", "Command Prompt", "terminal", vec![], "cmd"),
        ("vscode-merge", "Visual Studio Code", "merge", vec![], "code"),
        ("meld", "Meld", "merge", vec![format!("{pf}/Meld/Meld.exe"), format!("{pf86}/Meld/Meld.exe")], "meld"),
        ("kdiff3", "KDiff3", "merge", vec![format!("{pf}/KDiff3/kdiff3.exe")], "kdiff3"),
        ("bc", "Beyond Compare", "merge", vec![format!("{pf}/Beyond Compare 5/BComp.exe"), format!("{pf}/Beyond Compare 4/BComp.exe")], "bcomp"),
        ("p4merge", "P4Merge", "merge", vec![format!("{pf}/Perforce/p4merge.exe")], "p4merge"),
    ];
    candidates
        .into_iter()
        .filter_map(|(id, name, kind, paths, bin)| {
            let path = first_existing(&paths).or_else(|| which(bin))?;
            Some(ExternalTool { id, name, kind, path: path.replace('\\', "/") })
        })
        .collect()
}

/// git's built-in mergetool name for our tool ids.
fn mergetool_name(id: &str) -> &str {
    match id {
        "vscode-merge" => "vscode",
        "bc" => "bc",
        other => other,
    }
}

pub fn open_in_editor(tool_path: &str, target: &str) -> Result<()> {
    Command::new(tool_path).arg(target).spawn()?;
    Ok(())
}

pub fn open_terminal(tool_id: &str, tool_path: &str, dir: &str) -> Result<()> {
    let mut c = Command::new(tool_path);
    match tool_id {
        "wt" => {
            c.args(["-d", dir]);
        }
        "gitbash" => {
            c.arg(format!("--cd={dir}"));
        }
        "cmd" => {
            c.args(["/c", "start", "cmd", "/k", &format!("cd /d \"{dir}\"")]);
        }
        "pwsh" | "powershell" => {
            c.args(["-NoExit", "-Command", &format!("Set-Location -LiteralPath '{}'", dir.replace('\'', "''"))]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
                c.creation_flags(CREATE_NEW_CONSOLE);
            }
        }
        _ => {
            c.current_dir(dir);
        }
    }
    c.current_dir(dir).spawn()?;
    Ok(())
}

pub fn open_merge_tool(repo: &str, file: &str, tool_id: Option<&str>) -> Result<()> {
    let mut args = vec!["mergetool", "--no-prompt"];
    if let Some(t) = tool_id.filter(|t| !t.is_empty() && *t != "default") {
        args.extend(["--tool", mergetool_name(t)]);
    }
    args.extend(["--", file]);
    cli::run(repo, &args).map(|_| ())
}
