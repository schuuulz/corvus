//! Commands for settings, preferences-backed features, tools, terminal and
//! integrations.

use crate::git::{self, cli, ext, Error, Result};
use crate::integrations::{self as integ, Kind};
use crate::settings::Settings;
use crate::shell_prompt;
use crate::system;
use crate::terminal::{self, Terminals};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

// --- settings & config -----------------------------------------------------

#[tauri::command]
pub async fn get_settings(state: State<'_, Settings>) -> Result<Value> {
    Ok(state.get())
}

#[tauri::command]
pub async fn set_setting(state: State<'_, Settings>, repo: Option<String>, key: String, value: Value) -> Result<Value> {
    Ok(state.set(repo.as_deref(), &key, value)?)
}

#[tauri::command]
pub async fn configure_cli(config: cli::CliConfig) -> Result<()> {
    cli::configure(config);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRef {
    pub kind: Kind,
    pub host: String,
}

/// Loads tokens of connected integrations so git can use them for HTTPS.
#[tauri::command]
pub async fn configure_tokens(integrations: Vec<IntegrationRef>) -> Result<()> {
    let tokens = integrations
        .into_iter()
        .filter_map(|i| {
            let host = integ::default_host(i.kind, &i.host);
            let token = system::secret_get(&integ::secret_key(i.kind, &host))?;
            Some(cli::HostToken { username: integ::git_username(i.kind).to_string(), host, token })
        })
        .collect();
    cli::set_tokens(tokens);
    Ok(())
}

#[tauri::command]
pub async fn git_config_get(repo: Option<String>, key: String) -> Result<String> {
    Ok(ext::config_get(repo.as_deref(), &key))
}

#[tauri::command]
pub async fn git_config_set(repo: Option<String>, key: String, value: String) -> Result<()> {
    ext::config_set(repo.as_deref(), &key, &value)
}

#[tauri::command]
pub async fn activity_log() -> Result<Vec<cli::LogEntry>> {
    Ok(cli::activity_log())
}

#[tauri::command]
pub async fn clear_activity_log() -> Result<()> {
    cli::clear_log();
    Ok(())
}

#[tauri::command]
pub async fn submodule_update(repo: String) -> Result<()> {
    cli::run_remote(&repo, &["submodule", "update", "--init", "--recursive"], cli::Reach::Submodules).map(|_| ())
}

#[tauri::command]
pub async fn delete_orig_files(repo: String) -> Result<usize> {
    let r = git::open(&repo)?;
    let wd = git::workdir(&r)?;
    let mut n = 0;
    for e in r.statuses(Some(git2::StatusOptions::new().include_untracked(true).recurse_untracked_dirs(true)))?.iter() {
        if let Ok(p) = e.path() {
            if p.ends_with(".orig") && e.status().contains(git2::Status::WT_NEW) {
                std::fs::remove_file(format!("{wd}/{p}"))?;
                n += 1;
            }
        }
    }
    Ok(n)
}

// --- files -----------------------------------------------------------------

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String> {
    system::read_text(&path)
}

/// Writes a file inside a repository's working tree.
#[tauri::command]
pub async fn write_repo_file(repo: String, file: String, content: String) -> Result<()> {
    let wd = git::workdir(&git::open(&repo)?)?;
    let path = git::path_in_workdir(&wd, &file)?;
    Ok(std::fs::write(path, content)?)
}

// --- ssh / gpg ---------------------------------------------------------------

#[tauri::command]
pub async fn ssh_generate(path: Option<String>, comment: String, passphrase: String) -> Result<system::SshKeyPair> {
    system::ssh_generate(path.as_deref(), &comment, &passphrase)
}

#[tauri::command]
pub async fn gpg_list(program: String) -> Result<Vec<system::GpgKey>> {
    system::gpg_list(&program)
}

#[tauri::command]
pub async fn gpg_generate(program: String, name: String, email: String, passphrase: String) -> Result<()> {
    system::gpg_generate(&program, &name, &email, &passphrase)
}

// --- external tools ----------------------------------------------------------

#[tauri::command]
pub async fn detect_tools() -> Result<Vec<system::ExternalTool>> {
    Ok(system::detect_tools())
}

#[tauri::command]
pub async fn open_in_editor(tool_path: String, target: String) -> Result<()> {
    system::open_in_editor(&tool_path, &target)
}

#[tauri::command]
pub async fn open_terminal(tool_id: String, tool_path: String, dir: String) -> Result<()> {
    system::open_terminal(&tool_id, &tool_path, &dir)
}

#[tauri::command]
pub async fn open_merge_tool(repo: String, file: String, tool: Option<String>) -> Result<()> {
    system::open_merge_tool(&repo, &file, tool.as_deref())
}

// --- in-app terminal ---------------------------------------------------------

/// Whether this installation can update itself. On Linux only AppImages can:
/// deb and rpm installs belong to the system package manager.
#[tauri::command]
pub fn updater_supported() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

#[tauri::command]
pub async fn term_shells() -> Result<Vec<terminal::Shell>> {
    Ok(terminal::shells())
}

/// Records the HEAD branch of `repo` and its graph colour for terminal prompts.
#[tauri::command]
pub async fn term_prompt_branch(app: AppHandle, repo: String, branch: String, color: String) -> Result<()> {
    shell_prompt::write_head(&shell_prompt::dir(&app)?, &repo, &branch, &color)
}

#[tauri::command]
pub async fn term_spawn(app: AppHandle, state: State<'_, Terminals>, id: u32, cwd: String, shell: String, cols: u16, rows: u16) -> Result<()> {
    terminal::spawn(app, &state, id, &cwd, &shell, cols, rows).map_err(Error::Msg)
}

#[tauri::command]
pub async fn term_write(state: State<'_, Terminals>, id: u32, data: String) -> Result<()> {
    terminal::write(&state, id, &data).map_err(Error::Msg)
}

#[tauri::command]
pub async fn term_resize(state: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<()> {
    terminal::resize(&state, id, cols, rows).map_err(Error::Msg)
}

#[tauri::command]
pub async fn term_kill(state: State<'_, Terminals>, id: u32) -> Result<()> {
    terminal::kill(&state, id);
    Ok(())
}

// --- repo extras ---------------------------------------------------------------

#[tauri::command]
pub async fn gitflow_get(repo: String) -> Result<ext::Gitflow> {
    Ok(ext::gitflow(&repo))
}

#[tauri::command]
pub async fn gitflow_init(repo: String, master: String, develop: String, feature: String, release: String, hotfix: String, version_tag: String) -> Result<()> {
    ext::gitflow_init(&repo, &master, &develop, &feature, &release, &hotfix, &version_tag)
}

#[tauri::command]
pub async fn gitflow_start(repo: String, kind: String, name: String) -> Result<()> {
    ext::gitflow_start(&repo, &kind, &name)
}

#[tauri::command]
pub async fn gitflow_finish(repo: String, kind: String, name: String, tag_message: Option<String>) -> Result<()> {
    ext::gitflow_finish(&repo, &kind, &name, tag_message.as_deref())
}

#[tauri::command]
pub async fn lfs_get(repo: String) -> Result<ext::Lfs> {
    Ok(ext::lfs(&repo))
}

#[tauri::command]
pub async fn lfs_action(repo: String, action: String, pattern: Option<String>) -> Result<String> {
    ext::lfs_action(&repo, &action, pattern.as_deref())
}

#[tauri::command]
pub async fn sparse_get(repo: String) -> Result<ext::Sparse> {
    Ok(ext::sparse(&repo))
}

#[tauri::command]
pub async fn sparse_set(repo: String, paths: Vec<String>) -> Result<()> {
    ext::sparse_set(&repo, &paths)
}

#[tauri::command]
pub async fn sparse_action(repo: String, action: String) -> Result<()> {
    ext::sparse_action(&repo, &action)
}

#[tauri::command]
pub async fn conflict_check(repo: String, patterns: Vec<String>, preferred: Option<String>) -> Result<ext::ConflictCheck> {
    ext::conflict_check(&repo, &patterns, preferred.as_deref())
}

// --- integrations ------------------------------------------------------------

#[tauri::command]
pub async fn integration_connect(kind: Kind, host: String, token: String) -> Result<integ::Account> {
    integ::connect(kind, &host, &token).await
}

#[tauri::command]
pub async fn integration_disconnect(kind: Kind, host: String) -> Result<()> {
    integ::disconnect(kind, &host)
}

#[tauri::command]
pub async fn integration_pulls(kind: Kind, host: String, repo: String) -> Result<Vec<integ::PullRequest>> {
    integ::pull_requests(kind, &host, &repo).await
}

#[tauri::command]
pub async fn integration_issues(kind: Kind, host: String, repo: String) -> Result<Vec<integ::Issue>> {
    integ::issues(kind, &host, &repo).await
}

#[tauri::command]
pub async fn integration_repo_access(kind: Kind, host: String, repo: String) -> Result<integ::RepoAccess> {
    integ::repo_access(kind, &host, &repo).await
}

#[tauri::command]
pub async fn integration_create_pr(kind: Kind, host: String, repo: String, pr: integ::NewPullRequest) -> Result<integ::PullRequest> {
    integ::create_pull_request(kind, &host, &repo, &pr).await
}

#[tauri::command]
pub async fn integration_add_ssh_key(kind: Kind, host: String, title: String, public_key_path: String) -> Result<()> {
    let key = system::read_text(&public_key_path)?;
    integ::add_ssh_key(kind, &host, &title, &key).await
}

#[tauri::command]
pub async fn parse_remote(url: String) -> Result<Option<integ::RemoteRef>> {
    Ok(integ::parse_remote(&url))
}
