// User-level operations shared by the toolbar, context menus and the
// command palette. Each one asks for input if needed, then runs through
// `store.run`, which shows loading → success / warning / error feedback and
// refreshes the repo.

import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { createElement } from "react";
import { Cloud, GitPullRequest } from "lucide-react";
import { api, ext, Gitflow, GraphRow, LocalBranch, NewPullRequest, OpOutcome, RefLabel, RemoteBranch } from "./api";
import { fb } from "./feedback";
import { t } from "./i18n";
import { g, gitMessage, MenuEntry, NEW_TAB, r, RepoIntegration, shortSha, useStore } from "./store";

const S = () => useStore.getState();
const active = () => {
  const a = S().active;
  return a && a !== NEW_TAB ? a : null;
};
const head = () => {
  const a = active();
  return a ? S().repos[a]?.info?.headBranch ?? null : null;
};
const ok = (o: OpOutcome | undefined) => !!o && o.status !== "warning";

export async function notify(title: string, body: string) {
  if (!g("desktopNotifications") || document.hasFocus()) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* notifications unavailable */
  }
}

/** Runs post-operation housekeeping configured in General preferences. */
async function afterSync(repo: string) {
  if (g("updateSubmodules") && (S().repos[repo]?.refs?.submodules.length ?? 0) > 0) {
    await ext.submoduleUpdate(repo).catch((e) => S().toast(`Submodule update failed\n${gitMessage(e)}`, "error"));
  }
}

export async function openRepoDialog() {
  const dir = await open({ directory: true, title: "Open repository" });
  if (typeof dir === "string") await S().openRepo(dir);
}

export async function initRepoDialog() {
  const dir = await open({ directory: true, title: "Choose a folder to initialise" });
  if (typeof dir !== "string") return;
  try {
    await api.init(dir);
    await S().openRepo(dir);
  } catch (e) {
    S().toast(gitMessage(e), "error");
  }
}

export async function cloneRepo(url: string, dest: string) {
  S().set({ busy: "Cloning", progress: "" });
  const id = S().notify({ kind: "loading", title: t("op.working", { label: "Clone" }), description: url });
  S().set({ loadingToast: id });
  try {
    await api.clone(url, dest);
    S().updateToast(id, { kind: "success", title: t("clone.title"), description: dest });
    await S().openRepo(dest);
    void notify(t("clone.title"), dest);
    return true;
  } catch (e) {
    S().updateToast(id, { kind: "error", title: t("op.failed", { label: "Clone" }), description: gitMessage(e) });
    return false;
  } finally {
    S().set({ busy: null, loadingToast: null });
  }
}

export async function undo() {
  const repo = active();
  if (!repo) return;
  const info = await api.undoInfo(repo).catch(() => null);
  if (!info) return S().notify({ kind: "info", title: t("nothing.undo") });
  const confirmed = await S().ask({
    title: "Undo",
    message: `Undo “${info.message}”? HEAD moves back to ${shortSha(info.to)}. Uncommitted changes are kept.`,
    confirmLabel: "Undo",
  });
  if (!confirmed) return;
  const done = await S().run("Undo", (rp) => api.reset(rp, info.to, "keep").then(() => true), {
    success: () => ({ title: t("undo.title"), description: info.message }),
  });
  if (done) S().set({ redo: { ...S().redo, [repo]: [...(S().redo[repo] ?? []), info.from] } });
}

export async function redo() {
  const repo = active();
  if (!repo) return;
  const stack = S().redo[repo] ?? [];
  const target = stack[stack.length - 1];
  if (!target) return S().notify({ kind: "info", title: t("nothing.redo") });
  const done = await S().run("Redo", (rp) => api.reset(rp, target, "keep").then(() => true), {
    success: () => ({ title: t("redo.title"), description: shortSha(target) }),
  });
  if (done) S().set({ redo: { ...S().redo, [repo]: stack.slice(0, -1) } });
}

