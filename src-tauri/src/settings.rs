//! App settings persisted as JSON in the app config directory:
//! `{ "global": {..}, "repos": { "<repo path>": {..} } }`.
//! Values that belong to git config are stored in git, not here.

use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Settings {
    path: PathBuf,
    data: Mutex<Value>,
}

impl Settings {
    pub fn load(path: PathBuf) -> Self {
        let data = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({ "global": {}, "repos": {} }));
        Settings { path, data: Mutex::new(data) }
    }

    pub fn get(&self) -> Value {
        self.data.lock().unwrap().clone()
    }

    /// Sets `key` globally (`repo = None`) or for one repository. A null
    /// value removes the key.
    pub fn set(&self, repo: Option<&str>, key: &str, value: Value) -> std::io::Result<Value> {
        let mut data = self.data.lock().unwrap();
        let root = data.as_object_mut().expect("settings root is an object");
        let scope: &mut Map<String, Value> = match repo {
            None => root.entry("global").or_insert_with(|| json!({})).as_object_mut().unwrap(),
            Some(r) => root
                .entry("repos")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .unwrap()
                .entry(r)
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .unwrap(),
        };
        if value.is_null() {
            scope.remove(key);
        } else {
            scope.insert(key.to_string(), value);
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&*data)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(data.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_global_and_repo_values() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings::load(p.clone());
        s.set(None, "theme", json!("light")).unwrap();
        s.set(Some("C:/r"), "encoding", json!("utf-16le")).unwrap();
        let again = Settings::load(p);
        let v = again.get();
        assert_eq!(v["global"]["theme"], "light");
        assert_eq!(v["repos"]["C:/r"]["encoding"], "utf-16le");
        again.set(None, "theme", Value::Null).unwrap();
        assert!(again.get()["global"].get("theme").is_none());
    }
}
