//! Terminal prompts that show the current branch in its graph colour.
//!
//! Each shell gets a small startup script (`src-tauri/prompt/`) that adds
//! "(branch)" to its prompt. The branch comes from git on every prompt; its
//! colour comes from a per-repo "head file" the UI keeps up to date
//! (`write_head`), because lane colours only exist in the graph.

use crate::git::{Error, Result};
use portable_pty::CommandBuilder;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PS1_SCRIPT: &str = "corvus-prompt.ps1";
const CMD_SCRIPT: &str = "corvus-prompt.cmd";
const SH_SCRIPT: &str = "corvus-prompt.sh";
const ZSH_DIR: &str = "zsh";

const SCRIPTS: &[(&str, &str)] = &[
    (PS1_SCRIPT, include_str!("../prompt/corvus-prompt.ps1")),
    (CMD_SCRIPT, include_str!("../prompt/corvus-prompt.cmd")),
    (SH_SCRIPT, include_str!("../prompt/corvus-prompt.sh")),
    ("zsh/.zshenv", include_str!("../prompt/zsh/.zshenv")),
    ("zsh/.zshrc", include_str!("../prompt/zsh/.zshrc")),
];

/// Where the scripts and head files live: `<app cache>/prompt`.
pub fn dir(app: &AppHandle) -> Result<PathBuf> {
    let cache = app.path().app_cache_dir().map_err(|e| Error::Msg(e.to_string()))?;
    Ok(cache.join("prompt"))
}

/// Line endings a script needs, whatever the checkout used: batch files run
/// with CRLF, shell scripts break with it.
fn with_line_endings(name: &str, body: &str) -> String {
    let lf = body.replace("\r\n", "\n");
    if name.ends_with(".cmd") { lf.replace('\n', "\r\n") } else { lf }
}

/// Writes the prompt scripts into `dir`, rewriting only those that changed.
pub fn install(dir: &Path) -> Result<()> {
    for (name, body) in SCRIPTS {
        let path = dir.join(name);
        let body = with_line_endings(name, body);
        if fs::read_to_string(&path).ok().as_deref() == Some(body.as_str()) {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, body)?;
    }
    Ok(())
}