export async function fetchAll(quiet = false) {
  const repo = active();
  if (!repo) return;
  if (quiet) {
    // Background auto-fetch: no loading toast; speak up only for news.
    const before = S().repos[repo]?.graph?.rows.length ?? 0;
    try {
      await api.fetch(repo);
      await S().refresh(repo);
      const after = S().repos[repo]?.graph?.rows.length ?? 0;
      if (after > before) {
        const vars = { count: after - before, repo: repo.split("/").pop() ?? repo };
        S().notify({ kind: "info", title: t("fetch.newCommits.title"), description: t("fetch.newCommits.desc", vars) });
        void notify(t("fetch.newCommits.title"), t("fetch.newCommits.desc", vars));
      }
    } catch {
      /* visible in the activity log */
    }
    return;
  }
  await S().run("Fetch", (rp) => api.fetch(rp), { loading: t("fetch.loading"), success: fb.fetch });
}

export async function pull() {
  const branch = head() ?? "HEAD";
  const o = await S().run("Pull", (rp) => api.pull(rp, g("pullMode")), { loading: t("pull.loading", { branch }), success: fb.pull });
  const repo = active();
  if (ok(o) && repo) {
    await afterSync(repo);
    void notify(t("pull.title"), branch);
  }
}

export async function push(force = false) {
  const branch = head() ?? "HEAD";
  const o = await S().run(force ? "Force push" : "Push", (rp) => api.push(rp, force), { loading: t("push.loading", { branch }), success: fb.push });
  if (o) void notify(t("push.title"), branch);
}

export async function checkout(target: string, remote = false) {
  const o = await S().run("Checkout", (rp) => (remote ? api.checkoutRemote(rp, target) : api.checkout(rp, target)), {
    loading: t("checkout.loading", { to: target }),
    success: fb.checkout,
  });
  const repo = active();
  if (o && repo) await afterSync(repo);
  return !!o;
}

export async function newBranch(start: string | null = null, suggested = "") {
  const v = await S().ask({
    title: start ? `Create branch at ${shortSha(start)}` : "Create branch",
    fields: [
      { name: "name", label: "Branch name", placeholder: "feature/my-change", value: suggested },
      { name: "checkout", label: "Check out after creating", type: "checkbox", value: "true" },
    ],
    confirmLabel: "Create",
  });
  const name = v?.name?.trim();
  if (!name) return;
  const from = head();
  await S().run("Create branch", (rp) => api.createBranch(rp, name, start, v!.checkout === "true"), {
    success: () => ({ title: t("branch.created"), description: v!.checkout === "true" ? `${from ?? "HEAD"} → ${name}` : name }),
  });
}

export async function newTag(target: string) {
  const v = await S().ask({
    title: `Create tag at ${shortSha(target)}`,
    fields: [
      { name: "name", label: "Tag name", placeholder: "v1.0.0" },
      { name: "message", label: "Message (makes an annotated tag)", type: "textarea" },
    ],
    confirmLabel: "Create tag",
  });
  const name = v?.name?.trim();
  if (!name) return;
  await S().run("Create tag", (rp) => api.createTag(rp, name, target, v!.message || null), {
    success: () => ({ title: t("tag.created"), description: `${name} @ ${shortSha(target)}` }),
  });
}

export async function stash() {
  const v = await S().ask({
    title: "Stash changes",
    fields: [{ name: "message", label: "Message (optional)" }],
    confirmLabel: "Stash",
  });
  if (!v) return;
  await S().run("Stash", (rp) => api.stashSave(rp, v.message || null), { success: () => ({ title: t("stash.title"), description: v.message || head() || undefined }) });
}

export const stashAction = (action: "apply" | "pop" | "drop", index: number, label?: string) =>
  S().run(`Stash ${action}`, (rp) => api.stashAction(rp, action, index), {
    success: (o) => {
      const f = fb.stash(action)(o);
      return f.kind === "warning" ? f : { ...f, description: label };
    },
  });

export const pop = () => stashAction("pop", 0, S().repos[active() ?? ""]?.refs?.stashes[0]?.message);

async function confirm(title: string, message: string, confirmLabel: string, danger = false) {
  return !!(await S().ask({ title, message, confirmLabel, danger }));
}

export async function merge(from: string) {
  const squash = r("mergeSquash");
  const o = await S().run("Merge", (rp) => api.merge(rp, from, false, squash), { loading: t("merge.loading", { from }), success: fb.merge(squash) });
  const repo = active();
  if (o && squash && o.status === "ok") S().select({ kind: "wip" });
  if (repo && g("deleteOrig")) await ext.deleteOrigFiles(repo).catch(() => 0);
}

