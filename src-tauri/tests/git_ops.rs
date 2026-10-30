//! End-to-end tests of the git backend against throwaway repositories.

use corvus_lib::git::{self, cli, commit, conflict, ext, graph, ops, outcome::{self, OpStatus}, refs, status};
use std::fs;
use std::process::Command;

fn sh(dir: &str, args: &[&str]) {
    let ok = Command::new("git").current_dir(dir).args(args).status().unwrap().success();
    assert!(ok, "git {args:?}");
}

fn repo() -> (tempfile::TempDir, String) {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().to_string_lossy().replace('\\', "/");
    sh(&p, &["init", "-q", "-b", "main"]);
    sh(&p, &["config", "user.name", "Test"]);
    sh(&p, &["config", "user.email", "t@example.com"]);
    sh(&p, &["config", "commit.gpgsign", "false"]);
    (d, p)
}

fn write(p: &str, f: &str, s: &str) {
    fs::write(format!("{p}/{f}"), s).unwrap();
}

fn read(p: &str, f: &str) -> String {
    fs::read_to_string(format!("{p}/{f}")).unwrap().replace("\r\n", "\n")
}

fn commit_all(p: &str, msg: &str) {
    status::stage_all(p).unwrap();
    commit::commit(p, msg, false, false, false).unwrap();
}

#[test]
fn stage_commit_and_graph() {
    let (_d, p) = repo();
    write(&p, "a.txt", "one\n");
    let st = status::status(&p).unwrap();
    assert_eq!(st.files[0].unstaged, Some("A"));
    commit_all(&p, "first");
    ops::create_branch(&p, "feature", None, true).unwrap();
    write(&p, "a.txt", "one\ntwo\n");
    commit_all(&p, "second");
    let g = graph::build(&git::open(&p).unwrap(), 100, &[]).unwrap();
    assert_eq!(g.rows.len(), 2);
    assert_eq!(g.rows[0].summary, "second");
    assert!(g.rows[0].refs.iter().any(|r| r.name == "feature" && r.current));
    let r = refs::list(&p).unwrap();
    assert_eq!(r.head.as_deref(), Some("feature"));
    assert_eq!(r.locals.len(), 2);
    let d = commit::details(&p, &g.rows[0].oid).unwrap();
    assert_eq!((d.files[0].additions, d.files[0].deletions), (1, 0));
}

#[test]
fn line_level_staging_and_discard() {
    let (_d, p) = repo();
    write(&p, "f.txt", "a\nb\nc\n");
    commit_all(&p, "base");
    write(&p, "f.txt", "a\nB\nX\nc\n");
    let h = status::hunks(&p, "f.txt", false).unwrap();
    let plus_b = h.hunks[0].lines.iter().position(|l| l.origin == '+' && l.content == "B").unwrap();
    let minus_b = h.hunks[0].lines.iter().position(|l| l.origin == '-').unwrap();
    status::apply_hunk(&p, "f.txt", "stage", 0, Some(vec![minus_b, plus_b])).unwrap();
    let v = status::versions(&p, "f.txt", None, "staged", None, None).unwrap();
    assert_eq!(v.modified.replace("\r\n", "\n"), "a\nB\nc\n");
    // Unstage it again, then discard the remaining X line only.
    status::apply_hunk(&p, "f.txt", "unstage", 0, None).unwrap();
    let h = status::hunks(&p, "f.txt", false).unwrap();
    let plus_x = h.hunks[0].lines.iter().position(|l| l.content == "X").unwrap();
    status::apply_hunk(&p, "f.txt", "discard", 0, Some(vec![plus_x])).unwrap();
    assert_eq!(read(&p, "f.txt"), "a\nB\nc\n");
}

