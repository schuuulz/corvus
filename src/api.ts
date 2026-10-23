import { invoke } from "@tauri-apps/api/core";

export type Half = "full" | "top" | "bottom";
export interface Seg { from: number; to: number; half: Half; color: number }
export interface RefLabel {
  name: string;
  kind: "local" | "remote" | "tag" | "head";
  current: boolean;
  /** Remotes whose same branch is on this commit (grouped into this label). */
  remotes: string[];
}
export interface GraphRow {
  oid: string; parents: string[]; lane: number; color: number; segs: Seg[]; refs: RefLabel[];
  summary: string; body: string; author: string; email: string; time: number; isHead: boolean;
}
export interface Graph {
  rows: GraphRow[];
  width: number;
  hasMore: boolean;
  head: string | null;
  /** Columns 0..trunks hold main branches; their segments use colors < trunks. */
  trunks: number;
}

export interface RepoInfo {
  path: string; name: string; state: string; headBranch: string | null; headOid: string | null; unborn: boolean;
}

export interface LocalBranch { name: string; oid: string | null; upstream: string | null; ahead: number; behind: number; isHead: boolean }
export interface RemoteBranch { name: string; remote: string; branch: string; oid: string | null }
export interface Remote { name: string; url: string | null }
export interface Tag { name: string; oid: string | null }
export interface Stash { index: number; message: string; oid: string }
export interface Submodule { name: string; path: string }
export interface Refs {
  head: string | null; detached: boolean; locals: LocalBranch[]; remoteBranches: RemoteBranch[];
  remotes: Remote[]; tags: Tag[]; stashes: Stash[]; submodules: Submodule[];
}

export type Code = "A" | "M" | "D" | "R" | "T";
export interface FileStatus { path: string; oldPath: string | null; staged: Code | null; unstaged: Code | null; conflicted: boolean }
export interface WorkStatus { files: FileStatus[]; state: string }

export interface Line { origin: " " | "+" | "-" | "\\"; content: string; oldNo: number | null; newNo: number | null }
export interface Hunk { header: string; oldStart: number; newStart: number; lines: Line[] }
export interface FileHunks { hunks: Hunk[]; binary: boolean }
export interface Versions { original: string; modified: string; binary: boolean }