/// FNV-1a: a stable, dependency-free name for a repo's head file.
fn fnv1a(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

/// File holding `<branch> <r;g;b>`: the HEAD branch of `repo` and its colour.
pub fn head_file(dir: &Path, repo: &str) -> PathBuf {
    dir.join("heads").join(format!("{:016x}", fnv1a(repo)))
}

/// "#10b981" → "16;185;129", the form ANSI 24-bit colours take.
fn ansi_rgb(hex: &str) -> Result<String> {
    let invalid = || Error::Msg(format!("invalid colour: {hex}"));
    let digits = hex.strip_prefix('#').filter(|d| d.len() == 6 && d.is_ascii()).ok_or_else(invalid)?;
    let channels = (0..3)
        .map(|i| u8::from_str_radix(&digits[i * 2..i * 2 + 2], 16).map_err(|_| invalid()))
        .collect::<Result<Vec<u8>>>()?;
    Ok(channels.iter().map(u8::to_string).collect::<Vec<_>>().join(";"))
}

/// Records `branch` and its graph colour (`#rrggbb`) as the HEAD of `repo`.
pub fn write_head(dir: &Path, repo: &str, branch: &str, color: &str) -> Result<()> {
    let line = format!("{branch} {}\n", ansi_rgb(color)?);
    let path = head_file(dir, repo);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(fs::write(path, line)?)
}

/// Git Bash reads Windows paths best with forward slashes.
fn forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// bash: re-run the prompt script before every prompt.
fn configure_bash(cmd: &mut CommandBuilder, script: String) {
    cmd.env("CORVUS_PROMPT_SCRIPT", script);
    cmd.env("PROMPT_COMMAND", ". \"$CORVUS_PROMPT_SCRIPT\"");
}

/// Sets `cmd`, a shell from `terminal::shells`, up to show the branch of the
/// repo whose head file is `head`. Shells without prompt support are left as
/// they are.
pub fn configure(cmd: &mut CommandBuilder, shell: &str, program: &str, dir: &Path, head: &Path) {
    cmd.env("CORVUS_PROMPT_FILE", head);
    match shell {
        "powershell" | "pwsh" => {
            cmd.env("CORVUS_PROMPT_SCRIPT", dir.join(PS1_SCRIPT));
            cmd.args(["-NoExit", "-Command", ".", "$env:CORVUS_PROMPT_SCRIPT"]);
        }
        "cmd" => {
            // The quotes live in the value: cmd expands `%VAR%` itself, and an
            // argument without spaces reaches it verbatim, so paths with
            // spaces still work.
            cmd.env("CORVUS_PROMPT_SCRIPT", format!("\"{}\"", dir.join(CMD_SCRIPT).display()));
            cmd.args(["/K", "call", "%CORVUS_PROMPT_SCRIPT%"]);
        }
        "gitbash" => {
            cmd.env("CORVUS_PROMPT_FILE", forward_slashes(head));
            configure_bash(cmd, forward_slashes(&dir.join(SH_SCRIPT)));
        }
        "wsl" => {
            configure_bash(cmd, dir.join(SH_SCRIPT).to_string_lossy().into_owned());
            // WSL only sees variables listed in WSLENV; `/p` translates paths.
            let ours = "CORVUS_PROMPT_FILE/p:CORVUS_PROMPT_SCRIPT/p:PROMPT_COMMAND";
            let wslenv = std::env::var("WSLENV").map(|v| format!("{v}:{ours}")).unwrap_or_else(|_| ours.into());
            cmd.env("WSLENV", wslenv);
        }
        _ => match Path::new(program).file_name().and_then(|n| n.to_str()) {
            Some("bash") => configure_bash(cmd, dir.join(SH_SCRIPT).to_string_lossy().into_owned()),
            Some("zsh") => {
                if let Ok(user) = std::env::var("ZDOTDIR") {
                    cmd.env("CORVUS_USER_ZDOTDIR", user);
                }
                cmd.env("ZDOTDIR", dir.join(ZSH_DIR));
            }
            _ => {}
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn converts_hex_colours_to_ansi() {
        assert_eq!(ansi_rgb("#10b981").unwrap(), "16;185;129");
        assert_eq!(ansi_rgb("#FFFFFF").unwrap(), "255;255;255");
        for bad in ["10b981", "#10b98", "#10b98g", "#1ö0b98", ""] {
            assert!(ansi_rgb(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn writes_one_head_file_per_repo() {
        let dir = tempfile::tempdir().unwrap();
        let a = head_file(dir.path(), "C:/work/a");
        assert_eq!(a, head_file(dir.path(), "C:/work/a"), "stable");
        assert_ne!(a, head_file(dir.path(), "C:/work/b"));
        write_head(dir.path(), "C:/work/a", "feat/x", "#8B5CF6").unwrap();
        assert_eq!(fs::read_to_string(&a).unwrap(), "feat/x 139;92;246\n");
        assert!(write_head(dir.path(), "C:/work/a", "main", "green").is_err());
    }

    #[test]
    fn installs_scripts_with_the_right_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        install(dir.path()).unwrap();
        install(dir.path()).unwrap();
        let cmd = fs::read_to_string(dir.path().join(CMD_SCRIPT)).unwrap();
        assert!(cmd.contains("\r\n") && !cmd.replace("\r\n", "").contains('\n'));
        assert!(!fs::read_to_string(dir.path().join(SH_SCRIPT)).unwrap().contains('\r'));
        assert!(dir.path().join("zsh/.zshrc").exists());
    }

    #[test]
    fn configures_each_shell() {
        let dir = Path::new("/cache/prompt");
        let head = dir.join("heads/1");

        let mut ps = CommandBuilder::new("powershell.exe");
        configure(&mut ps, "powershell", "powershell.exe", dir, &head);
        assert_eq!(argv(&ps)[1..], ["-NoExit", "-Command", ".", "$env:CORVUS_PROMPT_SCRIPT"]);
        assert_eq!(ps.get_env("CORVUS_PROMPT_FILE"), Some(head.as_os_str()));

        let mut cmd = CommandBuilder::new("cmd.exe");
        configure(&mut cmd, "cmd", "cmd.exe", dir, &head);
        assert_eq!(argv(&cmd)[1..], ["/K", "call", "%CORVUS_PROMPT_SCRIPT%"]);
        let script = cmd.get_env("CORVUS_PROMPT_SCRIPT").unwrap().to_string_lossy().into_owned();
        assert!(script.starts_with('"') && script.ends_with("corvus-prompt.cmd\""));

        let mut bash = CommandBuilder::new("/bin/bash");
        configure(&mut bash, "default", "/bin/bash", dir, &head);
        assert_eq!(bash.get_env("PROMPT_COMMAND"), Some(OsStr::new(". \"$CORVUS_PROMPT_SCRIPT\"")));

        let mut zsh = CommandBuilder::new("/bin/zsh");
        configure(&mut zsh, "default", "/bin/zsh", dir, &head);
        assert_eq!(zsh.get_env("ZDOTDIR"), Some(dir.join("zsh").as_os_str()));

        let mut fish = CommandBuilder::new("/usr/bin/fish");
        configure(&mut fish, "default", "/usr/bin/fish", dir, &head);
        assert!(fish.get_env("PROMPT_COMMAND").is_none() && fish.get_env("ZDOTDIR").is_none());
    }

    /// A branch name that creates `pwned*` files if any shell evaluates it.
    const HOSTILE_BRANCH: &str = "x$(touch${IFS}pwned1)`touch${IFS}pwned2`&type>pwned3|\"&type>pwned4\"%PATH%";

    /// A throwaway repo on `branch`, plus a prompt dir with the scripts and a
    /// head file colouring that branch violet.
    fn prompt_fixture(branch: &str) -> (tempfile::TempDir, String, tempfile::TempDir) {
        let repo = tempfile::tempdir().unwrap();
        let path = repo.path().to_string_lossy().replace('\\', "/");
        let ok = std::process::Command::new("git").current_dir(&path).args(["init", "-q", "-b", branch]).status().unwrap();
        assert!(ok.success());
        let dir = tempfile::tempdir().unwrap();
        install(dir.path()).unwrap();
        write_head(dir.path(), &path, branch, "#8B5CF6").unwrap();
        (repo, path, dir)
    }

    fn assert_nothing_ran(repo: &Path) {
        let created: Vec<_> = fs::read_dir(repo).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).filter(|n| n != ".git").collect();
        assert!(created.is_empty(), "the branch name ran as a command: {created:?}");
    }

    /// Runs `body` in bash, in `path`, with the prompt script sourced. Unix
    /// only: on Windows `bash` may resolve to WSL, which can't see Windows paths.
    #[cfg(unix)]
    fn run_bash_prompt(path: &str, dir: &Path, body: &str) -> String {
        let script = format!(
            "cd '{path}'; PS1='\\w\\$ '; CORVUS_PROMPT_FILE='{}'; false; . '{}'; {body}",
            forward_slashes(&head_file(dir, path)),
            forward_slashes(&dir.join(SH_SCRIPT)),
        );
        let out = std::process::Command::new("bash").args(["--noprofile", "--norc", "-c", &script]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    #[cfg(unix)]
    #[test]
    fn bash_prompt_shows_the_branch_in_its_colour() {
        let (_repo, path, dir) = prompt_fixture("feat/x");
        let shown = run_bash_prompt(&path, dir.path(), "status=$?; printf '%s|%s|%s' \"$status\" \"$PS1\" \"$corvus_branch\"");
        assert_eq!(
            shown,
            "1|\\w \\[\\e[38;2;139;92;246m\\](${corvus_branch})\\[\\e[0m\\] \\$ |feat/x",
            "keeps $? and inserts the branch"
        );
    }

    #[cfg(unix)]
    #[test]
    fn bash_prompt_never_runs_the_branch_name() {
        let (repo, path, dir) = prompt_fixture(HOSTILE_BRANCH);
        let shown = run_bash_prompt(&path, dir.path(), "printf '%s' \"${PS1@P}\"");
        assert!(shown.contains(&format!("({HOSTILE_BRANCH})")), "shows the name verbatim: {shown}");
        assert_nothing_ran(repo.path());
    }

    #[cfg(unix)]
    #[test]
    fn zsh_prompt_never_runs_the_branch_name() {
        use std::process::Command;
        if Command::new("zsh").arg("-fc").arg("true").status().is_err() {
            return;
        }
        let (repo, path, dir) = prompt_fixture(HOSTILE_BRANCH);
        let user = tempfile::tempdir().unwrap();
        // `${(%)${(e)PROMPT}}` expands the prompt as PROMPT_SUBST would.
        let script = format!(
            "cd '{path}'; setopt promptsubst; PROMPT='%# '; CORVUS_USER_ZDOTDIR='{}'; CORVUS_PROMPT_FILE='{}'; \
             source '{}'; corvus_prompt; print -rn -- ${{(%)${{(e)PROMPT}}}}",
            user.path().display(),
            head_file(dir.path(), &path).display(),
            dir.path().join("zsh/.zshrc").display(),
        );
        let out = Command::new("zsh").args(["-f", "-c", &script]).output().unwrap();
        let shown = String::from_utf8_lossy(&out.stdout);
        assert!(shown.contains(&format!("({HOSTILE_BRANCH})")), "shows the name verbatim: {shown}");
        assert_nothing_ran(repo.path());
    }

    #[cfg(windows)]
    #[test]
    fn cmd_prompt_never_runs_the_branch_name() {
        use std::process::Command;
        let (repo, path, dir) = prompt_fixture(HOSTILE_BRANCH);
        let out = Command::new("cmd")
            .current_dir(&path)
            .env("CORVUS_PROMPT_FILE", head_file(dir.path(), &path))
            .env("CORVUS_PROMPT_SCRIPT", format!("\"{}\"", dir.path().join(CMD_SCRIPT).display()))
            .args(["/d", "/c", "call", "%CORVUS_PROMPT_SCRIPT%", "&", "set", "PROMPT"])
            .output()
            .unwrap();
        let shown = String::from_utf8_lossy(&out.stdout);
        let expected = "PROMPT=$P $E[38;2;139;92;246m(x$$(touch$${IFS}pwned1)`touch$${IFS}pwned2`$Atype$Gpwned3$B\"$Atype$Gpwned4\"%PATH%)$E[0m$G";
        assert_eq!(shown.trim(), expected, "spells the name with prompt codes, in its colour");
        assert_nothing_ran(repo.path());
    }
}