export const rebase = (onto: string) => S().run("Rebase", (rp) => api.rebase(rp, onto), { loading: t("rebase.loading", { to: onto }), success: fb.rebase });

export const cherryPick = (oid: string) => S().run("Cherry-pick", (rp) => api.cherryPick(rp, oid), { success: fb.onto("cherry.title") });
export const revert = (oid: string) => S().run("Revert", (rp) => api.revert(rp, oid), { success: fb.onto("revert.title") });

export async function resetTo(oid: string, mode: "soft" | "mixed" | "hard") {
  const msg = {
    soft: "Keeps all changes staged.",
    mixed: "Keeps all changes in the working tree, unstaged.",
    hard: "Discards all uncommitted changes and commits after this one.",
  }[mode];
  const branch = head() ?? "HEAD";
  if (!(await confirm(`Reset ${branch} to ${shortSha(oid)} (${mode})`, msg, "Reset", mode === "hard"))) return;
  await S().run("Reset", (rp) => api.reset(rp, oid, mode), {
    success: () => ({ title: t("reset.title"), description: t("reset.desc", { branch, to: shortSha(oid), mode }) }),
  });
}

export async function deleteBranch(b: LocalBranch) {
  const v = await S().ask({
    title: `Delete branch ${b.name}`,
    fields: [{ name: "force", label: "Force delete even if not merged", type: "checkbox" }],
    confirmLabel: "Delete",
    danger: true,
  });
  if (!v) return;
  await S().run("Delete branch", (rp) => api.deleteBranch(rp, b.name, v.force === "true"), { success: () => ({ title: t("branch.deleted"), description: b.name }) });
}

export async function renameBranch(name: string) {
  const v = await S().ask({ title: `Rename ${name}`, fields: [{ name: "name", label: "New name", value: name }], confirmLabel: "Rename" });
  const next = v?.name?.trim();
  if (!next || next === name) return;
  await S().run("Rename branch", (rp) => api.renameBranch(rp, name, next), { success: () => ({ title: t("branch.renamed"), description: `${name} → ${next}` }) });
}

// --- working tree ------------------------------------------------------------

const fileDesc = (files: string[]) => (files.length === 1 ? files[0] : `${files.length} files`);

export const stageFiles = (files: string[]) =>
  S().run("Stage", (rp) => api.stage(rp, files), {
    success: () => ({ title: files.length === 1 ? t("stage.file") : t("stage.files", { count: files.length }), description: fileDesc(files) }),
  });

export const unstageFiles = (files: string[]) =>
  S().run("Unstage", (rp) => api.unstage(rp, files), { success: () => ({ title: t("unstage.file"), description: fileDesc(files) }) });

export const stageAll = () => S().run("Stage all", (rp) => api.stageAll(rp), { success: () => ({ title: t("stage.all") }) });
export const unstageAll = () => S().run("Unstage all", (rp) => api.unstageAll(rp), { success: () => ({ title: t("unstage.all") }) });

export const discardFiles = (files: string[]) =>
  S().run("Discard", (rp) => api.discard(rp, files), { success: () => ({ title: t("discard.title"), description: fileDesc(files) }) });

export function applyHunk(file: string, action: "stage" | "unstage" | "discard", hunk: number, lines?: number[]) {
  const n = lines?.length ?? 0;
  const title =
    action === "discard"
      ? t("discard.title")
      : action === "stage"
        ? n ? t("stage.lines", { count: n }) : t("stage.hunk")
        : n ? t("unstage.lines", { count: n }) : t("unstage.hunk");
  return S().run(action === "stage" ? "Stage" : action === "unstage" ? "Unstage" : "Discard", (rp) => api.applyHunk(rp, file, action, hunk, lines), {
    success: () => ({ title, description: file }),
  });
}

export const commit = (message: string, amend: boolean, noVerify: boolean, strip: boolean) =>
  S().run(amend ? "Amend" : "Commit", (rp) => api.commit(rp, message, amend, noVerify, strip), { loading: t("commit.loading"), success: fb.commit(amend) });

