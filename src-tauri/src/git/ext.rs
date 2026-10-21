//! Repository extras: git config access, Gitflow, LFS, sparse checkout,
//! proactive conflict detection and text encodings.

use super::{cli, msg, Result};
use git2::BranchType;
use serde::Serialize;

// --- git config ------------------------------------------------------------

/// Reads a config value; `repo = None` reads the global config.
pub fn config_get(repo: Option<&str>, key: &str) -> String {
    let home = crate::system::home();
    let (cwd, args): (&str, Vec<&str>) = match repo {
        Some(r) => (r, vec!["config", "--get", key]),
        None => (&home, vec!["config", "--global", "--get", key]),
    };
    cli::run(cwd, &args).map(|s| s.trim().to_string()).unwrap_or_default()
}

/// Writes a config value; an empty value unsets it.
pub fn config_set(repo: Option<&str>, key: &str, value: &str) -> Result<()> {
    let home = crate::system::home();
    let (cwd, scope) = match repo {
        Some(r) => (r, "--local"),
        None => (home.as_str(), "--global"),
    };
    if value.is_empty() {
        // Unsetting a missing key exits 5; that's fine.
        cli::run_status(cwd, &["config", scope, "--unset-all", key]).map(|_| ())
    } else {
        cli::run(cwd, &["config", scope, key, value]).map(|_| ())
    }
}

// --- Gitflow ---------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gitflow {
    pub initialized: bool,
    pub master: String,
    pub develop: String,
    pub feature: String,
    pub release: String,
    pub hotfix: String,
    pub version_tag: String,
}

pub fn gitflow(repo: &str) -> Gitflow {
    let get = |k: &str, d: &str| {
        let v = config_get(Some(repo), k);
        if v.is_empty() { d.to_string() } else { v }
    };
    Gitflow {
        initialized: !config_get(Some(repo), "gitflow.branch.develop").is_empty(),
        master: get("gitflow.branch.master", "main"),
        develop: get("gitflow.branch.develop", "develop"),
        feature: get("gitflow.prefix.feature", "feature/"),
        release: get("gitflow.prefix.release", "release/"),
        hotfix: get("gitflow.prefix.hotfix", "hotfix/"),
        version_tag: config_get(Some(repo), "gitflow.prefix.versiontag"),
    }
}

fn branch_exists(repo: &str, name: &str) -> bool {
    super::open(repo).map(|r| r.find_branch(name, BranchType::Local).is_ok()).unwrap_or(false)
}

/// Configured Gitflow branches must already exist locally with exactly the
/// given names; nothing is created implicitly. The error lists every
/// missing name (with a hint when only a remote copy exists).
fn check_flow_branches(repo: &str, names: &[&str]) -> Result<()> {
    let r = super::open(repo)?;
    let missing: Vec<String> = names
        .iter()
        .map(|n| n.trim())
        .filter(|n| r.find_branch(n, BranchType::Local).is_err())
        .map(|n| {
            let remote = r
                .remotes()
                .ok()
                .and_then(|rs| {
                    rs.iter().flatten().flatten().map(|rm| format!("{rm}/{n}")).find(|full| r.find_branch(full, BranchType::Remote).is_ok())
                });
            match remote {
                Some(full) => format!("{n} (exists only as {full}: check it out first)"),
                None => n.to_string(),
            }
        })
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        msg(format!("branches not found: {}", missing.join(", ")))
    }
}

pub fn gitflow_init(repo: &str, master: &str, develop: &str, feature: &str, release: &str, hotfix: &str, version_tag: &str) -> Result<()> {
    check_flow_branches(repo, &[master, develop])?;
    let (master, develop) = (master.trim(), develop.trim());
    for (k, v) in [
        ("gitflow.branch.master", master),
        ("gitflow.branch.develop", develop),
        ("gitflow.prefix.feature", feature),
        ("gitflow.prefix.release", release),
        ("gitflow.prefix.hotfix", hotfix),
        ("gitflow.prefix.versiontag", version_tag),
    ] {
        cli::run(repo, &["config", "--local", k, v])?;
    }
    Ok(())
}

