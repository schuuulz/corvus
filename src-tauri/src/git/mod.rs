//! Git backend. Reads go through libgit2 (git2); anything that mutates
//! refs, talks to remotes, or should honour user hooks/config goes through
//! the git CLI (see `cli`).

pub mod cli;
pub mod commit;
pub mod conflict;
pub mod ext;
pub mod graph;
pub mod ops;
pub mod outcome;
pub mod patch;
pub mod refs;
pub mod status;

use git2::{Oid, Repository};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn msg<T>(m: impl Into<String>) -> Result<T> {
    Err(Error::Msg(m.into()))
}

/// A ref, remote, URL or path from the UI that git receives as a positional
/// argument. Git would parse one starting with `-` as an option, and some
/// options run programs (`clone --upload-pack=<cmd>`), so those are refused.
pub fn operand(value: &str) -> Result<&str> {
    if value.starts_with('-') {
        return msg(format!("\"{value}\" is not a valid name"));
    }
    Ok(value)
}

/// A commit id from the UI, checked to be hexadecimal.
pub fn commit_id(value: &str) -> Result<&str> {
    Oid::from_str(value)?;
    Ok(value)
}

/// `file` as a path relative to the repository root. Absolute paths and `..`
/// would reach outside the repository (and make libgit2 lookups panic), so
/// they are refused.
pub fn repo_relative(file: &str) -> Result<&Path> {
    let path = Path::new(file);
    let relative = path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if file.is_empty() || !relative {
        return msg(format!("{file} is outside the repository"));
    }
    Ok(path)
}

/// `file`, relative to the working directory `wd`, joined onto it. A path
/// that passes through a symbolic link (or Windows junction) is refused: it
/// would reach files outside the repository. `file` itself may be a link.
pub fn path_in_workdir(wd: &str, file: &str) -> Result<PathBuf> {
    let mut path = PathBuf::from(wd);
    let mut parts = repo_relative(file)?.components().peekable();
    while let Some(part) = parts.next() {
        path.push(part);
        if parts.peek().is_some() && is_symlink(&path) {
            return msg(format!("{file} is behind a symbolic link"));
        }
    }
    Ok(path)
}

fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink())
}

/// Contents of `file` in the working directory as git sees them: a symbolic
/// link reads as the path it points to, never as the file behind it.
pub fn read_in_workdir(wd: &str, file: &str) -> Result<Vec<u8>> {
    let path = path_in_workdir(wd, file)?;
    if is_symlink(&path) {
        let target = std::fs::read_link(&path)?;
        return Ok(target.to_string_lossy().replace('\\', "/").into_bytes());
    }
    Ok(std::fs::read(path)?)
}

/// Writes `content` to `file` in the working directory. Writing through a
/// symbolic link would change the file it points to, so links are refused.
pub fn write_in_workdir(wd: &str, file: &str, content: &str) -> Result<()> {
    let path = path_in_workdir(wd, file)?;
    if is_symlink(&path) {
        return msg(format!("{file} is a symbolic link"));
    }
    Ok(std::fs::write(path, content)?)
}

pub fn open(path: &str) -> Result<Repository> {
    Ok(Repository::open(path)?)
}

/// Normalised working-directory path of a repository (no trailing slash).
pub fn workdir(repo: &Repository) -> Result<String> {
    let wd = repo
        .workdir()
        .ok_or_else(|| Error::Msg("bare repositories are not supported".into()))?;
    let s = wd.to_string_lossy().replace('\\', "/");
    Ok(s.trim_end_matches('/').to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub state: &'static str,
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub unborn: bool,
}

pub fn state_name(repo: &Repository) -> &'static str {
    use git2::RepositoryState::*;
    match repo.state() {
        Clean => "clean",
        Merge => "merge",
        Revert | RevertSequence => "revert",
        CherryPick | CherryPickSequence => "cherry-pick",
        Rebase | RebaseInteractive | RebaseMerge => "rebase",
        Bisect => "bisect",
        _ => "other",
    }
}

/// Opens (discovering upwards) a repository and describes it.
pub fn info(path: &str) -> Result<RepoInfo> {
    let repo = Repository::discover(path)?;
    let wd = workdir(&repo)?;
    let name = wd.rsplit('/').next().unwrap_or(&wd).to_string();
    let head = repo.head().ok();
    Ok(RepoInfo {
        name,
        state: state_name(&repo),
        head_branch: head
            .as_ref()
            .filter(|h| h.is_branch())
            .and_then(|h| h.shorthand().ok().map(String::from)),
        head_oid: head.as_ref().and_then(|h| h.target()).map(|o| o.to_string()),
        unborn: repo.head().is_err(),
        path: wd,
    })
}
