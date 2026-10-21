//! Working tree status, diffs and staging.

use super::{cli, patch, Error, Result};
use git2::{DiffFormat, DiffOptions, Repository, Status, StatusOptions};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub old_path: Option<String>,
    /// Index (staged) change: "A" | "M" | "D" | "R" | "T" or null.
    pub staged: Option<&'static str>,
    /// Worktree (unstaged) change: "A" (untracked) | "M" | "D" | "R" | "T" or null.
    pub unstaged: Option<&'static str>,
    pub conflicted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStatus {
    pub files: Vec<FileStatus>,
    pub state: &'static str,
}

fn code(s: Status, new: Status, del: Status, ren: Status, typ: Status, modi: Status) -> Option<&'static str> {
    if s.contains(new) {
        Some("A")
    } else if s.contains(del) {
        Some("D")
    } else if s.contains(ren) {
        Some("R")
    } else if s.contains(typ) {
        Some("T")
    } else if s.contains(modi) {
        Some("M")
    } else {
        None
    }
}

pub fn status(path: &str) -> Result<WorkStatus> {
    let repo = super::open(path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::new();
    for e in statuses.iter() {
        let s = e.status();
        let staged = code(
            s,
            Status::INDEX_NEW,
            Status::INDEX_DELETED,
            Status::INDEX_RENAMED,
            Status::INDEX_TYPECHANGE,
            Status::INDEX_MODIFIED,
        );
        let unstaged = code(
            s,
            Status::WT_NEW,
            Status::WT_DELETED,
            Status::WT_RENAMED,
            Status::WT_TYPECHANGE,
            Status::WT_MODIFIED,
        );
        let conflicted = s.contains(Status::CONFLICTED);
        if staged.is_none() && unstaged.is_none() && !conflicted {
            continue;
        }
        let rename = e.head_to_index().filter(|_| s.contains(Status::INDEX_RENAMED));
        let (path, old_path) = match rename {
            Some(d) => (
                d.new_file().path().map(|p| p.to_string_lossy().replace('\\', "/")),
                d.old_file().path().map(|p| p.to_string_lossy().replace('\\', "/")),
            ),
            None => (e.path().ok().map(String::from), None),
        };
        let Some(path) = path else { continue };
        files.push(FileStatus { path, old_path, staged, unstaged, conflicted });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(WorkStatus { files, state: super::state_name(&repo) })
}

fn diff_opts(path: &str) -> DiffOptions {
    let mut o = DiffOptions::new();
    o.pathspec(path)
        .disable_pathspec_match(true)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .context_lines(3);
    o
}

/// Unified patch text for one file, staged (HEAD→index) or unstaged
/// (index→workdir).
pub fn file_patch_text(repo: &Repository, path: &str, staged: bool) -> Result<String> {
    let mut opts = diff_opts(path);
    let diff = if staged {
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    let mut text = Vec::new();
    diff.print(DiffFormat::Patch, |_, _, line| {
        let o = line.origin();
        if matches!(o, '+' | '-' | ' ') {
            text.push(o as u8);
        }
        text.extend_from_slice(line.content());
        true
    })?;
    Ok(String::from_utf8_lossy(&text).into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHunks {
    pub hunks: Vec<patch::Hunk>,
    pub binary: bool,
}

pub fn hunks(path: &str, file: &str, staged: bool) -> Result<FileHunks> {
    let repo = super::open(path)?;
    let text = file_patch_text(&repo, file, staged)?;
    let binary = text.lines().any(|l| l.starts_with("Binary files"));
    Ok(FileHunks { hunks: patch::parse(&text).hunks, binary })
}

/// "stage" | "unstage" | "discard" for one hunk (optionally only some lines).
pub fn apply_hunk(path: &str, file: &str, action: &str, hunk: usize, lines: Option<Vec<usize>>) -> Result<()> {
    let repo = super::open(path)?;
    let staged = action == "unstage";
    let reverse = action != "stage";
    let text = file_patch_text(&repo, file, staged)?;
    let fp = patch::parse(&text);
    let Some(p) = patch::partial(&fp, hunk, lines.as_deref(), reverse) else {
        return super::msg("nothing selected");
    };
    let mut args = vec!["apply", "--whitespace=nowarn"];
    if action != "discard" {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    cli::run_with(path, &args, Some(&p), &[])?;
    Ok(())
}

pub fn stage(path: &str, files: &[String]) -> Result<()> {
    let mut args = vec!["add", "-A", "--"];
    args.extend(files.iter().map(String::as_str));
    cli::run(path, &args).map(|_| ())
}

pub fn unstage(path: &str, files: &[String]) -> Result<()> {
    let repo = super::open(path)?;
    let mut args = if repo.head().is_err() {
        vec!["rm", "--cached", "-r", "-q", "--"]
    } else {
        vec!["reset", "-q", "--"]
    };
    args.extend(files.iter().map(String::as_str));
    cli::run(path, &args).map(|_| ())
}

pub fn stage_all(path: &str) -> Result<()> {
    cli::run(path, &["add", "-A"]).map(|_| ())
}

pub fn unstage_all(path: &str) -> Result<()> {
    let repo = super::open(path)?;
    if repo.head().is_err() {
        cli::run(path, &["rm", "--cached", "-r", "-q", "."]).map(|_| ())
    } else {
        cli::run(path, &["reset", "-q"]).map(|_| ())
    }
}

/// Throws away unstaged changes (restores the file from the index; deletes
/// untracked files).
pub fn discard(path: &str, files: &[String]) -> Result<()> {
    let repo = super::open(path)?;
    let wd = super::workdir(&repo)?;
    let mut tracked = Vec::new();
    for f in files {
        let st = repo.status_file(Path::new(f)).unwrap_or(Status::empty());
        if st.contains(Status::WT_NEW) {
            let p = Path::new(&wd).join(f);
            if p.is_dir() {
                std::fs::remove_dir_all(p)?;
            } else {
                std::fs::remove_file(p)?;
            }
        } else {
            tracked.push(f.as_str());
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["checkout", "--"];
        args.extend(tracked);
        cli::run(path, &args)?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Versions {
    pub original: String,
    pub modified: String,
    pub binary: bool,
}

const MAX_SIZE: usize = 8 * 1024 * 1024;

fn text_of(bytes: Option<Vec<u8>>, binary: &mut bool, encoding: Option<&str>) -> String {
    match bytes {
        None => String::new(),
        Some(b) if b.len() > MAX_SIZE => {
            *binary = true;
            "(file too large to display)".into()
        }
        Some(b) if b[..b.len().min(8000)].contains(&0) && !encoding.is_some_and(|e| e.starts_with("utf-16")) => {
            *binary = true;
            "(binary file)".into()
        }
        Some(b) => super::ext::decode(&b, encoding),
    }
}

fn tree_blob(repo: &Repository, tree: Option<&git2::Tree>, file: &str) -> Option<Vec<u8>> {
    let entry = tree?.get_path(Path::new(file)).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    Some(blob.content().to_vec())
}

fn index_blob(repo: &Repository, file: &str) -> Option<Vec<u8>> {
    let index = repo.index().ok()?;
    let entry = index.get_path(Path::new(file), 0)?;
    Some(repo.find_blob(entry.id).ok()?.content().to_vec())
}

/// Before/after contents for the diff editor.
/// mode: "unstaged" | "staged" | "commit" (with `oid`).
pub fn versions(path: &str, file: &str, old_file: Option<&str>, mode: &str, oid: Option<&str>, encoding: Option<&str>) -> Result<Versions> {
    let repo = super::open(path)?;
    let old_file = old_file.unwrap_or(file);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let (orig, modi) = match mode {
        "staged" => (tree_blob(&repo, head_tree.as_ref(), old_file), index_blob(&repo, file)),
        "unstaged" => {
            let wd = super::workdir(&repo)?;
            let base = index_blob(&repo, file).or_else(|| tree_blob(&repo, head_tree.as_ref(), file));
            (base, std::fs::read(Path::new(&wd).join(file)).ok())
        }
        "commit" => {
            let oid = oid.ok_or_else(|| Error::Msg("missing commit".into()))?;
            let c = repo.find_commit(git2::Oid::from_str(oid)?)?;
            let tree = c.tree()?;
            let parent_tree = c.parent(0).ok().and_then(|p| p.tree().ok());
            (tree_blob(&repo, parent_tree.as_ref(), old_file), tree_blob(&repo, Some(&tree), file))
        }
        _ => return super::msg(format!("unknown mode {mode}")),
    };
    let mut binary = false;
    let original = text_of(orig, &mut binary, encoding);
    let modified = text_of(modi, &mut binary, encoding);
    Ok(Versions { original, modified, binary })
}
