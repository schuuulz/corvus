//! Tauri commands: a thin async layer over `git`. Every command is async so
//! git work runs off the UI thread.

use crate::git::{self, commit, conflict, graph, ops, outcome::{self, OpOutcome}, refs, status, Result};
use crate::watcher::{self, Watchers};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
struct Progress<'a> {
    repo: &'a str,
    line: &'a str,
}

fn progress<'a>(app: &'a AppHandle, repo: &'a str) -> impl FnMut(&str) + 'a {
    move |line| {
        let _ = app.emit("git-progress", Progress { repo, line });
    }
}

#[tauri::command]
pub async fn repo_info(path: String) -> Result<git::RepoInfo> {
    git::info(&path)
}

#[tauri::command]
pub async fn watch_repo(app: AppHandle, state: State<'_, Watchers>, repo: String) -> Result<()> {
    watcher::watch(app, &state, repo).map_err(|e| git::Error::Msg(e.to_string()))
}

#[tauri::command]
pub async fn unwatch_repo(state: State<'_, Watchers>, repo: String) -> Result<()> {
    watcher::unwatch(&state, &repo);
    Ok(())
}

#[tauri::command]
pub async fn get_graph(repo: String, limit: usize, trunks: Option<Vec<String>>) -> Result<graph::Graph> {
    graph::build(&git::open(&repo)?, limit, &trunks.unwrap_or_default())
}

#[tauri::command]
pub async fn get_refs(repo: String) -> Result<refs::Refs> {
    refs::list(&repo)
}

#[tauri::command]
pub async fn get_status(repo: String) -> Result<status::WorkStatus> {
    status::status(&repo)
}

#[tauri::command]
pub async fn get_hunks(repo: String, file: String, staged: bool) -> Result<status::FileHunks> {
    status::hunks(&repo, &file, staged)
}

#[tauri::command]
pub async fn apply_hunk(repo: String, file: String, action: String, hunk: usize, lines: Option<Vec<usize>>) -> Result<()> {
    status::apply_hunk(&repo, &file, &action, hunk, lines)
}

#[tauri::command]
pub async fn get_versions(repo: String, file: String, old_file: Option<String>, mode: String, oid: Option<String>, encoding: Option<String>) -> Result<status::Versions> {
    status::versions(&repo, &file, old_file.as_deref(), &mode, oid.as_deref(), encoding.as_deref())
}

#[tauri::command]
pub async fn stage_files(repo: String, files: Vec<String>) -> Result<()> {
    status::stage(&repo, &files)
}

#[tauri::command]
pub async fn unstage_files(repo: String, files: Vec<String>) -> Result<()> {
    status::unstage(&repo, &files)
}

#[tauri::command]
pub async fn stage_all(repo: String) -> Result<()> {
    status::stage_all(&repo)
}

#[tauri::command]
pub async fn unstage_all(repo: String) -> Result<()> {
    status::unstage_all(&repo)
}

#[tauri::command]
pub async fn discard_files(repo: String, files: Vec<String>) -> Result<()> {
    status::discard(&repo, &files)
}

#[tauri::command]
pub async fn commit(repo: String, message: String, amend: bool, no_verify: bool, strip_comments: bool) -> Result<OpOutcome> {
    outcome::commit(&repo, &message, amend, no_verify, strip_comments)
}

#[tauri::command]
pub async fn head_message(repo: String) -> Result<String> {
    commit::head_message(&repo)
}

#[tauri::command]
pub async fn commit_details(repo: String, oid: String) -> Result<commit::CommitDetail> {
    commit::details(&repo, &oid)
}

#[tauri::command]
pub async fn file_history(repo: String, file: String) -> Result<Vec<commit::HistoryEntry>> {
    commit::file_history(&repo, &file)
}

#[tauri::command]
pub async fn blame(repo: String, file: String) -> Result<Vec<commit::BlameLine>> {
    commit::blame(&repo, &file)
}

#[tauri::command]
pub async fn conflict_versions(repo: String, file: String) -> Result<conflict::ConflictVersions> {
    conflict::versions(&repo, &file)
}

#[tauri::command]
pub async fn resolve_conflict(repo: String, file: String, content: String) -> Result<()> {
    conflict::resolve(&repo, &file, &content)
}

#[tauri::command]
pub async fn continue_op(repo: String) -> Result<String> {
    conflict::continue_op(&repo)
}

#[tauri::command]
pub async fn abort_op(repo: String) -> Result<String> {
    conflict::abort_op(&repo)
}

#[tauri::command]
pub async fn checkout(repo: String, target: String) -> Result<OpOutcome> {
    outcome::checkout(&repo, &target, false)
}

#[tauri::command]
pub async fn checkout_remote(repo: String, branch: String) -> Result<OpOutcome> {
    outcome::checkout(&repo, &branch, true)
}

