//! Committing, commit details, file history and blame.

use super::{cli, Result};
use git2::{BlameOptions, DiffFindOptions, Oid};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub fn commit(path: &str, message: &str, amend: bool, no_verify: bool, strip_comments: bool) -> Result<String> {
    let cleanup = if strip_comments { "--cleanup=strip" } else { "--cleanup=whitespace" };
    let mut args = vec!["commit", cleanup, "-F", "-"];
    if amend {
        args.push("--amend");
    }
    if no_verify {
        args.push("--no-verify");
    }
    cli::run_with(path, &args, Some(message), &[])
}

pub fn head_message(path: &str) -> Result<String> {
    let repo = super::open(path)?;
    let c = repo.head()?.peel_to_commit()?;
    Ok(c.message().unwrap_or_default().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: &'static str,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub author_time: i64,
    pub committer: String,
    pub commit_time: i64,
    pub summary: String,
    pub body: String,
    pub files: Vec<ChangedFile>,
}

pub fn details(path: &str, oid: &str) -> Result<CommitDetail> {
    let repo = super::open(path)?;
    let c = repo.find_commit(Oid::from_str(oid)?)?;
    let tree = c.tree()?;
    let parent_tree = c.parent(0).ok().and_then(|p| p.tree().ok());
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    let mut files = Vec::new();
    for (i, d) in diff.deltas().enumerate() {
        use git2::Delta::*;
        let status = match d.status() {
            Added => "A",
            Deleted => "D",
            Renamed => "R",
            Copied => "C",
            Typechange => "T",
            _ => "M",
        };
        let (mut additions, mut deletions) = (0, 0);
        if let Ok(Some(p)) = git2::Patch::from_diff(&diff, i) {
            if let Ok((_, a, d)) = p.line_stats() {
                (additions, deletions) = (a, d);
            }
        }
        let new = d.new_file().path().map(|p| p.to_string_lossy().replace('\\', "/"));
        let old = d.old_file().path().map(|p| p.to_string_lossy().replace('\\', "/"));
        files.push(ChangedFile {
            path: new.clone().or(old.clone()).unwrap_or_default(),
            old_path: if status == "R" { old } else { None },
            status,
            additions,
            deletions,
        });
    }
    let msg = c.message().unwrap_or_default();
    let (summary, body) = msg.split_once('\n').unwrap_or((msg, ""));
    Ok(CommitDetail {
        oid: c.id().to_string(),
        parents: c.parent_ids().map(|p| p.to_string()).collect(),
        author: c.author().name().unwrap_or_default().into(),
        email: c.author().email().unwrap_or_default().into(),
        author_time: c.author().when().seconds(),
        committer: c.committer().name().unwrap_or_default().into(),
        commit_time: c.time().seconds(),
        summary: summary.trim().into(),
        body: body.trim().into(),
        files,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub oid: String,
    pub author: String,
    pub time: i64,
    pub summary: String,
}

pub fn file_history(path: &str, file: &str) -> Result<Vec<HistoryEntry>> {
    let out = cli::run(
        path,
        &["log", "--follow", "-n", "500", "--format=%H%x1f%an%x1f%at%x1f%s", "--", file],
    )?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut p = l.split('\x1f');
            Some(HistoryEntry {
                oid: p.next()?.into(),
                author: p.next()?.into(),
                time: p.next()?.parse().ok()?,
                summary: p.next().unwrap_or("").into(),
            })
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: usize,
    pub oid: String,
    pub author: String,
    pub time: i64,
    pub summary: String,
    pub content: String,
}

pub fn blame(path: &str, file: &str) -> Result<Vec<BlameLine>> {
    let repo = super::open(path)?;
    let wd = super::workdir(&repo)?;
    let text = std::fs::read(Path::new(&wd).join(file))?;
    let text = String::from_utf8_lossy(&text);
    let lines: Vec<&str> = text.lines().collect();
    let blame = repo.blame_file(Path::new(file), Some(&mut BlameOptions::new()))?;
    let mut summaries: HashMap<Oid, (String, String, i64)> = HashMap::new();
    let mut out = Vec::with_capacity(lines.len());
    for (i, content) in lines.iter().enumerate() {
        let Some(h) = blame.get_line(i + 1) else { continue };
        let id = h.final_commit_id();
        let (author, summary, time) = summaries
            .entry(id)
            .or_insert_with(|| match repo.find_commit(id) {
                Ok(c) => (
                    c.author().name().unwrap_or_default().to_string(),
                    c.summary().ok().flatten().unwrap_or("").to_string(),
                    c.time().seconds(),
                ),
                Err(_) => ("Not committed".into(), String::new(), 0),
            })
            .clone();
        out.push(BlameLine {
            line: i + 1,
            oid: id.to_string(),
            author,
            time,
            summary,
            content: content.to_string(),
        });
    }
    Ok(out)
}