#[test]
fn merge_conflict_resolve_and_continue() {
    let (_d, p) = repo();
    write(&p, "f.txt", "base\n");
    commit_all(&p, "base");
    ops::create_branch(&p, "other", None, true).unwrap();
    write(&p, "f.txt", "theirs\n");
    commit_all(&p, "theirs");
    ops::checkout(&p, "main").unwrap();
    write(&p, "f.txt", "ours\n");
    commit_all(&p, "ours");
    assert!(ops::merge(&p, "other", false, false).is_err());
    let st = status::status(&p).unwrap();
    assert_eq!(st.state, "merge");
    assert!(st.files.iter().any(|f| f.conflicted));
    let v = conflict::versions(&p, "f.txt").unwrap();
    assert_eq!((v.ours.trim(), v.theirs.trim(), v.base.trim()), ("ours", "theirs", "base"));
    conflict::resolve(&p, "f.txt", "both\n").unwrap();
    conflict::continue_op(&p).unwrap();
    assert_eq!(status::status(&p).unwrap().state, "clean");
    let g = graph::build(&git::open(&p).unwrap(), 100, &[]).unwrap();
    assert_eq!(g.rows[0].parents.len(), 2);
}

#[test]
fn interactive_rebase_reword_squash_drop() {
    let (_d, p) = repo();
    write(&p, "f.txt", "0\n");
    commit_all(&p, "root");
    for i in 1..=3 {
        write(&p, &format!("f{i}.txt"), "x\n");
        commit_all(&p, &format!("c{i}"));
    }
    let root = graph::build(&git::open(&p).unwrap(), 100, &[]).unwrap().rows.last().unwrap().oid.clone();
    let commits = ops::rebase_commits(&p, Some(&root)).unwrap();
    assert_eq!(commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["c1", "c2", "c3"]);
    let todo = vec![
        ops::TodoItem { action: "reword".into(), oid: commits[0].oid.clone(), message: Some("renamed".into()) },
        ops::TodoItem { action: "fixup".into(), oid: commits[1].oid.clone(), message: None },
        ops::TodoItem { action: "drop".into(), oid: commits[2].oid.clone(), message: None },
    ];
    ops::rebase_interactive(&p, Some(&root), &todo).unwrap();
    let g = graph::build(&git::open(&p).unwrap(), 100, &[]).unwrap();
    let summaries: Vec<_> = g.rows.iter().map(|r| r.summary.as_str()).collect();
    assert_eq!(summaries, ["renamed", "root"]);
    assert!(fs::metadata(format!("{p}/f2.txt")).is_ok());
    assert!(fs::metadata(format!("{p}/f3.txt")).is_err());
}

#[test]
fn stash_and_undo() {
    let (_d, p) = repo();
    write(&p, "f.txt", "a\n");
    commit_all(&p, "one");
    write(&p, "f.txt", "b\n");
    commit_all(&p, "two");
    write(&p, "f.txt", "dirty\n");
    ops::stash_save(&p, Some("wip")).unwrap();
    let r = refs::list(&p).unwrap();
    assert_eq!(r.stashes.len(), 1);
    assert!(r.stashes[0].message.contains("wip"));
    assert_eq!(read(&p, "f.txt"), "b\n");
    ops::stash_action(&p, "pop", 0).unwrap();
    assert_eq!(read(&p, "f.txt"), "dirty\n");
    ops::stash_save(&p, None).unwrap();
    let u = ops::undo_info(&p).unwrap().unwrap();
    assert!(u.message.starts_with("commit"));
    ops::reset(&p, &u.to, "keep").unwrap();
    let g = graph::build(&git::open(&p).unwrap(), 100, &[]).unwrap();
    assert_eq!(g.rows.iter().find(|r| r.is_head).unwrap().summary, "one");
}

#[test]
fn gitflow_feature_and_release() {
    let (_d, p) = repo();
    write(&p, "f.txt", "0\n");
    commit_all(&p, "root");
    ops::create_branch(&p, "develop", None, false).unwrap();
    ext::gitflow_init(&p, "main", "develop", "feature/", "release/", "hotfix/", "v").unwrap();
    assert!(ext::gitflow(&p).initialized);
    ext::gitflow_start(&p, "feature", "login").unwrap();
    write(&p, "login.txt", "x\n");
    commit_all(&p, "login");
    ext::gitflow_finish(&p, "feature", "login", None).unwrap();
    ext::gitflow_start(&p, "release", "1.0").unwrap();
    ext::gitflow_finish(&p, "release", "1.0", None).unwrap();
    let r = refs::list(&p).unwrap();
    assert!(r.tags.iter().any(|t| t.name == "v1.0"));
    assert!(!r.locals.iter().any(|b| b.name.starts_with("feature/") || b.name.starts_with("release/")));
    assert!(fs::metadata(format!("{p}/login.txt")).is_ok());
    ops::checkout(&p, "main").unwrap();
    assert!(fs::metadata(format!("{p}/login.txt")).is_ok());
}