#[tauri::command]
pub async fn create_branch(repo: String, name: String, start: Option<String>, checkout: bool) -> Result<()> {
    ops::create_branch(&repo, &name, start.as_deref(), checkout)
}

#[tauri::command]
pub async fn delete_branch(repo: String, name: String, force: bool) -> Result<()> {
    ops::delete_branch(&repo, &name, force)
}

#[tauri::command]
pub async fn rename_branch(repo: String, old: String, new: String) -> Result<()> {
    ops::rename_branch(&repo, &old, &new)
}

#[tauri::command]
pub async fn set_upstream(repo: String, branch: String, upstream: String) -> Result<()> {
    ops::set_upstream(&repo, &branch, &upstream)
}

#[tauri::command]
pub async fn create_tag(repo: String, name: String, target: String, message: Option<String>) -> Result<()> {
    ops::create_tag(&repo, &name, &target, message.as_deref())
}

#[tauri::command]
pub async fn delete_tag(repo: String, name: String) -> Result<()> {
    ops::delete_tag(&repo, &name)
}

#[tauri::command]
pub async fn merge(repo: String, from: String, no_ff: bool, squash: bool) -> Result<OpOutcome> {
    outcome::merge(&repo, &from, no_ff, squash)
}

#[tauri::command]
pub async fn rebase(repo: String, onto: String) -> Result<OpOutcome> {
    outcome::rebase(&repo, &onto)
}

#[tauri::command]
pub async fn cherry_pick(repo: String, oid: String) -> Result<OpOutcome> {
    outcome::cherry_pick(&repo, &oid)
}

#[tauri::command]
pub async fn revert(repo: String, oid: String) -> Result<OpOutcome> {
    outcome::revert(&repo, &oid)
}

#[tauri::command]
pub async fn reset(repo: String, oid: String, mode: String) -> Result<()> {
    ops::reset(&repo, &oid, &mode)
}

#[tauri::command]
pub async fn stash_save(repo: String, message: Option<String>) -> Result<()> {
    ops::stash_save(&repo, message.as_deref())
}

#[tauri::command]
pub async fn stash_action(repo: String, action: String, index: usize) -> Result<OpOutcome> {
    outcome::stash_action(&repo, &action, index)
}

#[tauri::command]
pub async fn fetch(app: AppHandle, repo: String) -> Result<OpOutcome> {
    outcome::fetch(&repo, progress(&app, &repo))
}

#[tauri::command]
pub async fn pull(app: AppHandle, repo: String, mode: ops::PullMode) -> Result<OpOutcome> {
    outcome::pull(&repo, mode, progress(&app, &repo))
}

#[tauri::command]
pub async fn push(app: AppHandle, repo: String, force: bool) -> Result<OpOutcome> {
    outcome::push(&repo, force, progress(&app, &repo))
}

#[tauri::command]
pub async fn push_branch(app: AppHandle, repo: String, remote: String, branch: String) -> Result<()> {
    ops::push_branch(&repo, &remote, &branch, progress(&app, &repo))
}

#[tauri::command]
pub async fn delete_remote_branch(repo: String, remote: String, branch: String) -> Result<()> {
    ops::delete_remote_branch(&repo, &remote, &branch)
}

#[tauri::command]
pub async fn add_remote(repo: String, name: String, url: String) -> Result<()> {
    ops::add_remote(&repo, &name, &url)
}

#[tauri::command]
pub async fn remove_remote(repo: String, name: String) -> Result<()> {
    ops::remove_remote(&repo, &name)
}

#[tauri::command]
pub async fn clone_repo(app: AppHandle, url: String, dest: String) -> Result<()> {
    ops::clone(&url, &dest, progress(&app, &dest))
}

#[tauri::command]
pub async fn init_repo(path: String) -> Result<()> {
    ops::init(&path)
}

#[tauri::command]
pub async fn rebase_commits(repo: String, base: Option<String>) -> Result<Vec<ops::RebaseCommit>> {
    ops::rebase_commits(&repo, base.as_deref())
}

#[tauri::command]
pub async fn rebase_interactive(repo: String, base: Option<String>, todo: Vec<ops::TodoItem>) -> Result<String> {
    ops::rebase_interactive(&repo, base.as_deref(), &todo)
}

#[tauri::command]
pub async fn undo_info(repo: String) -> Result<Option<ops::UndoInfo>> {
    ops::undo_info(&repo)
}

#[tauri::command]
pub async fn get_identity(repo: Option<String>) -> Result<ops::Identity> {
    Ok(ops::identity(repo.as_deref()))
}

#[tauri::command]
pub async fn set_config(repo: Option<String>, key: String, value: String) -> Result<()> {
    ops::set_config(repo.as_deref(), &key, &value)
}