fn flow_prefix<'a>(g: &'a Gitflow, kind: &str) -> Result<&'a str> {
    match kind {
        "feature" => Ok(&g.feature),
        "release" => Ok(&g.release),
        "hotfix" => Ok(&g.hotfix),
        _ => msg(format!("unknown gitflow kind {kind}")),
    }
}

pub fn gitflow_start(repo: &str, kind: &str, name: &str) -> Result<()> {
    let g = gitflow(repo);
    if !g.initialized {
        return msg("Gitflow is not initialised for this repository");
    }
    let base = if kind == "hotfix" { &g.master } else { &g.develop };
    check_flow_branches(repo, &[base])?;
    let branch = format!("{}{name}", flow_prefix(&g, kind)?);
    cli::run(repo, &["checkout", "-b", &branch, base]).map(|_| ())
}

/// Finishes a flow branch: features merge into develop; releases and
/// hotfixes merge into master (tagged) and back into develop.
pub fn gitflow_finish(repo: &str, kind: &str, name: &str, tag_message: Option<&str>) -> Result<()> {
    let g = gitflow(repo);
    let branch = format!("{}{name}", flow_prefix(&g, kind)?);
    if !branch_exists(repo, &branch) {
        return msg(format!("branch {branch} does not exist"));
    }
    let merge_into = |target: &str| -> Result<()> {
        cli::run(repo, &["checkout", target])?;
        cli::run(repo, &["merge", "--no-ff", "--no-edit", &branch]).map(|_| ())
    };
    if kind == "feature" {
        merge_into(&g.develop)?;
    } else {
        merge_into(&g.master)?;
        let tag = format!("{}{name}", g.version_tag);
        let m = tag_message.filter(|m| !m.trim().is_empty()).map(String::from).unwrap_or_else(|| format!("{kind} {name}"));
        cli::run(repo, &["tag", "-a", &tag, "-m", &m])?;
        merge_into(&g.develop)?;
    }
    cli::run(repo, &["branch", "-d", &branch]).map(|_| ())
}

// --- LFS -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lfs {
    pub installed: bool,
    pub initialized: bool,
    pub patterns: Vec<String>,
}

pub fn lfs(repo: &str) -> Lfs {
    let installed = cli::run(repo, &["lfs", "version"]).is_ok();
    let initialized = installed && !config_get(Some(repo), "filter.lfs.clean").is_empty();
    let patterns = if installed {
        cli::run(repo, &["lfs", "track"])
            .unwrap_or_default()
            .lines()
            .filter(|l| l.starts_with("    "))
            .filter_map(|l| l.trim().split(" (").next().map(String::from))
            .collect()
    } else {
        Vec::new()
    };
    Lfs { installed, initialized, patterns }
}

pub fn lfs_action(repo: &str, action: &str, pattern: Option<&str>) -> Result<String> {
    match (action, pattern) {
        ("init", _) => cli::run(repo, &["lfs", "install", "--local"]),
        ("track", Some(p)) => cli::run(repo, &["lfs", "track", p]),
        ("untrack", Some(p)) => cli::run(repo, &["lfs", "untrack", p]),
        ("files", _) => cli::run(repo, &["lfs", "ls-files"]),
        _ => msg(format!("invalid lfs action {action}")),
    }
}

// --- sparse checkout -------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sparse {
    pub enabled: bool,
    pub paths: Vec<String>,
}

pub fn sparse(repo: &str) -> Sparse {
    let enabled = config_get(Some(repo), "core.sparseCheckout") == "true";
    let paths = if enabled {
        cli::run(repo, &["sparse-checkout", "list"])
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    } else {
        Vec::new()
    };
    Sparse { enabled, paths }
}

pub fn sparse_set(repo: &str, paths: &[String]) -> Result<()> {
    let mut args = vec!["sparse-checkout", "set", "--no-cone"];
    // An empty list keeps only root files.
    let root_only = ["/*".to_string(), "!/*/".to_string()];
    let list = if paths.iter().all(|p| p.trim().is_empty()) { &root_only[..] } else { paths };
    args.extend(list.iter().map(|p| p.trim()).filter(|p| !p.is_empty()));
    cli::run(repo, &args).map(|_| ())
}

