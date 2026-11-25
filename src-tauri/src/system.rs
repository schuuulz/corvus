//! Machine-level helpers: secrets (OS keychain), SSH and GPG keys, external
//! tool detection/launching, and file writes.

use crate::git::{cli, msg, Error, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVICE: &str = "corvus";
/// Keychain service used before the rename to Corvus.
const LEGACY_SERVICE: &str = "kraken-craft";

fn entry(service: &str, key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(service, key).map_err(|e| Error::Msg(e.to_string()))
}

pub fn secret_set(key: &str, value: &str) -> Result<()> {
    entry(SERVICE, key)?.set_password(value).map_err(|e| Error::Msg(e.to_string()))
}

pub fn secret_get(key: &str) -> Option<String> {
    entry(SERVICE, key).ok()?.get_password().ok().or_else(|| adopt_legacy_secret(key))
}

/// Moves a secret saved under the legacy service name to the current one.
fn adopt_legacy_secret(key: &str) -> Option<String> {
    let legacy = entry(LEGACY_SERVICE, key).ok()?;
    let value = legacy.get_password().ok()?;
    if secret_set(key, &value).is_ok() {
        // Once copied, a leftover legacy entry is harmless.
        let _ = legacy.delete_credential();
    }
    Some(value)
}

pub fn secret_delete(key: &str) -> Result<()> {
    delete_entry(LEGACY_SERVICE, key)?;
    delete_entry(SERVICE, key)
}

fn delete_entry(service: &str, key: &str) -> Result<()> {
    match entry(service, key)?.delete_credential() {
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

/// Contents of an SSH public key file. Only `.pub` files are read, so the
/// UI can't be used to read private keys or any other file.
pub fn read_public_key(path: &str) -> Result<String> {
    if Path::new(path).extension().is_none_or(|e| e != "pub") {
        return msg(format!("{path} is not a public key (.pub) file"));
    }
    Ok(std::fs::read_to_string(path)?)
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
    /// "editor" | "merge"
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

/// The detected tool `id` of `kind`. Tools are launched only from what
/// `detect_tools` found, never from a program path the UI hands in.
fn detected_tool(kind: &str, id: &str) -> Result<ExternalTool> {
    match detect_tools().into_iter().find(|t| t.kind == kind && t.id == id) {
        Some(tool) => Ok(tool),
        None => msg(format!("{id} is not installed")),
    }
}

pub fn open_in_editor(tool_id: &str, target: &str) -> Result<()> {
    let editor = detected_tool("editor", tool_id)?;
    Command::new(editor.path).arg(target).spawn()?;
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

// --- system apps -----------------------------------------------------------

/// One of the system's default apps, as the UI names it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemApp {
    pub name: String,
}

/// The system's default apps that open a folder: `None` when there is none.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemApps {
    pub file_manager: Option<SystemApp>,
    pub terminal: Option<SystemApp>,
}

pub fn system_apps() -> SystemApps {
    SystemApps {
        file_manager: default_file_manager_name().map(|name| SystemApp { name }),
        terminal: default_terminal().map(|t| SystemApp { name: t.name.into() }),
    }
}

/// `dir` as an existing folder. Repository paths use `/`; the Windows shell
/// wants its own separator.
fn existing_dir(dir: &str) -> Result<PathBuf> {
    let dir = PathBuf::from(dir.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !dir.is_dir() {
        return msg(format!("{} is not a folder", dir.display()));
    }
    Ok(dir)
}

// --- terminal ----------------------------------------------------------------

/// The system's default terminal: what to call it and the program to start.
struct Terminal {
    name: &'static str,
    program: PathBuf,
}

/// Windows PowerShell, the shell every Windows has. Given a console of its
/// own, Windows hands it to the default terminal app (Windows Terminal or the
/// classic console, per Settings › Terminal).
#[cfg(windows)]
fn default_terminal() -> Option<Terminal> {
    let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:/Windows".into());
    let program = Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    program.exists().then_some(Terminal { name: "Terminal", program })
}

/// Terminal.app: macOS has no setting for a default terminal.
#[cfg(target_os = "macos")]
fn default_terminal() -> Option<Terminal> {
    let program = PathBuf::from("/usr/bin/open");
    program.exists().then_some(Terminal { name: "Terminal", program })
}

/// Linux terminals, the desktop's own choice first: `xdg-terminal-exec`
/// (the XDG default terminal) and `x-terminal-emulator` (Debian's).
#[cfg(all(unix, not(target_os = "macos")))]
const LINUX_TERMINALS: [(&str, &str); 6] = [
    ("xdg-terminal-exec", "Terminal"),
    ("x-terminal-emulator", "Terminal"),
    ("gnome-terminal", "GNOME Terminal"),
    ("konsole", "Konsole"),
    ("xfce4-terminal", "Xfce Terminal"),
    ("xterm", "XTerm"),
];

#[cfg(all(unix, not(target_os = "macos")))]
fn default_terminal() -> Option<Terminal> {
    LINUX_TERMINALS
        .iter()
        .find_map(|&(bin, name)| which(bin).map(|program| Terminal { name, program: program.into() }))
}

/// Opens the system's default terminal in `dir`.
pub fn open_terminal(dir: &str) -> Result<()> {
    let dir = existing_dir(dir)?;
    let Some(terminal) = default_terminal() else {
        return msg("No terminal found on this system");
    };
    terminal_command(&terminal.program, &dir).spawn()?;
    Ok(())
}

/// The command that starts `program` (from `default_terminal`) in `dir`.
/// The terminal inherits `dir` as its working directory, so no shell ever
/// parses the path.
#[cfg(windows)]
fn terminal_command(program: &Path, dir: &Path) -> Command {
    // Started directly, the shell would inherit our redirected standard
    // handles, read end-of-input and exit at once. `start` gives it a console
    // of its own; the hidden `cmd` that runs it exits straight away.
    let mut c = tool("cmd");
    c.args(["/c", "start", ""]).arg(program).current_dir(dir);
    c
}

#[cfg(not(windows))]
fn terminal_command(program: &Path, dir: &Path) -> Command {
    let mut c = Command::new(program);
    c.current_dir(dir);
    #[cfg(target_os = "macos")]
    c.args(["-a", "Terminal"]).arg(dir);
    c
}

// --- file manager ----------------------------------------------------------

#[cfg(windows)]
fn default_file_manager_name() -> Option<String> {
    let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:/Windows".into());
    Path::new(&windows).join("explorer.exe").exists().then(|| "File Explorer".into())
}

#[cfg(target_os = "macos")]
fn default_file_manager_name() -> Option<String> {
    Path::new("/usr/bin/open").exists().then(|| "Finder".into())
}

/// The app `xdg-open` hands folders to, named after its desktop entry.
#[cfg(all(unix, not(target_os = "macos")))]
fn default_file_manager_name() -> Option<String> {
    which("xdg-open")?;
    let desktop_id = run_tool(tool("xdg-mime").args(["query", "default", "inode/directory"])).ok()?;
    let desktop_id = desktop_id.trim();
    if desktop_id.is_empty() {
        return None;
    }
    let name = xdg_application_dirs()
        .into_iter()
        .find_map(|dir| std::fs::read_to_string(dir.join(desktop_id)).ok())
        .and_then(|entry| desktop_entry_name(&entry).map(String::from));
    Some(name.unwrap_or_else(|| desktop_id.trim_end_matches(".desktop").to_string()))
}

/// Where desktop entries live, most specific first (XDG Base Directory spec).
#[cfg(all(unix, not(target_os = "macos")))]
fn xdg_application_dirs() -> Vec<std::path::PathBuf> {
    let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{}/.local/share", home()));
    let data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    std::iter::once(data_home.as_str())
        .chain(data_dirs.split(':'))
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join("applications"))
        .collect()
}

/// The untranslated `Name=` of a desktop entry's `[Desktop Entry]` group.
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn desktop_entry_name(entry: &str) -> Option<&str> {
    let mut in_main_group = false;
    for line in entry.lines().map(str::trim) {
        if line.starts_with('[') {
            in_main_group = line == "[Desktop Entry]";
        } else if let Some(name) = line.strip_prefix("Name=").filter(|_| in_main_group) {
            return Some(name.trim()).filter(|n| !n.is_empty());
        }
    }
    None
}

/// Opens `dir` in the system's default file manager.
pub fn open_folder(dir: &str) -> Result<()> {
    let dir = existing_dir(dir)?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| Error::Msg(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_public_key_files() {
        let dir = tempfile::tempdir().unwrap();
        let private = dir.path().join("id_ed25519");
        let public = dir.path().join("id_ed25519.pub");
        std::fs::write(&private, "PRIVATE").unwrap();
        std::fs::write(&public, "ssh-ed25519 AAAA test").unwrap();
        assert!(read_public_key(&private.to_string_lossy()).is_err());
        assert_eq!(read_public_key(&public.to_string_lossy()).unwrap(), "ssh-ed25519 AAAA test");
    }

    #[test]
    fn terminal_keeps_the_directory_out_of_its_command_line() {
        let dir = Path::new("C:/repos/a\" & calc & 'b");
        let c = terminal_command(Path::new("shell"), dir);
        let args: Vec<_> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.iter().all(|a| !a.contains("calc")), "{args:?}");
        assert_eq!(c.get_current_dir(), Some(dir));
    }

    #[test]
    #[cfg(windows)]
    fn windows_terminal_gets_a_console_of_its_own() {
        let c = terminal_command(Path::new("powershell.exe"), Path::new("C:/repo"));
        let args: Vec<_> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(c.get_program(), "cmd");
        assert_eq!(args, ["/c", "start", "", "powershell.exe"]);
    }

    #[test]
    fn open_terminal_and_folder_reject_files_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("README.md");
        std::fs::write(&file, "readme").unwrap();
        for path in [file, dir.path().join("missing")] {
            let path = path.to_string_lossy();
            assert!(open_terminal(&path).is_err());
            assert!(open_folder(&path).is_err());
        }
    }

    #[test]
    fn desktop_entry_name_reads_the_untranslated_main_name() {
        let entry = "[Desktop Entry]\nType=Application\nName[pt_BR]=Arquivos\nName=Files\n\n[Desktop Action new-window]\nName=New Window\n";
        assert_eq!(desktop_entry_name(entry), Some("Files"));
    }

    #[test]
    fn desktop_entry_name_ignores_names_outside_the_main_group() {
        assert_eq!(desktop_entry_name("[Desktop Action open]\nName=Open\n[Desktop Entry]\nType=Application\n"), None);
        assert_eq!(desktop_entry_name("[Desktop Entry]\nName=\n"), None);
    }
}
