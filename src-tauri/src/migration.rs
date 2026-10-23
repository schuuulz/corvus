//! Upgrades from the kraken-craft era. The settings file moved with the
//! bundle identifier, and the two built-in theme ids were renamed.

use serde_json::Value;
use std::path::{Path, PathBuf};

const LEGACY_IDENTIFIER: &str = "com.krakencraft.app";

const RENAMED_THEMES: [(&str, &str); 2] = [("kraken-dark", "corvus-dark"), ("kraken-light", "corvus-light")];

/// Copies the kraken-craft settings file to `settings_path` when Corvus has
/// none yet. The legacy file stays in place, so the step is idempotent and
/// nothing is lost if it fails halfway.
pub fn adopt_legacy_settings(settings_path: &Path) -> std::io::Result<()> {
    let Some(legacy) = legacy_settings_path(settings_path) else {
        return Ok(());
    };
    if settings_path.exists() || !legacy.exists() {
        return Ok(());
    }
    if let Some(dir) = settings_path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::copy(legacy, settings_path)?;
    Ok(())
}

/// The same file inside the sibling config folder named after the old identifier.
fn legacy_settings_path(settings_path: &Path) -> Option<PathBuf> {
    let file_name = settings_path.file_name()?;
    let config_root = settings_path.parent()?.parent()?;
    Some(config_root.join(LEGACY_IDENTIFIER).join(file_name))
}

/// Maps a theme id saved before the rename to its Corvus equivalent.
pub fn rename_legacy_theme(settings: &mut Value) {
    let Some(theme) = settings.pointer_mut("/global/theme") else {
        return;
    };
    let renamed = RENAMED_THEMES.iter().find(|(old, _)| theme.as_str() == Some(old));
    if let Some((_, new)) = renamed {
        *theme = Value::from(*new);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config_root() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("com.corvus.app").join("settings.json");
        let legacy = root.path().join(LEGACY_IDENTIFIER).join("settings.json");
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        (root, current, legacy)
    }

    #[test]
    fn copies_legacy_settings_when_none_exist() {
        let (_root, current, legacy) = config_root();
        std::fs::write(&legacy, r#"{"global":{"zoom":1.2}}"#).unwrap();
        adopt_legacy_settings(&current).unwrap();
        assert_eq!(std::fs::read_to_string(&current).unwrap(), r#"{"global":{"zoom":1.2}}"#);
        assert!(legacy.exists(), "the legacy file is kept");
    }

    #[test]
    fn keeps_existing_settings() {
        let (_root, current, legacy) = config_root();
        std::fs::write(&legacy, "legacy").unwrap();
        std::fs::create_dir_all(current.parent().unwrap()).unwrap();
        std::fs::write(&current, "current").unwrap();
        adopt_legacy_settings(&current).unwrap();
        assert_eq!(std::fs::read_to_string(&current).unwrap(), "current");
    }

    #[test]
    fn does_nothing_without_legacy_settings() {
        let (_root, current, _legacy) = config_root();
        adopt_legacy_settings(&current).unwrap();
        assert!(!current.exists());
    }

    #[test]
    fn renames_kraken_themes() {
        let mut dark = json!({ "global": { "theme": "kraken-dark" } });
        let mut light = json!({ "global": { "theme": "kraken-light" } });
        rename_legacy_theme(&mut dark);
        rename_legacy_theme(&mut light);
        assert_eq!(dark["global"]["theme"], "corvus-dark");
        assert_eq!(light["global"]["theme"], "corvus-light");
    }

    #[test]
    fn leaves_other_themes_alone() {
        let mut midnight = json!({ "global": { "theme": "midnight" } });
        let mut unset = json!({ "global": {} });
        rename_legacy_theme(&mut midnight);
        rename_legacy_theme(&mut unset);
        assert_eq!(midnight["global"]["theme"], "midnight");
        assert!(unset["global"].get("theme").is_none());
    }
}