// --- external tools --------------------------------------------------------

async function tool(kind: "editor" | "terminal", id: string) {
  if (!id) {
    S().notify({ kind: "warning", title: `No external ${kind} configured`, description: "Choose one in Preferences › External Tools" });
    S().openPrefs("tools");
    return null;
  }
  const tools = await ext.detectTools();
  return tools.find((x) => x.kind === kind && x.id === id) ?? null;
}

export async function openInEditor(file?: string) {
  const repo = active();
  if (!repo) return;
  const tl = await tool("editor", g("editorTool"));
  if (tl) await ext.openInEditor(tl.path, file ? `${repo}/${file}` : repo).catch((e) => S().toast(gitMessage(e), "error"));
}

export async function openExternalTerminal() {
  const repo = active();
  if (!repo) return;
  const tl = await tool("terminal", g("terminalTool"));
  if (tl) await ext.openTerminal(tl.id, tl.path, repo).catch((e) => S().toast(gitMessage(e), "error"));
}

export async function openMergeTool(file: string) {
  const mt = g("mergeTool");
  await S().run("Merge tool", (rp) => ext.openMergeTool(rp, file, mt === "default" ? null : mt), { quiet: true });
}

// --- gitflow -----------------------------------------------------------------

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export type FlowKind = "feature" | "release" | "hotfix";

/** Turns the backend's "branches not found: a, b" into a clear message. */
const flowError = (message: string) => {
  const m = message.match(/branches not found: (.*)/);
  return m ? { kind: "error" as const, title: t("gitflow.missing.title"), description: t("gitflow.missing.desc", { names: m[1] }) } : null;
};

export async function gitflowInit(cfg: Omit<Gitflow, "initialized">) {
  const done = await S().run("Gitflow", (rp) => ext.gitflowInit(rp, cfg).then(() => true), {
    success: () => ({ title: t("gitflow.initialized"), description: `${cfg.master} · ${cfg.develop}` }),
    error: flowError,
  });
  await S().loadGitflow();
  return !!done;
}

/** Starts a flow branch; asks for the name unless one is given. */
export async function gitflowStart(kind: FlowKind, given?: string) {
  let name = given?.trim();
  if (!name) {
    const v = await S().ask({ title: `Start ${kind}`, fields: [{ name: "name", label: `${cap(kind)} name` }], confirmLabel: "Start" });
    name = v?.name?.trim();
  }
  if (!name) return false;
  const branch = name;
  const done = await S().run(`Start ${kind}`, (rp) => ext.gitflowStart(rp, kind, branch).then(() => true), {
    success: () => ({ title: t("gitflow.started", { kind: cap(kind) }), description: branch }),
    error: flowError,
  });
  return !!done;
}

export async function gitflowFinish(kind: FlowKind, name: string) {
  const fields = kind === "feature" ? [] : [{ name: "message", label: "Tag message (optional)" }];
  const v = await S().ask({ title: `Finish ${kind} ${name}`, message: kind === "feature" ? "Merges into develop and deletes the branch." : "Merges into main (tagged) and develop, then deletes the branch.", fields, confirmLabel: "Finish" });
  if (!v) return false;
  const done = await S().run(`Finish ${kind}`, (rp) => ext.gitflowFinish(rp, kind, name, v.message || null).then(() => true), {
    success: () => ({ title: t("gitflow.finished", { kind: cap(kind) }), description: name }),
    error: flowError,
  });
  return !!done;
}

// --- pull requests -----------------------------------------------------------

/** The active repo's hosted repository, when its account may open pull requests there. */
export function pullRequestHost(): RepoIntegration | null {
  const repo = active();
  const ri = repo ? S().repoIntegration[repo] : null;
  return ri?.access?.canPush ? ri : null;
}

/** Branch names on `remote`: the only branches a pull request can target. */
export function remoteBranchNames(remote: string): string[] {
  const repo = active();
  const branches = repo ? S().repos[repo]?.refs?.remoteBranches ?? [] : [];
  return branches.filter((b) => b.remote === remote).map((b) => b.branch);
}

export function openPullRequest(source: string, target?: string) {
  S().set({ modal: { kind: "pr", branch: source, base: target } });
}

