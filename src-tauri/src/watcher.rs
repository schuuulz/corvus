//! Watches open repositories and emits a debounced `repo-changed` event so
//! the UI can refresh after edits made outside the app.

use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, notify::RecommendedWatcher>>);

fn is_noise(p: &Path) -> bool {
    let s = p.to_string_lossy().replace('\\', "/");
    s.contains("/.git/objects/") || s.ends_with(".lock") || s.contains("/node_modules/") || s.contains("/target/")
}

pub fn watch(app: AppHandle, state: &Watchers, repo: String) -> notify::Result<()> {
    let mut map = state.0.lock().unwrap();
    if map.contains_key(&repo) {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| !is_noise(p)) {
                let _ = tx.send(());
            }
        }
    })?;
    watcher.watch(Path::new(&repo), RecursiveMode::Recursive)?;
    let key = repo.clone();
    std::thread::spawn(move || {
        // Debounce: wait for the first event, then for 300ms of quiet.
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
            let _ = app.emit("repo-changed", &key);
        }
    });
    map.insert(repo, watcher);
    Ok(())
}

pub fn unwatch(state: &Watchers, repo: &str) {
    state.0.lock().unwrap().remove(repo);
}