export interface ChangedFile { path: string; oldPath: string | null; status: string; additions: number; deletions: number }
export interface CommitDetail {
  oid: string; parents: string[]; author: string; email: string; authorTime: number;
  committer: string; commitTime: number; summary: string; body: string; files: ChangedFile[];
}
export interface HistoryEntry { oid: string; author: string; time: number; summary: string }
export interface BlameLine { line: number; oid: string; author: string; time: number; summary: string; content: string }
export interface ConflictVersions { base: string; ours: string; theirs: string; merged: string }
export interface RebaseCommit { oid: string; summary: string; message: string; author: string }
export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";
export interface TodoItem { action: RebaseAction; oid: string; message?: string }
export interface UndoInfo { message: string; from: string; to: string }
export interface Identity { name: string; email: string; defaultBranch: string }
export type DiffMode = "unstaged" | "staged" | "commit";
/** Structured result of an operation (see src-tauri/src/git/outcome.rs). */
export interface OpOutcome { status: "ok" | "warning" | "noop"; from: string | null; to: string | null; count: number | null; conflicts: string[]; detail: string }

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const api = {
  repoInfo: (path: string) => call<RepoInfo>("repo_info", { path }),
  watch: (repo: string) => call<void>("watch_repo", { repo }),
  unwatch: (repo: string) => call<void>("unwatch_repo", { repo }),
  graph: (repo: string, limit: number, trunks: string[] = []) => call<Graph>("get_graph", { repo, limit, trunks }),
  refs: (repo: string) => call<Refs>("get_refs", { repo }),
  status: (repo: string) => call<WorkStatus>("get_status", { repo }),
  hunks: (repo: string, file: string, staged: boolean) => call<FileHunks>("get_hunks", { repo, file, staged }),
  applyHunk: (repo: string, file: string, action: "stage" | "unstage" | "discard", hunk: number, lines?: number[]) =>
    call<void>("apply_hunk", { repo, file, action, hunk, lines: lines ?? null }),
  versions: (repo: string, file: string, mode: DiffMode, oid?: string, oldFile?: string | null, encoding?: string | null) =>
    call<Versions>("get_versions", { repo, file, mode, oid: oid ?? null, oldFile: oldFile ?? null, encoding: encoding ?? null }),
  stage: (repo: string, files: string[]) => call<void>("stage_files", { repo, files }),
  unstage: (repo: string, files: string[]) => call<void>("unstage_files", { repo, files }),
  stageAll: (repo: string) => call<void>("stage_all", { repo }),
  unstageAll: (repo: string) => call<void>("unstage_all", { repo }),
  discard: (repo: string, files: string[]) => call<void>("discard_files", { repo, files }),
  commit: (repo: string, message: string, amend: boolean, noVerify = false, stripComments = false) =>
    call<OpOutcome>("commit", { repo, message, amend, noVerify, stripComments }),
  headMessage: (repo: string) => call<string>("head_message", { repo }),
  commitDetails: (repo: string, oid: string) => call<CommitDetail>("commit_details", { repo, oid }),
  fileHistory: (repo: string, file: string) => call<HistoryEntry[]>("file_history", { repo, file }),
  blame: (repo: string, file: string) => call<BlameLine[]>("blame", { repo, file }),
  conflictVersions: (repo: string, file: string) => call<ConflictVersions>("conflict_versions", { repo, file }),
  resolveConflict: (repo: string, file: string, content: string) => call<void>("resolve_conflict", { repo, file, content }),
  continueOp: (repo: string) => call<string>("continue_op", { repo }),
  abortOp: (repo: string) => call<string>("abort_op", { repo }),
  checkout: (repo: string, target: string) => call<OpOutcome>("checkout", { repo, target }),
  checkoutRemote: (repo: string, branch: string) => call<OpOutcome>("checkout_remote", { repo, branch }),
  createBranch: (repo: string, name: string, start: string | null, checkout: boolean) =>
    call<void>("create_branch", { repo, name, start, checkout }),
  deleteBranch: (repo: string, name: string, force: boolean) => call<void>("delete_branch", { repo, name, force }),
  renameBranch: (repo: string, old: string, name: string) => call<void>("rename_branch", { repo, old, new: name }),
  setUpstream: (repo: string, branch: string, upstream: string) => call<void>("set_upstream", { repo, branch, upstream }),
  createTag: (repo: string, name: string, target: string, message: string | null) =>
    call<void>("create_tag", { repo, name, target, message }),
  deleteTag: (repo: string, name: string) => call<void>("delete_tag", { repo, name }),
  merge: (repo: string, from: string, noFf: boolean, squash = false) => call<OpOutcome>("merge", { repo, from, noFf, squash }),
  rebase: (repo: string, onto: string) => call<OpOutcome>("rebase", { repo, onto }),
  cherryPick: (repo: string, oid: string) => call<OpOutcome>("cherry_pick", { repo, oid }),
  revert: (repo: string, oid: string) => call<OpOutcome>("revert", { repo, oid }),
  reset: (repo: string, oid: string, mode: "soft" | "mixed" | "hard" | "keep") => call<void>("reset", { repo, oid, mode }),
  stashSave: (repo: string, message: string | null) => call<void>("stash_save", { repo, message }),
  stashAction: (repo: string, action: "apply" | "pop" | "drop", index: number) => call<OpOutcome>("stash_action", { repo, action, index }),
  fetch: (repo: string) => call<OpOutcome>("fetch", { repo }),
  pull: (repo: string, mode: PullMode) => call<OpOutcome>("pull", { repo, mode }),
  push: (repo: string, force: boolean) => call<OpOutcome>("push", { repo, force }),
  pushBranch: (repo: string, remote: string, branch: string) => call<void>("push_branch", { repo, remote, branch }),
  deleteRemoteBranch: (repo: string, remote: string, branch: string) => call<void>("delete_remote_branch", { repo, remote, branch }),
  addRemote: (repo: string, name: string, url: string) => call<void>("add_remote", { repo, name, url }),
  removeRemote: (repo: string, name: string) => call<void>("remove_remote", { repo, name }),
  clone: (url: string, dest: string) => call<void>("clone_repo", { url, dest }),
  init: (path: string) => call<void>("init_repo", { path }),
  rebaseCommits: (repo: string, base: string | null) => call<RebaseCommit[]>("rebase_commits", { repo, base }),
  rebaseInteractive: (repo: string, base: string | null, todo: TodoItem[]) => call<string>("rebase_interactive", { repo, base, todo }),
  undoInfo: (repo: string) => call<UndoInfo | null>("undo_info", { repo }),
  identity: (repo: string | null) => call<Identity>("get_identity", { repo }),
  setConfig: (repo: string | null, key: string, value: string) => call<void>("set_config", { repo, key, value }),
};

