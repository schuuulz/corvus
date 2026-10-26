//! Ref-changing operations, remotes, stashes, interactive rebase, undo and
//! config. All of these go through the git CLI.

use super::{cli, commit_id, operand, Result};
use git2::Oid;
use serde::{Deserialize, Serialize};

fn ok(r: Result<String>) -> Result<()> {
    r.map(|_| ())
}

// --- branches & tags -------------------------------------------------------

pub fn checkout(path: &str, target: &str) -> Result<()> {
    ok(cli::run(path, &["checkout", operand(target)?]))
}

/// Checks out a remote branch, creating a local tracking branch when needed.
pub fn checkout_remote(path: &str, remote_branch: &str) -> Result<()> {
    let remote_branch = operand(remote_branch)?;
    let local = remote_branch.split_once('/').map(|(_, b)| b).unwrap_or(remote_branch);
    let repo = super::open(path)?;
    if repo.find_branch(local, git2::BranchType::Local).is_ok() {
        ok(cli::run(path, &["checkout", local]))
    } else {
        ok(cli::run(path, &["checkout", "--track", remote_branch]))
    }
}

pub fn create_branch(path: &str, name: &str, start: Option<&str>, checkout: bool) -> Result<()> {
    let name = operand(name)?;
    let mut args = if checkout { vec!["checkout", "-b", name] } else { vec!["branch", name] };
    if let Some(s) = start {
        args.push(operand(s)?);
    }
    ok(cli::run(path, &args))
}

pub fn delete_branch(path: &str, name: &str, force: bool) -> Result<()> {
    ok(cli::run(path, &["branch", if force { "-D" } else { "-d" }, operand(name)?]))
}

pub fn rename_branch(path: &str, old: &str, new: &str) -> Result<()> {
    ok(cli::run(path, &["branch", "-m", operand(old)?, operand(new)?]))
}

pub fn set_upstream(path: &str, branch: &str, upstream: &str) -> Result<()> {
    ok(cli::run(path, &["branch", "--set-upstream-to", operand(upstream)?, operand(branch)?]))
}

pub fn create_tag(path: &str, name: &str, target: &str, message: Option<&str>) -> Result<()> {
    let (name, target) = (operand(name)?, operand(target)?);
    match message.filter(|m| !m.trim().is_empty()) {
        Some(m) => ok(cli::run(path, &["tag", "-a", name, target, "-m", m])),
        None => ok(cli::run(path, &["tag", name, target])),
    }
}

pub fn delete_tag(path: &str, name: &str) -> Result<()> {
    ok(cli::run(path, &["tag", "-d", operand(name)?]))
}

// --- history ---------------------------------------------------------------

pub fn merge(path: &str, from: &str, no_ff: bool, squash: bool) -> Result<String> {
    let mut args = vec!["merge", "--no-edit"];
    if squash {
        args.push("--squash");
    } else if no_ff {
        args.push("--no-ff");
    }
    args.push(operand(from)?);
    cli::run(path, &args)
}

pub fn rebase(path: &str, onto: &str) -> Result<String> {
    cli::run(path, &["rebase", operand(onto)?])
}

pub fn cherry_pick(path: &str, oid: &str) -> Result<String> {
    cli::run(path, &["cherry-pick", commit_id(oid)?])
}

pub fn revert(path: &str, oid: &str) -> Result<String> {
    cli::run(path, &["revert", "--no-edit", commit_id(oid)?])
}

pub fn reset(path: &str, oid: &str, mode: &str) -> Result<()> {
    let flag = match mode {
        "soft" => "--soft",
        "hard" => "--hard",
        "keep" => "--keep",
        _ => "--mixed",
    };
    ok(cli::run(path, &["reset", flag, commit_id(oid)?]))
}

// --- stash -----------------------------------------------------------------

pub fn stash_save(path: &str, message: Option<&str>) -> Result<()> {
    let mut args = vec!["stash", "push", "--include-untracked"];
    if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
        args.extend(["-m", m]);
    }
    ok(cli::run(path, &args))
}