/**
 * Opens a pull request on the hosted repo, pushing its source branch first
 * when `push` is set, then shows it in the browser. Resolves to whether it
 * was created.
 */
export async function createPullRequest(host: RepoIntegration, pr: NewPullRequest, push: boolean): Promise<boolean> {
  const { integration: i, remote, remoteName } = host;
  const created = await S().run(
    t("pr.loading"),
    async (repo) => {
      if (push) await api.pushBranch(repo, remoteName, pr.source);
      return ext.createPr(i.kind, i.host, remote.path, pr);
    },
    {
      loadingDesc: `${pr.source} → ${pr.target}`,
      success: (c) => ({ title: t("pr.created"), description: `#${c.number} ${c.title}` }),
      error: (message) => ({ title: t("pr.failed"), description: message }),
    },
  );
  if (!created) return false;
  S().set({ pullRequestsVersion: S().pullRequestsVersion + 1 });
  void openExternal(created.url);
  return true;
}

/** "Merge <current> into <target>…" per target on the hosted repo; none without permission. */
function pullRequestItems(targets: string[]): MenuEntry[] {
  const source = head();
  const host = pullRequestHost();
  if (!source || !host) return [];
  const hosted = new Set(remoteBranchNames(host.remoteName));
  return [...new Set(targets)]
    .filter((target) => target !== source && hosted.has(target))
    .map((target) => ({
      icon: createElement(GitPullRequest, { size: 13 }),
      label: t("pr.menu", { source, target }),
      action: () => openPullRequest(source, target),
    }));
}

/** The branch a graph label names on `remote`, if it names one there. */
function branchOn(remote: string, label: RefLabel): string | null {
  if (label.kind === "local") return label.name;
  if (label.kind === "remote" && label.remotes.includes(remote)) return label.name.slice(remote.length + 1);
  return null;
}

/** Pull request items targeting the branches labelled in the graph. */
function labelPullRequestItems(labels: RefLabel[]): MenuEntry[] {
  const host = pullRequestHost();
  if (!host) return [];
  return pullRequestItems(labels.map((l) => branchOn(host.remoteName, l)).filter((b): b is string => b !== null));
}

// --- menus -------------------------------------------------------------------

/** A menu group introduced by a separator; an empty group disappears. */
const group = (items: MenuEntry[]): MenuEntry[] => (items.length ? ["sep", ...items] : []);

export function localBranchMenu(b: LocalBranch): MenuEntry[] {
  const cur = head();
  const s = S();
  const repo = active();
  const remotes = repo ? s.repos[repo]?.refs?.remotes ?? [] : [];
  return [
    { label: `Checkout ${b.name}`, action: () => checkout(b.name), disabled: b.isHead },
    "sep",
    { label: `Merge ${b.name} into ${cur ?? "HEAD"}`, action: () => merge(b.name), disabled: b.isHead },
    { label: `Rebase ${cur ?? "HEAD"} onto ${b.name}`, action: () => rebase(b.name), disabled: b.isHead },
    ...group(pullRequestItems([b.name])),
    "sep",
    ...remotes.map((rm) => ({
      label: `Push to ${rm.name}/${b.name}`,
      action: () => S().run("Push", (rp) => api.pushBranch(rp, rm.name, b.name), { success: () => ({ title: t("push.title"), description: `${b.name} → ${rm.name}/${b.name}` }) }),
    })),
    ...(pullRequestHost() ? [{ label: "Create pull request…", action: () => openPullRequest(b.name) }] : []),
    "sep",
    { label: "Create branch here", action: () => newBranch(b.oid) },
    { label: "Rename…", action: () => renameBranch(b.name) },
    { label: "Copy branch name", action: () => navigator.clipboard.writeText(b.name) },
    { label: "Delete…", action: () => deleteBranch(b), danger: true, disabled: b.isHead },
  ];
}