/** Mirrors `git::ops::PullMode`: "ff" fast-forwards when possible and merges otherwise. */
export type PullMode = "ff" | "ff-only" | "rebase";

export type IntegrationKind = "github" | "github-enterprise" | "gitlab" | "gitlab-self";
export interface Integration { id: string; kind: IntegrationKind; host: string; username: string; name: string; avatar: string }
export interface Account { username: string; name: string; avatar: string }
export interface PullRequest { number: number; title: string; url: string; author: string; source: string; target: string; draft: boolean; updated: string }
export interface NewPullRequest { source: string; target: string; title: string; body: string; draft: boolean }
/** What the connected account may do on the hosted repository. */
export interface RepoAccess { canPush: boolean; defaultBranch: string }
export interface Issue { number: number; title: string; url: string; author: string; labels: string[] }
export interface RemoteRef { host: string; path: string }
export interface LogEntry { id: number; time: number; cwd: string; args: string; ok: boolean; ms: number; output: string }
export interface SshKeyPair { privateKey: string; publicKey: string }
export interface GpgKey { id: string; uid: string; expires: number | null }
export interface ExternalTool { id: string; name: string; kind: "editor" | "terminal" | "merge"; path: string }
export interface Shell { id: string; name: string; program: string }
export interface Gitflow { initialized: boolean; master: string; develop: string; feature: string; release: string; hotfix: string; versionTag: string }
export interface Lfs { installed: boolean; initialized: boolean; patterns: string[] }
export interface Sparse { enabled: boolean; paths: string[] }
export interface ConflictCheck { base: string | null; files: string[] }
export interface SettingsData { global: Record<string, unknown>; repos: Record<string, Record<string, unknown>> }
export interface CliConfig { gitPath: string; sshKey: string | null; extendedLog: boolean }

