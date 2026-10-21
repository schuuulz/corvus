mod commands;
mod commands_ext;
pub mod git;
pub mod integrations;
pub mod settings;
pub mod system;
mod terminal;
mod watcher;

use commands::*;
use commands_ext::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(watcher::Watchers::default())
        .manage(terminal::Terminals::default())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(settings::Settings::load(dir.join("settings.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repo_info,
            watch_repo,
            unwatch_repo,
            get_graph,
            get_refs,
            get_status,
            get_hunks,
            apply_hunk,
            get_versions,
            stage_files,
            unstage_files,
            stage_all,
            unstage_all,
            discard_files,
            commit,
            head_message,
            commit_details,
            file_history,
            blame,
            conflict_versions,
            resolve_conflict,
            continue_op,
            abort_op,
            checkout,
            checkout_remote,
            create_branch,
            delete_branch,
            rename_branch,
            set_upstream,
            create_tag,
            delete_tag,
            merge,
            rebase,
            cherry_pick,
            revert,
            reset,
            stash_save,
            stash_action,
            fetch,
            pull,
            push,
            push_branch,
            delete_remote_branch,
            add_remote,
            remove_remote,
            clone_repo,
            init_repo,
            rebase_commits,
            rebase_interactive,
            undo_info,
            get_identity,
            set_config,
            // settings & preferences
            get_settings,
            set_setting,
            configure_cli,
            configure_tokens,
            git_config_get,
            git_config_set,
            activity_log,
            clear_activity_log,
            submodule_update,
            delete_orig_files,
            read_text_file,
            write_repo_file,
            ssh_generate,
            gpg_list,
            gpg_generate,
            detect_tools,
            open_in_editor,
            open_terminal,
            open_merge_tool,
            term_shells,
            term_spawn,
            term_write,
            term_resize,
            term_kill,
            gitflow_get,
            gitflow_init,
            gitflow_start,
            gitflow_finish,
            lfs_get,
            lfs_action,
            sparse_get,
            sparse_set,
            sparse_action,
            conflict_check,
            integration_connect,
            integration_disconnect,
            integration_pulls,
            integration_issues,
            integration_create_pr,
            integration_add_ssh_key,
            parse_remote,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
