//! Operations that report a structured outcome (what changed, from where to
//! where, and whether they stopped on conflicts) so the UI can give precise
//! feedback instead of guessing from git's text output.

use super::{commit, ops, Error, Result};
use git2::{Oid, Repository, Status, StatusOptions};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum OpStatus {
    /// Completed and changed something.
    Ok,
    /// Stopped part-way (e.g. conflicts) and needs the user.
    Warning,
    /// Completed but there was nothing to do.
    Noop,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpOutcome {
    pub status: OpStatus,
    pub from: Option<String>,
    pub to: Option<String>,
    pub count: Option<usize>,
    pub conflicts: Vec<String>,
    pub detail: String,
}

impl OpOutcome {
    fn ok() -> Self {
        OpOutcome { status: OpStatus::Ok, from: None, to: None, count: None, conflicts: vec![], detail: String::new() }
    }
    fn from_to(mut self, from: Option<String>, to: Option<String>) -> Self {
        self.from = from;
        self.to = to;
        self
    }
    fn count(mut self, n: usize) -> Self {
        self.count = Some(n);
        if n == 0 && self.status == OpStatus::Ok {
            self.status = OpStatus::Noop;
        }
        self
    }
}

/// Branch name of HEAD, or its short SHA when detached.
fn head_label(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().ok().map(String::from)
    } else {
        head.target().map(|o| o.to_string()[..7].to_string())
    }
}

fn head_oid(repo: &Repository) -> Option<Oid> {
    repo.head().ok().and_then(|h| h.target())
}