export const ext = {
  settings: () => call<SettingsData>("get_settings"),
  setSetting: (repo: string | null, key: string, value: unknown) => call<SettingsData>("set_setting", { repo, key, value }),
  configureCli: (config: CliConfig) => call<void>("configure_cli", { config }),
  configureTokens: (integrations: { kind: IntegrationKind; host: string }[]) => call<void>("configure_tokens", { integrations }),
  configGet: (repo: string | null, key: string) => call<string>("git_config_get", { repo, key }),
  configSet: (repo: string | null, key: string, value: string) => call<void>("git_config_set", { repo, key, value }),
  activityLog: () => call<LogEntry[]>("activity_log"),
  clearActivityLog: () => call<void>("clear_activity_log"),
  submoduleUpdate: (repo: string) => call<void>("submodule_update", { repo }),
  deleteOrigFiles: (repo: string) => call<number>("delete_orig_files", { repo }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  writeRepoFile: (repo: string, file: string, content: string) => call<void>("write_repo_file", { repo, file, content }),
  sshGenerate: (path: string | null, comment: string, passphrase: string) => call<SshKeyPair>("ssh_generate", { path, comment, passphrase }),
  gpgList: (program: string) => call<GpgKey[]>("gpg_list", { program }),
  gpgGenerate: (program: string, name: string, email: string, passphrase: string) => call<void>("gpg_generate", { program, name, email, passphrase }),
  detectTools: () => call<ExternalTool[]>("detect_tools"),
  openInEditor: (toolPath: string, target: string) => call<void>("open_in_editor", { toolPath, target }),
  openTerminal: (toolId: string, toolPath: string, dir: string) => call<void>("open_terminal", { toolId, toolPath, dir }),
  openMergeTool: (repo: string, file: string, tool: string | null) => call<void>("open_merge_tool", { repo, file, tool }),
  termShells: () => call<Shell[]>("term_shells"),
  termSpawn: (id: number, cwd: string, shell: string, cols: number, rows: number) => call<void>("term_spawn", { id, cwd, shell, cols, rows }),
  termWrite: (id: number, data: string) => call<void>("term_write", { id, data }),
  termResize: (id: number, cols: number, rows: number) => call<void>("term_resize", { id, cols, rows }),
  termKill: (id: number) => call<void>("term_kill", { id }),
  termPromptBranch: (repo: string, branch: string, color: string) => call<void>("term_prompt_branch", { repo, branch, color }),
  gitflow: (repo: string) => call<Gitflow>("gitflow_get", { repo }),
  gitflowInit: (repo: string, g: Omit<Gitflow, "initialized">) => call<void>("gitflow_init", { repo, ...g }),
  gitflowStart: (repo: string, kind: string, name: string) => call<void>("gitflow_start", { repo, kind, name }),
  gitflowFinish: (repo: string, kind: string, name: string, tagMessage: string | null) => call<void>("gitflow_finish", { repo, kind, name, tagMessage }),
  lfs: (repo: string) => call<Lfs>("lfs_get", { repo }),
  lfsAction: (repo: string, action: "init" | "track" | "untrack" | "files", pattern: string | null = null) => call<string>("lfs_action", { repo, action, pattern }),
  sparse: (repo: string) => call<Sparse>("sparse_get", { repo }),
  sparseSet: (repo: string, paths: string[]) => call<void>("sparse_set", { repo, paths }),
  sparseAction: (repo: string, action: "disable" | "reapply") => call<void>("sparse_action", { repo, action }),
  conflictCheck: (repo: string, patterns: string[], preferred: string | null) => call<ConflictCheck>("conflict_check", { repo, patterns, preferred }),
  connect: (kind: IntegrationKind, host: string, token: string) => call<Account>("integration_connect", { kind, host, token }),
  disconnect: (kind: IntegrationKind, host: string) => call<void>("integration_disconnect", { kind, host }),
  pulls: (kind: IntegrationKind, host: string, repo: string) => call<PullRequest[]>("integration_pulls", { kind, host, repo }),
  issues: (kind: IntegrationKind, host: string, repo: string) => call<Issue[]>("integration_issues", { kind, host, repo }),
  repoAccess: (kind: IntegrationKind, host: string, repo: string) => call<RepoAccess>("integration_repo_access", { kind, host, repo }),
  createPr: (kind: IntegrationKind, host: string, repo: string, pr: NewPullRequest) => call<PullRequest>("integration_create_pr", { kind, host, repo, pr }),
  addSshKey: (kind: IntegrationKind, host: string, title: string, publicKeyPath: string) => call<void>("integration_add_ssh_key", { kind, host, title, publicKeyPath }),
  parseRemote: (url: string) => call<RemoteRef | null>("parse_remote", { url }),
};
