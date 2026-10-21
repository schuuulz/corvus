//! Branches, remotes, tags, stashes and submodules for the left panel.

use super::Result;
use git2::{BranchType, Repository};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    pub name: String,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub is_head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    /// e.g. "origin/main"
    pub name: String,
    pub remote: String,
    /// e.g. "main"
    pub branch: String,
    pub oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    pub head: Option<String>,
    pub detached: bool,
    pub locals: Vec<LocalBranch>,
    pub remote_branches: Vec<RemoteBranch>,
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
    pub submodules: Vec<Submodule>,
}

pub fn stashes(repo: &mut Repository) -> Result<Vec<Stash>> {
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        out.push(Stash { index, message: message.to_string(), oid: oid.to_string() });
        true
    })?;
    Ok(out)
}

pub fn list(path: &str) -> Result<Refs> {
    let mut repo = super::open(path)?;
    let stashes = stashes(&mut repo)?;
    let repo = repo;

    let head = repo.head().ok();
    let detached = repo.head_detached().unwrap_or(false);

    let mut locals = Vec::new();
    for b in repo.branches(Some(BranchType::Local))? {
        let (b, _) = b?;
        let Some(name) = b.name()?.map(String::from) else { continue };
        let oid = b.get().target();
        let (mut upstream, mut ahead, mut behind) = (None, 0, 0);
        if let Ok(up) = b.upstream() {
            upstream = up.name()?.map(String::from);
            if let (Some(l), Some(u)) = (oid, up.get().target()) {
                (ahead, behind) = repo.graph_ahead_behind(l, u)?;
            }
        }
        locals.push(LocalBranch {
            name,
            oid: oid.map(|o| o.to_string()),
            upstream,
            ahead,
            behind,
            is_head: b.is_head(),
        });
    }

    let mut remote_branches = Vec::new();
    for b in repo.branches(Some(BranchType::Remote))? {
        let (b, _) = b?;
        let Some(name) = b.name()?.map(String::from) else { continue };
        if name.ends_with("/HEAD") {
            continue;
        }
        let (remote, branch) = name.split_once('/').unwrap_or((&name, ""));
        remote_branches.push(RemoteBranch {
            remote: remote.to_string(),
            branch: branch.to_string(),
            oid: b.get().target().map(|o| o.to_string()),
            name: name.clone(),
        });
    }

    let mut remotes = Vec::new();
    for name in repo.remotes()?.iter().flatten().flatten() {
        let url = repo.find_remote(name).ok().and_then(|r| r.url().ok().map(String::from));
        remotes.push(Remote { name: name.to_string(), url });
    }

    let mut tags = Vec::new();
    for name in repo.tag_names(None)?.iter().flatten().flatten() {
        let oid = repo
            .revparse_single(&format!("refs/tags/{name}"))
            .and_then(|o| o.peel_to_commit())
            .ok()
            .map(|c| c.id().to_string());
        tags.push(Tag { name: name.to_string(), oid });
    }

    let submodules = repo
        .submodules()?
        .iter()
        .map(|s| Submodule {
            name: s.name().unwrap_or_default().to_string(),
            path: s.path().to_string_lossy().replace('\\', "/"),
        })
        .collect();

    Ok(Refs {
        head: head
            .as_ref()
            .filter(|h| h.is_branch())
            .and_then(|h| h.shorthand().ok().map(String::from)),
        detached,
        locals,
        remote_branches,
        remotes,
        tags,
        stashes,
        submodules,
    })
}

/// Name of the current branch's upstream remote and branch, if any.
pub fn upstream_of_head(repo: &Repository) -> Option<(String, String)> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    let name = head.shorthand().ok()?.to_string();
    let b = repo.find_branch(&name, BranchType::Local).ok()?;
    let up = b.upstream().ok()?;
    let up_name = up.name().ok()??.to_string();
    let (r, br) = up_name.split_once('/')?;
    Some((r.to_string(), br.to_string()))
}