fn conflicted_files(repo: &Repository) -> Vec<String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false);
    repo.statuses(Some(&mut opts))
        .map(|st| {
            st.iter()
                .filter(|e| e.status().contains(Status::CONFLICTED))
                .filter_map(|e| e.path().ok().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Turns a git failure that left the repo with conflicts into a warning.
fn conflicts_as_warning(path: &str, r: Result<String>, base: OpOutcome) -> Result<OpOutcome> {
    match r {
        Ok(out) => Ok(OpOutcome { detail: out.trim().to_string(), ..base }),
        Err(e) => {
            let repo = super::open(path)?;
            let conflicts = conflicted_files(&repo);
            if conflicts.is_empty() {
                Err(e)
            } else {
                Ok(OpOutcome { status: OpStatus::Warning, conflicts, detail: e.to_string(), ..base })
            }
        }
    }
}

fn commits_between(repo: &Repository, old: Option<Oid>, new: Option<Oid>) -> usize {
    match (old, new) {
        (Some(o), Some(n)) if o != n => repo.graph_ahead_behind(n, o).map(|(a, _)| a).unwrap_or(0),
        (None, Some(_)) => 1,
        _ => 0,
    }
}

pub fn checkout(path: &str, target: &str, remote: bool) -> Result<OpOutcome> {
    let repo = super::open(path)?;
    let from = head_label(&repo);
    let created = remote && {
        let local = target.split_once('/').map(|(_, b)| b).unwrap_or(target);
        repo.find_branch(local, git2::BranchType::Local).is_err()
    };
    if remote {
        ops::checkout_remote(path, target)?;
    } else {
        ops::checkout(path, target)?;
    }
    let repo = super::open(path)?;
    let mut o = OpOutcome::ok().from_to(from, head_label(&repo));
    if created {
        o.detail = format!("tracking {target}");
    }
    Ok(o)
}

pub fn pull(path: &str, mode: &str, progress: impl FnMut(&str)) -> Result<OpOutcome> {
    let repo = super::open(path)?;
    let before = head_oid(&repo);
    let branch = head_label(&repo);
    let r = ops::pull(path, mode, progress).map(|_| String::new());
    let mut o = conflicts_as_warning(path, r, OpOutcome::ok().from_to(branch.clone(), branch))?;
    if o.status == OpStatus::Ok {
        let repo = super::open(path)?;
        o = o.count(commits_between(&repo, before, head_oid(&repo)));
    }
    Ok(o)
}

fn remote_refs(repo: &Repository) -> HashMap<String, Oid> {
    repo.references_glob("refs/remotes/*")
        .map(|it| it.flatten().filter_map(|r| Some((r.name().ok()?.to_string(), r.target()?))).collect())
        .unwrap_or_default()
}

pub fn fetch(path: &str, progress: impl FnMut(&str)) -> Result<OpOutcome> {
    let before = remote_refs(&super::open(path)?);
    ops::fetch(path, progress)?;
    let after = remote_refs(&super::open(path)?);
    let changed = after.iter().filter(|(k, v)| before.get(*k) != Some(*v)).count()
        + before.keys().filter(|k| !after.contains_key(*k)).count();
    Ok(OpOutcome::ok().count(changed))
}

pub fn push(path: &str, force: bool, progress: impl FnMut(&str)) -> Result<OpOutcome> {
    let repo = super::open(path)?;
    let branch = head_label(&repo);
    let ahead = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from))
        .and_then(|b| repo.find_branch(&b, git2::BranchType::Local).ok())
        .and_then(|b| {
            let up = b.upstream().ok()?.get().target()?;
            let local = b.get().target()?;
            repo.graph_ahead_behind(local, up).ok().map(|(a, _)| a)
        });
    ops::push(path, force, progress)?;
    let repo = super::open(path)?;
    let upstream = super::refs::upstream_of_head(&repo).map(|(r, b)| format!("{r}/{b}"));
    let mut o = OpOutcome::ok().from_to(branch, upstream);
    // A new upstream has no "ahead" count before the push; report it as Ok.
    o.count = ahead;
    Ok(o)
}

pub fn merge(path: &str, from: &str, no_ff: bool, squash: bool) -> Result<OpOutcome> {
    let into = head_label(&super::open(path)?);
    let r = ops::merge(path, from, no_ff, squash);
    let mut o = conflicts_as_warning(path, r, OpOutcome::ok().from_to(Some(from.to_string()), into))?;
    if o.status == OpStatus::Ok && o.detail.contains("Already up to date") {
        o.status = OpStatus::Noop;
    }
    Ok(o)
}

pub fn rebase(path: &str, onto: &str) -> Result<OpOutcome> {
    let branch = head_label(&super::open(path)?);
    let r = ops::rebase(path, onto);
    let mut o = conflicts_as_warning(path, r, OpOutcome::ok().from_to(branch, Some(onto.to_string())))?;
    if o.status == OpStatus::Ok && o.detail.contains("is up to date") {
        o.status = OpStatus::Noop;
    }
    Ok(o)
}

pub fn cherry_pick(path: &str, oid: &str) -> Result<OpOutcome> {
    let branch = head_label(&super::open(path)?);
    conflicts_as_warning(path, ops::cherry_pick(path, oid), OpOutcome::ok().from_to(Some(oid[..7.min(oid.len())].to_string()), branch))
}

pub fn revert(path: &str, oid: &str) -> Result<OpOutcome> {
    let branch = head_label(&super::open(path)?);
    conflicts_as_warning(path, ops::revert(path, oid), OpOutcome::ok().from_to(Some(oid[..7.min(oid.len())].to_string()), branch))
}

pub fn stash_action(path: &str, action: &str, index: usize) -> Result<OpOutcome> {
    let r = ops::stash_action(path, action, index).map(|_| String::new());
    conflicts_as_warning(path, r, OpOutcome::ok())
}

pub fn commit(path: &str, message: &str, amend: bool, no_verify: bool, strip: bool) -> Result<OpOutcome> {
    let branch = head_label(&super::open(path)?);
    commit::commit(path, message, amend, no_verify, strip)?;
    let repo = super::open(path)?;
    let c = repo.head()?.peel_to_commit().map_err(Error::from)?;
    let mut o = OpOutcome::ok().from_to(branch, Some(c.id().to_string()[..7].to_string()));
    o.detail = c.summary().ok().flatten().unwrap_or("").to_string();
    Ok(o)
}
