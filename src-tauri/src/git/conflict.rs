//! Merge conflict inspection and resolution.

use super::{cli, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub merged: String,
}

fn blob_text(repo: &git2::Repository, e: &Option<git2::IndexEntry>) -> String {
    e.as_ref()
        .and_then(|e| repo.find_blob(e.id).ok())
        .map(|b| String::from_utf8_lossy(b.content()).into_owned())
        .unwrap_or_default()
}

pub fn versions(path: &str, file: &str) -> Result<ConflictVersions> {
    let repo = super::open(path)?;
    let index = repo.index()?;
    let wd = super::workdir(&repo)?;
    let merged = std::fs::read(Path::new(&wd).join(file))
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    for c in index.conflicts()? {
        let c = c?;
        let entry_path = [&c.our, &c.their, &c.ancestor]
            .into_iter()
            .flatten()
            .next()
            .map(|e| String::from_utf8_lossy(&e.path).into_owned());
        if entry_path.as_deref() == Some(file) {
            return Ok(ConflictVersions {
                base: blob_text(&repo, &c.ancestor),
                ours: blob_text(&repo, &c.our),
                theirs: blob_text(&repo, &c.their),
                merged,
            });
        }
    }
    super::msg(format!("{file} is not conflicted"))
}

/// Writes the resolved content and marks the file resolved.
pub fn resolve(path: &str, file: &str, content: &str) -> Result<()> {
    let repo = super::open(path)?;
    let wd = super::workdir(&repo)?;
    std::fs::write(Path::new(&wd).join(file), content)?;
    cli::run(path, &["add", "--", file]).map(|_| ())
}

fn sequencer(path: &str) -> Result<&'static str> {
    let repo = super::open(path)?;
    match super::state_name(&repo) {
        "merge" => Ok("merge"),
        "rebase" => Ok("rebase"),
        "cherry-pick" => Ok("cherry-pick"),
        "revert" => Ok("revert"),
        s => super::msg(format!("no operation in progress ({s})")),
    }
}

pub fn continue_op(path: &str) -> Result<String> {
    let op = sequencer(path)?;
    cli::run(path, &[op, "--continue"])
}

pub fn abort_op(path: &str) -> Result<String> {
    let op = sequencer(path)?;
    cli::run(path, &[op, "--abort"])
}