#[test]
fn sparse_checkout_toggle() {
    let (_d, p) = repo();
    fs::create_dir_all(format!("{p}/src")).unwrap();
    fs::create_dir_all(format!("{p}/docs")).unwrap();
    write(&p, "src/a.txt", "a\n");
    write(&p, "docs/b.txt", "b\n");
    write(&p, "README.md", "r\n");
    commit_all(&p, "root");
    ext::sparse_set(&p, &["/src/".to_string()]).unwrap();
    let s = ext::sparse(&p);
    assert!(s.enabled);
    assert!(fs::metadata(format!("{p}/src/a.txt")).is_ok());
    assert!(fs::metadata(format!("{p}/docs/b.txt")).is_err());
    ext::sparse_action(&p, "disable").unwrap();
    assert!(fs::metadata(format!("{p}/docs/b.txt")).is_ok());
}

#[test]
fn predicts_conflicts_with_base() {
    let (_d, p) = repo();
    write(&p, "f.txt", "base\n");
    commit_all(&p, "base");
    ops::create_branch(&p, "topic", None, true).unwrap();
    write(&p, "f.txt", "topic\n");
    commit_all(&p, "topic");
    ops::checkout(&p, "main").unwrap();
    write(&p, "f.txt", "main\n");
    commit_all(&p, "main");
    ops::checkout(&p, "topic").unwrap();
    let c = ext::conflict_check(&p, &["**".into()], Some("main")).unwrap();
    assert_eq!(c.base.as_deref(), Some("main"));
    assert_eq!(c.files, vec!["f.txt".to_string()]);
}
#[test]
fn outcomes_report_checkout_conflicts_and_noop() {
    let (_d, p) = repo();
    write(&p, "f.txt", "base\n");
    commit_all(&p, "base");
    ops::create_branch(&p, "feat/x", None, false).unwrap();
    let o = outcome::checkout(&p, "feat/x", false).unwrap();
    assert_eq!((o.from.as_deref(), o.to.as_deref(), o.status), (Some("main"), Some("feat/x"), OpStatus::Ok));
    write(&p, "f.txt", "theirs\n");
    status::stage_all(&p).unwrap();
    let c = outcome::commit(&p, "theirs\n", false, false, false).unwrap();
    assert_eq!(c.detail, "theirs");
    outcome::checkout(&p, "main", false).unwrap();
    write(&p, "f.txt", "ours\n");
    commit_all(&p, "ours");
    let m = outcome::merge(&p, "feat/x", false, false).unwrap();
    assert_eq!(m.status, OpStatus::Warning);
    assert_eq!(m.conflicts, vec!["f.txt".to_string()]);
    assert_eq!((m.from.as_deref(), m.to.as_deref()), (Some("feat/x"), Some("main")));
    conflict::abort_op(&p).unwrap();
    let again = outcome::merge(&p, "main", false, false).unwrap();
    assert_eq!(again.status, OpStatus::Noop);
}
#[test]
fn graph_pins_trunks_and_gives_features_own_lanes() {
    // Shape of the user's teste-openkraken repo:
    // main: c0 - c1 - M(merge of feat/add)   dev: D (on M)
    // feat/add: A1 (on c1); a2, a3 fork from A1; seila and pr fork from D.
    let (_d, p) = repo();
    let commit = |f: &str| {
        write(&p, f, f);
        commit_all(&p, f);
    };
    commit("c0");
    commit("c1");
    ops::create_branch(&p, "feat/add", None, true).unwrap();
    commit("A1");
    ops::create_branch(&p, "a2", None, true).unwrap();
    commit("a2");
    ops::checkout(&p, "feat/add").unwrap();
    ops::create_branch(&p, "a3", None, true).unwrap();
    commit("a3");
    ops::checkout(&p, "main").unwrap();
    ops::merge(&p, "feat/add", true, false).unwrap();
    ops::create_branch(&p, "dev", None, true).unwrap();
    commit("D");
    ops::create_branch(&p, "pr", None, true).unwrap();
    commit("P");
    ops::checkout(&p, "dev").unwrap();
    ops::create_branch(&p, "feature/seila", None, true).unwrap();
    commit("S");

    let trunks = ["main".to_string(), "dev".to_string()];
    let g = graph::build(&git::open(&p).unwrap(), 100, &trunks).unwrap();
    let lane = |s: &str| g.rows.iter().find(|r| r.summary == s).unwrap_or_else(|| panic!("{s}")).lane;
    assert_eq!(lane("D"), 1, "dev keeps its trunk column");
    assert_eq!(lane("c1"), 0);
    assert!(g.rows.iter().any(|r| r.summary.starts_with("Merge") && r.lane == 0), "main merge in column 0");
    assert!(lane("S") >= 2 && lane("P") >= 2 && lane("S") != lane("P"), "features get their own columns");
    // Trunk columns (0 = main, 1 = dev) are never lent to feature branches.
    assert!(lane("a2") >= 2 && lane("a3") >= 2 && lane("a2") != lane("a3"), "sibling tips are not stacked");
    assert!(lane("A1") >= 2, "features stay right of the trunks");    let a1 = g.rows.iter().find(|r| r.summary == "A1").unwrap();
    let converging = a1.segs.iter().filter(|s| s.half == graph::Half::Top).count();
    // The merge line joins an existing line to A1 rather than adding its own.
    assert!(converging >= 2, "a2 and a3 converge into A1 ({converging})");
}
/// Prints the layout of a real repository: `CORVUS_REPO=path cargo test -- --ignored dump_graph --nocapture`.
#[test]
#[ignore]
fn dump_graph() {
    let path = std::env::var("CORVUS_REPO").expect("set CORVUS_REPO");
    let trunks: Vec<String> = ["main", "master", "develop", "dev"].iter().map(|s| s.to_string()).collect();
    let g = graph::build(&git::open(&path).unwrap(), 200, &trunks).unwrap();
    for r in &g.rows {
        let mut cols = vec![' '; g.width as usize];
        for s in &r.segs {
            if s.half == graph::Half::Full && s.from == s.to {
                cols[s.from as usize] = '│';
            }
        }
        cols[r.lane as usize] = '●';
        let refs: Vec<_> = r.refs.iter().map(|x| x.name.as_str()).collect();
        let turns: Vec<String> = r.segs.iter().filter(|s| s.from != s.to).map(|s| format!("{:?}{}→{}", s.half, s.from, s.to)).collect();
        println!("{} {:<40} {:?} {}", cols.iter().collect::<String>(), r.summary.chars().take(40).collect::<String>(), refs, turns.join(" "));
    }
}
#[test]
fn gitflow_init_rejects_missing_branches() {
    let (_d, p) = repo();
    write(&p, "f.txt", "0\n");
    commit_all(&p, "root");
    let err = ext::gitflow_init(&p, "main", "Develop", "feature/", "release/", "hotfix/", "").unwrap_err().to_string();
    assert!(err.contains("branches not found") && err.contains("Develop"), "{err}");
    assert!(!ext::gitflow(&p).initialized, "nothing is configured on failure");
    let err = ext::gitflow_init(&p, "master", "dev", "feature/", "release/", "hotfix/", "").unwrap_err().to_string();
    assert!(err.contains("master") && err.contains("dev"), "lists every missing branch: {err}");
}
/// Parents of the commit `path` has checked out.
fn head_parents(path: &str) -> usize {
    git::open(path).unwrap().head().unwrap().peel_to_commit().unwrap().parent_count()
}