pub fn sparse_action(repo: &str, action: &str) -> Result<()> {
    match action {
        "disable" => cli::run(repo, &["sparse-checkout", "disable"]).map(|_| ()),
        "reapply" => cli::run(repo, &["sparse-checkout", "reapply"]).map(|_| ()),
        _ => msg(format!("invalid sparse action {action}")),
    }
}

// --- conflict prediction ---------------------------------------------------

/// Glob match for ref patterns: `**` spans `/`, `*` does not.
pub fn glob_match(pat: &str, s: &str) -> bool {
    fn go(p: &[u8], s: &[u8]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some(b'*') if p.get(1) == Some(&b'*') => (0..=s.len()).any(|i| go(&p[2..], &s[i..])),
            Some(b'*') => (0..=s.len()).take_while(|&i| i == 0 || s[i - 1] != b'/').any(|i| go(&p[1..], &s[i..])),
            Some(c) => s.first() == Some(c) && go(&p[1..], &s[1..]),
        }
    }
    go(pat.as_bytes(), s.as_bytes())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCheck {
    pub base: Option<String>,
    pub files: Vec<String>,
}

/// Picks the most likely base branch (matching `patterns`, nearest by
/// commits ahead) and predicts which files would conflict merging it.
pub fn conflict_check(repo_path: &str, patterns: &[String], preferred: Option<&str>) -> Result<ConflictCheck> {
    let repo = super::open(repo_path)?;
    let Ok(head) = repo.head() else { return Ok(ConflictCheck { base: None, files: vec![] }) };
    let Some(head_oid) = head.target() else { return Ok(ConflictCheck { base: None, files: vec![] }) };
    let head_name = head.shorthand().unwrap_or_default().to_string();
    let (inc, exc): (Vec<&String>, Vec<&String>) = patterns.iter().partition(|p| !p.starts_with('!'));
    let allowed = |n: &str| inc.iter().any(|p| glob_match(p.trim(), n)) && !exc.iter().any(|p| glob_match(p.trim_start_matches('!').trim(), n));

    let mut best: Option<(usize, String)> = None;
    if let Some(p) = preferred.filter(|p| !p.is_empty()) {
        best = Some((0, p.to_string()));
    } else {
        for b in repo.branches(Some(BranchType::Remote))?.take(200) {
            let (b, _) = b?;
            let Some(name) = b.name()?.map(String::from) else { continue };
            if name.ends_with("/HEAD") || name.split_once('/').map(|x| x.1) == Some(head_name.as_str()) || !allowed(&name) {
                continue;
            }
            let Some(oid) = b.get().target() else { continue };
            if oid == head_oid {
                continue;
            }
            let (ahead, _) = repo.graph_ahead_behind(head_oid, oid)?;
            if best.as_ref().is_none_or(|(a, _)| ahead < *a) {
                best = Some((ahead, name));
            }
        }
    }
    let Some((_, base)) = best else { return Ok(ConflictCheck { base: None, files: vec![] }) };
    let (clean, out) = cli::run_status(repo_path, &["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", &base])?;
    let files = if clean { vec![] } else { out.lines().skip(1).filter(|l| !l.is_empty()).map(String::from).collect() };
    Ok(ConflictCheck { base: Some(base), files })
}

// --- encodings -------------------------------------------------------------

/// Decodes bytes with a WHATWG encoding label (falls back to UTF-8).
pub fn decode(bytes: &[u8], label: Option<&str>) -> String {
    match label.and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes())) {
        Some(enc) if enc != encoding_rs::UTF_8 => enc.decode(bytes).0.into_owned(),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        assert!(glob_match("origin/**", "origin/feature/x"));
        assert!(glob_match("origin/*", "origin/main"));
        assert!(!glob_match("origin/*", "origin/feature/x"));
        assert!(glob_match("**", "upstream/dev"));
        assert!(!glob_match("origin/main", "origin/mainline"));
    }

    #[test]
    fn decodes_latin1() {
        assert_eq!(decode(&[0x63, 0x61, 0x66, 0xe9], Some("windows-1252")), "café");
        assert_eq!(decode("ok".as_bytes(), None), "ok");
    }
}