pub fn stash_action(path: &str, action: &str, index: usize) -> Result<()> {
    let action = match action {
        "apply" | "pop" | "drop" => action,
        _ => return super::msg(format!("unknown stash action {action}")),
    };
    let r = format!("stash@{{{index}}}");
    ok(cli::run(path, &["stash", action, &r]))
}

// --- remotes ---------------------------------------------------------------

pub fn fetch(path: &str, progress: impl FnMut(&str)) -> Result<()> {
    ok(cli::run_streaming(path, &["fetch", "--all", "--prune", "--progress"], progress))
}

/// How `pull` integrates the upstream changes.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PullMode {
    /// Fast-forward when possible, otherwise create a merge commit.
    /// "merge" is what earlier versions saved for this mode.
    #[serde(alias = "merge")]
    Ff,
    /// Fast-forward only; fails when the branches have diverged.
    FfOnly,
    /// Replay local commits on top of the upstream.
    Rebase,
}

impl PullMode {
    fn flags(self) -> &'static [&'static str] {
        match self {
            PullMode::Ff => &["--no-rebase", "--ff"],
            PullMode::FfOnly => &["--ff-only"],
            PullMode::Rebase => &["--rebase"],
        }
    }
}

pub fn pull(path: &str, mode: PullMode, progress: impl FnMut(&str)) -> Result<()> {
    let args = [&["pull", "--progress"], mode.flags()].concat();
    ok(cli::run_streaming(path, &args, progress))
}

pub fn push(path: &str, force: bool, progress: impl FnMut(&str)) -> Result<()> {
    let repo = super::open(path)?;
    let mut args = vec!["push".to_string(), "--progress".to_string()];
    if force {
        args.push("--force-with-lease".into());
    }
    if super::refs::upstream_of_head(&repo).is_none() {
        let head = repo.head()?;
        let Some(branch) = head.shorthand().ok().filter(|_| head.is_branch()) else {
            return super::msg("HEAD is detached; check out a branch to push");
        };
        let remotes = repo.remotes()?;
        let names: Vec<&str> = remotes.iter().flatten().flatten().collect();
        let remote = if names.contains(&"origin") {
            "origin"
        } else {
            match names.first() {
                Some(r) => r,
                None => return super::msg("this repository has no remotes"),
            }
        };
        args.extend(["-u".into(), remote.to_string(), branch.to_string()]);
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    ok(cli::run_streaming(path, &args, progress))
}

pub fn push_branch(path: &str, remote: &str, branch: &str, progress: impl FnMut(&str)) -> Result<()> {
    ok(cli::run_streaming(path, &["push", "--progress", "-u", operand(remote)?, operand(branch)?], progress))
}

pub fn delete_remote_branch(path: &str, remote: &str, branch: &str) -> Result<()> {
    ok(cli::run(path, &["push", operand(remote)?, "--delete", operand(branch)?]))
}

pub fn add_remote(path: &str, name: &str, url: &str) -> Result<()> {
    ok(cli::run(path, &["remote", "add", operand(name)?, operand(url)?]))
}

pub fn remove_remote(path: &str, name: &str) -> Result<()> {
    ok(cli::run(path, &["remote", "remove", operand(name)?]))
}

pub fn clone(url: &str, dest: &str, progress: impl FnMut(&str)) -> Result<()> {
    let (url, dest) = (operand(url)?, operand(dest)?);
    let parent = std::path::Path::new(dest)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".into());
    std::fs::create_dir_all(&parent)?;
    ok(cli::run_streaming(&parent, &["clone", "--progress", "--", url, dest], progress))
}

pub fn init(path: &str) -> Result<()> {
    std::fs::create_dir_all(path)?;
    ok(cli::run(path, &["init"]))
}

// --- interactive rebase ----------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseCommit {
    pub oid: String,
    pub summary: String,
    pub message: String,
    pub author: String,
}

