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

use git2::Repository;
use serde::Serialize;

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