export function remoteBranchMenu(b: RemoteBranch): MenuEntry[] {
  const cur = head();
  return [
    { label: `Checkout ${b.name}`, action: () => checkout(b.name, true) },
    "sep",
    { label: `Merge ${b.name} into ${cur ?? "HEAD"}`, action: () => merge(b.name) },
    { label: `Rebase ${cur ?? "HEAD"} onto ${b.name}`, action: () => rebase(b.name) },
    ...(cur
      ? [{ label: `Set as upstream of ${cur}`, action: () => S().run("Set upstream", (rp) => api.setUpstream(rp, cur, b.name), { success: () => ({ title: t("branch.upstream"), description: `${cur} → ${b.name}` }) }) }]
      : []),
    "sep",
    {
      label: `Delete ${b.name} on remote…`,
      danger: true,
      action: async () => {
        if (await confirm("Delete remote branch", `Delete ${b.branch} from ${b.remote}?`, "Delete", true))
          await S().run("Delete remote branch", (rp) => api.deleteRemoteBranch(rp, b.remote, b.branch), { success: () => ({ title: t("remoteBranch.deleted"), description: b.name }) });
      },
    },
  ];
}

export function commitMenu(row: GraphRow): MenuEntry[] {
  const cur = head() ?? "HEAD";
  return [
    { label: "Checkout this commit (detached)", action: () => checkout(row.oid) },
    { label: "Create branch here…", action: () => newBranch(row.oid) },
    { label: "Create tag here…", action: () => newTag(row.oid) },
    ...group(labelPullRequestItems(row.refs)),
    "sep",
    { label: "Cherry-pick commit", action: () => cherryPick(row.oid), disabled: row.isHead },
    { label: "Revert commit", action: () => revert(row.oid) },
    {
      label: `Interactive rebase ${cur} from here…`,
      action: () => S().set({ modal: { kind: "rebase", base: row.oid } }),
      disabled: row.isHead,
    },
    "sep",
    { label: `Reset ${cur} here — soft`, action: () => resetTo(row.oid, "soft") },
    { label: `Reset ${cur} here — mixed`, action: () => resetTo(row.oid, "mixed") },
    { label: `Reset ${cur} here — hard`, action: () => resetTo(row.oid, "hard"), danger: true },
    "sep",
    { label: "Copy commit SHA", action: () => navigator.clipboard.writeText(row.oid) },
  ];
}

/**
 * Menu for a branch label in the graph. A grouped label is one branch in
 * several places: it offers the local branch menu, then the remote-only
 * actions for each remote copy.
 */
export function refLabelMenu(label: RefLabel): MenuEntry[] {
  const repo = active();
  const refs = repo ? S().repos[repo]?.refs : null;
  const local = label.kind === "local" ? refs?.locals.find((b) => b.name === label.name) : undefined;
  const remoteNames = label.kind === "local" ? label.remotes.map((name) => `${name}/${label.name}`) : [label.name];
  const remotes = remoteNames.flatMap((n) => refs?.remoteBranches.filter((b) => b.name === n) ?? []);
  const items: MenuEntry[] = local ? localBranchMenu(local) : labelPullRequestItems([label]);
  for (const rb of remotes) {
    const own = remoteBranchMenu(rb).filter((x) => x !== "sep" && (!local || !x.label.startsWith("Checkout")));
    items.push("sep", { label: rb.name, disabled: true, icon: createElement(Cloud, { size: 12 }) }, ...own);
  }
  return items;
}

export function dropBranchMenu(src: string, row: GraphRow): MenuEntry[] {
  const target = row.refs.find((x) => x.kind === "local")?.name;
  const cur = head();
  const items: MenuEntry[] = [];
  if (target && target === cur) {
    items.push({ label: `Merge ${src} into ${target}`, action: () => merge(src) });
    items.push({ label: `Rebase ${target} onto ${src}`, action: () => rebase(src) });
  } else if (target && src === cur) {
    items.push({ label: `Merge ${target} into ${src}`, action: () => merge(target) });
    items.push({ label: `Rebase ${src} onto ${target}`, action: () => rebase(target) });
  } else {
    items.push({ label: `Merge ${src} into ${cur ?? "HEAD"}`, action: () => merge(src) });
  }
  items.push("sep", { label: `Reset ${cur ?? "HEAD"} to ${shortSha(row.oid)}…`, action: () => resetTo(row.oid, "mixed") });
  return items;
}

export const openExternal = (url: string) => openUrl(url).catch((e) => S().toast(String(e), "error"));