/// Commits in `base..HEAD`, oldest first (`base = None` means all).
pub fn rebase_commits(path: &str, base: Option<&str>) -> Result<Vec<RebaseCommit>> {
    let repo = super::open(path)?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;
    walk.push_head()?;
    if let Some(b) = base {
        walk.hide(Oid::from_str(b)?)?;
    }
    let mut out = Vec::new();
    for oid in walk {
        let c = repo.find_commit(oid?)?;
        if c.parent_count() > 1 {
            return super::msg("the range contains merge commits; interactive rebase would flatten them");
        }
        out.push(RebaseCommit {
            oid: c.id().to_string(),
            summary: c.summary().ok().flatten().unwrap_or("").into(),
            message: c.message().unwrap_or_default().into(),
            author: c.author().name().unwrap_or_default().into(),
        });
    }
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    /// pick | reword | squash | fixup | drop
    pub action: String,
    pub oid: String,
    pub message: Option<String>,
}

pub fn rebase_interactive(path: &str, base: Option<&str>, todo: &[TodoItem]) -> Result<String> {
    let base = base.map(commit_id).transpose()?;
    // Git runs the `exec` lines of the todo file, so it lives in a fresh,
    // private directory no other user can create first or write into.
    let tmp = tempfile::Builder::new().prefix("corvus-rebase-").tempdir()?;
    let dir = tmp.path();
    let mut script = String::new();
    for (i, t) in todo.iter().enumerate() {
        Oid::from_str(&t.oid)?;
        match t.action.as_str() {
            "pick" | "squash" | "fixup" | "drop" => script.push_str(&format!("{} {}\n", t.action, t.oid)),
            "reword" => {
                let msg_file = dir.join(format!("msg-{i}.txt"));
                std::fs::write(&msg_file, t.message.as_deref().unwrap_or(""))?;
                script.push_str(&format!("pick {}\n", t.oid));
                script.push_str(&format!(
                    "exec git commit --amend --allow-empty -q -F '{}'\n",
                    cli::sh_path(&msg_file)
                ));
            }
            a => return super::msg(format!("unknown rebase action {a}")),
        }
    }
    let todo_file = dir.join("todo");
    std::fs::write(&todo_file, script)?;
    let seq_editor = format!("cp '{}'", cli::sh_path(&todo_file));
    let mut args = vec!["rebase", "-i"];
    match base {
        Some(b) => args.push(b),
        None => args.push("--root"),
    }
    cli::run_with(path, &args, None, &[("GIT_SEQUENCE_EDITOR", &seq_editor)])
}

// --- undo ------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoInfo {
    pub message: String,
    pub from: String,
    pub to: String,
}

/// Describes the last HEAD movement, which undo would revert.
pub fn undo_info(path: &str) -> Result<Option<UndoInfo>> {
    let repo = super::open(path)?;
    let log = repo.reflog("HEAD")?;
    // Skip no-op entries (e.g. `stash push` resets HEAD onto itself).
    let Some(e) = log.iter().find(|e| e.id_old() != e.id_new()) else { return Ok(None) };
    if e.id_old().is_zero() {
        return Ok(None);
    }
    Ok(Some(UndoInfo {
        message: e.message().ok().flatten().unwrap_or("").into(),
        from: e.id_new().to_string(),
        to: e.id_old().to_string(),
    }))
}

// --- config ----------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: String,
    pub email: String,
    pub default_branch: String,
}

fn config_get(path: &str, key: &str, global: bool) -> String {
    let args: Vec<&str> = if global { vec!["config", "--global", key] } else { vec!["config", key] };
    cli::run(path, &args).map(|s| s.trim().to_string()).unwrap_or_default()
}

pub fn identity(path: Option<&str>) -> Identity {
    let cwd = path.map(String::from).unwrap_or_else(home);
    let global = path.is_none();
    Identity {
        name: config_get(&cwd, "user.name", global),
        email: config_get(&cwd, "user.email", global),
        default_branch: config_get(&cwd, "init.defaultBranch", true),
    }
}

pub fn set_config(path: Option<&str>, key: &str, value: &str) -> Result<()> {
    let key = operand(key)?;
    let cwd = path.map(String::from).unwrap_or_else(home);
    let args: Vec<&str> = match path {
        Some(_) => vec!["config", key, value],
        None => vec!["config", "--global", key, value],
    };
    ok(cli::run(&cwd, &args))
}

fn home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}
