//! Switching branches with uncommitted changes. The changes are stashed, the
//! branch is switched, and they come back when they apply cleanly; changes
//! that would conflict with the new branch wait in a named stash instead.
//! They are never only in memory: they live in the working tree or in a stash
//! found by its commit id (stash indices shift as stashes come and go).

use super::outcome::{conflicted_files, Autostash};
use super::{cli, ops, Error, Result};
use git2::{BranchType, Oid, Repository, RepositoryState, StatusOptions, TreeWalkMode, TreeWalkResult};
use std::path::Path;

/// Checks out `target` (a remote branch when `remote`), carrying uncommitted
/// changes along when `enabled`. Returns what became of the changes, or None
/// when there were none to carry (or carrying is off).
pub fn switch(path: &str, target: &str, remote: bool, enabled: bool) -> Result<Option<Autostash>> {
    let repo = super::open(path)?;
    if !enabled || repo.state() != RepositoryState::Clean || !has_changes(&repo)? {
        checkout(path, target, remote)?;
        return Ok(None);
    }
    ensure_exists(&repo, target, remote)?;
    let message = format!("Corvus autostash: {} → {target}", super::outcome::head_label(&repo).unwrap_or_else(|| "HEAD".into()));
    let Some(stash) = stash(path, &message)? else {
        checkout(path, target, remote)?;
        return Ok(None);
    };
    if let Err(e) = checkout(path, target, remote) {
        return Err(restore_after_failed_checkout(path, stash, e));
    }
    match conflicts_on_apply(path, stash)? {
        Some(files) if files.is_empty() => pop(path, stash, message),
        Some(files) => Ok(Some(Autostash::Kept { message, files })),
        // Git couldn't predict the result: don't risk it.
        None => Ok(Some(Autostash::Kept { message, files: vec![] })),
    }
}

fn checkout(path: &str, target: &str, remote: bool) -> Result<()> {
    if remote {
        ops::checkout_remote(path, target)
    } else {
        ops::checkout(path, target)
    }
}

/// Uncommitted changes worth carrying: tracked or untracked, not ignored.
fn has_changes(repo: &Repository) -> Result<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    Ok(!repo.statuses(Some(&mut opts))?.is_empty())
}

/// Refuses a target that doesn't exist before anything is stashed.
fn ensure_exists(repo: &Repository, target: &str, remote: bool) -> Result<()> {
    let found = if remote { repo.find_branch(target, BranchType::Remote).is_ok() } else { repo.revparse_single(target).is_ok() };
    if found {
        Ok(())
    } else {
        super::msg(format!("{target} doesn't exist"))
    }
}

fn stash_tip(repo: &Repository) -> Option<Oid> {
    repo.refname_to_id("refs/stash").ok()
}

/// Stashes every change (untracked files too); the stash's commit, or None
/// when git found nothing to stash.
fn stash(path: &str, message: &str) -> Result<Option<Oid>> {
    let before = stash_tip(&super::open(path)?);
    cli::run(path, &["stash", "push", "--include-untracked", "-m", message])?;
    let after = stash_tip(&super::open(path)?);
    Ok(after.filter(|tip| Some(*tip) != before))
}

/// `stash@{n}` for the stash whose commit is `oid`.
fn stash_ref(path: &str, oid: Oid) -> Result<String> {
    let mut repo = super::open(path)?;
    let mut index = None;
    repo.stash_foreach(|i, _, id| {
        if *id == oid {
            index = Some(i);
        }
        index.is_none()
    })?;
    index.map(|i| format!("stash@{{{i}}}")).ok_or_else(|| Error::Msg("the autostash is no longer in the stash list".into()))
}

/// Brings the changes back on the original branch after the switch failed.
/// HEAD didn't move, so they apply cleanly; if even that fails, they stay
/// in the stash and the error says so.
fn restore_after_failed_checkout(path: &str, stash: Oid, error: Error) -> Error {
    match pop(path, stash, String::new()) {
        Ok(Some(Autostash::Restored { .. })) => error,
        _ => Error::Msg(format!("{error}\nYour changes are kept in the stash list.")),
    }
}

/// Files that applying `stash` onto HEAD would conflict on; None when git
/// can't tell (`merge-tree --merge-base` needs git 2.40).
fn conflicts_on_apply(path: &str, stash: Oid) -> Result<Option<Vec<String>>> {
    let id = stash.to_string();
    let base = format!("--merge-base={id}^1");
    let (clean, out) = cli::run_status(path, &["merge-tree", "--write-tree", "--name-only", "--no-messages", &base, "HEAD", &id])?;
    let mut lines = out.lines();
    // A tree id comes first both when clean and on conflicts; errors print none.
    if lines.next().is_none_or(|tree| Oid::from_str(tree.trim()).is_err()) {
        return Ok(None);
    }
    let mut files: Vec<String> = if clean { vec![] } else { lines.filter(|l| !l.is_empty()).map(String::from).collect() };
    files.extend(untracked_in_the_way(path, stash)?);
    Ok(Some(files))
}

/// Untracked files saved in `stash` that already exist in the working tree:
/// `git stash pop` would refuse to overwrite them.
fn untracked_in_the_way(path: &str, stash: Oid) -> Result<Vec<String>> {
    let repo = super::open(path)?;
    let commit = repo.find_commit(stash)?;
    let Ok(untracked) = commit.parent(2) else { return Ok(vec![]) };
    let wd = super::workdir(&repo)?;
    let mut in_the_way = Vec::new();
    untracked.tree()?.walk(TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            let file = format!("{dir}{}", entry.name().unwrap_or_default());
            if Path::new(&wd).join(&file).exists() {
                in_the_way.push(file);
            }
        }
        TreeWalkResult::Ok
    })?;
    Ok(in_the_way)
}

/// Applies and drops `stash`, keeping staged changes staged when git can.
fn pop(path: &str, stash: Oid, message: String) -> Result<Option<Autostash>> {
    let reference = stash_ref(path, stash)?;
    if cli::run(path, &["stash", "pop", "--index", &reference]).is_ok() {
        return Ok(Some(Autostash::Restored { unstaged_only: false }));
    }
    let conflicts = conflicted_files(&super::open(path)?);
    if !conflicts.is_empty() {
        return Ok(Some(Autostash::Conflicted { message, files: conflicts }));
    }
    // Git refuses `--index` when the staged changes can't be restored as
    // such, and applies nothing; anything else left behind means stop here.
    if has_changes(&super::open(path)?)? {
        return Ok(Some(Autostash::Kept { message, files: vec![] }));
    }
    match cli::run(path, &["stash", "pop", &stash_ref(path, stash)?]) {
        Ok(_) => Ok(Some(Autostash::Restored { unstaged_only: true })),
        Err(e) => {
            let conflicts = conflicted_files(&super::open(path)?);
            if conflicts.is_empty() {
                Err(e)
            } else {
                Ok(Some(Autostash::Conflicted { message, files: conflicts }))
            }
        }
    }
}