#[test]
fn pull_fast_forwards_if_possible_and_merges_otherwise() {
    let (_o, origin) = repo();
    write(&origin, "a.txt", "base\n");
    commit_all(&origin, "base");
    let dir = tempfile::tempdir().unwrap();
    let clone = dir.path().join("clone").to_string_lossy().replace('\\', "/");
    sh(&origin, &["clone", "-q", &origin, &clone]);
    for (key, value) in [("user.name", "Test"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")] {
        sh(&clone, &["config", key, value]);
    }

    // Only the upstream moved: a plain fast-forward, no merge commit.
    write(&origin, "b.txt", "upstream\n");
    commit_all(&origin, "upstream 1");
    outcome::pull(&clone, ops::PullMode::Ff, |_| {}).unwrap();
    assert_eq!(read(&clone, "b.txt"), "upstream\n");
    assert_eq!(head_parents(&clone), 1);

    // Both sides moved: fast-forward only refuses, the default merges.
    write(&origin, "c.txt", "upstream\n");
    commit_all(&origin, "upstream 2");
    write(&clone, "d.txt", "local\n");
    commit_all(&clone, "local");
    assert!(ops::pull(&clone, ops::PullMode::FfOnly, |_| {}).is_err());
    let o = outcome::pull(&clone, ops::PullMode::Ff, |_| {}).unwrap();
    assert_eq!(o.status, OpStatus::Ok);
    assert_eq!(head_parents(&clone), 2);
    assert_eq!(read(&clone, "c.txt"), "upstream\n");
}

#[test]
fn refuses_values_git_would_parse_as_options() {
    let (_d, p) = repo();
    write(&p, "a.txt", "one\n");
    commit_all(&p, "one");
    let marker = format!("{p}/ran");
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("clone").to_string_lossy().replace('\\', "/");

    assert!(ops::clone(&format!("--upload-pack=touch {marker}"), &dest, |_| {}).is_err());
    assert!(ops::add_remote(&p, "evil", "--upload-pack=x").is_err());
    assert!(ops::checkout(&p, "--orphan=x").is_err());
    assert!(ops::create_branch(&p, "-f", None, false).is_err());
    assert!(ops::merge(&p, "--into-name=x", false, false).is_err());
    assert!(ops::rebase_interactive(&p, Some("--exec=x"), &[]).is_err());
    assert!(!std::path::Path::new(&marker).exists(), "no option reached git");

    // Plain values still work, and clone still clones.
    ops::create_branch(&p, "feat/x", None, false).unwrap();
    ops::clone(&p, &dest, |_| {}).unwrap();
    assert_eq!(read(&dest, "a.txt"), "one\n");
}

#[test]
fn file_paths_stay_inside_the_repository() {
    let (d, p) = repo();
    let outside = d.path().parent().unwrap().join("corvus-escape.txt");
    let absolute = outside.to_string_lossy().replace('\\', "/");
    let name = outside.file_name().unwrap().to_string_lossy().into_owned();

    for file in [format!("../{name}"), absolute] {
        assert!(conflict::resolve(&p, &file, "x").is_err(), "{file}");
        assert!(status::versions(&p, &file, None, "unstaged", None, None).is_err(), "{file}");
        assert!(status::versions(&p, &file, None, "staged", None, None).is_err(), "{file}");
        assert!(status::discard(&p, std::slice::from_ref(&file)).is_err(), "{file}");
    }
    assert!(!outside.exists(), "nothing was written outside the repo");
}

#[test]
fn cherry_pick_refuses_ids_that_are_not_hex() {
    let (_d, p) = repo();
    write(&p, "a.txt", "one\n");
    commit_all(&p, "one");
    assert!(outcome::cherry_pick(&p, "ééééééé").is_err());
    assert!(outcome::revert(&p, "--abort").is_err());
}

#[test]
fn local_operations_hide_integration_tokens_from_hooks() {
    let (_d, p) = repo();
    let token = "corvus-test-token";
    cli::set_tokens(vec![cli::HostToken { host: "github.com".into(), username: "x-access-token".into(), token: token.into() }]);
    let hook = format!("{p}/.git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh
env > .git/hook-env
").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }

    write(&p, "a.txt", "one
");
    commit_all(&p, "one");
    let env = read(&p, ".git/hook-env");
    assert!(env.contains("GIT_EDITOR"), "the hook ran under Corvus' git");
    assert!(!env.contains(token), "a commit hook never sees integration tokens");
}
