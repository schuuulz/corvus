import { create } from "zustand";
import { api, ConflictCheck, DiffMode, ext, Gitflow, Graph, Integration, RemoteRef, RepoAccess, RepoInfo, Refs, SettingsData, WorkStatus } from "./api";
import { GLOBAL_DEFAULTS, GlobalKey, GlobalSettings, REPO_DEFAULTS, RepoKey, RepoSettings } from "./settings";
import { t } from "./i18n";

export interface RepoData {
  info: RepoInfo | null;
  graph: Graph | null;
  refs: Refs | null;
  status: WorkStatus | null;
  limit: number;
}

export type Selection = { kind: "wip" } | { kind: "commit"; oid: string };

export type CenterView =
  | { kind: "graph" }
  | { kind: "diff"; file: string; oldFile?: string | null; mode: DiffMode; oid?: string }
  | { kind: "merge"; file: string }
  | { kind: "history"; file: string }
  | { kind: "blame"; file: string };

export interface MenuItem { label: string; action?: () => void; danger?: boolean; disabled?: boolean; icon?: import("react").ReactNode }
export type MenuEntry = MenuItem | "sep";

export interface Field { name: string; label: string; value?: string; type?: "text" | "textarea" | "checkbox" | "select"; options?: string[]; placeholder?: string }
export interface DialogReq {
  title: string;
  message?: string;
  fields?: Field[];
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: Record<string, string> | null) => void;
}

export type ToastKind = "loading" | "success" | "warning" | "error" | "info";
export interface Toast { id: number; kind: ToastKind; title: string; description?: string; leaving?: boolean; createdAt: number }
export interface Feedback { kind?: Exclude<ToastKind, "loading">; title: string; description?: string }

/** How `run` reports an operation. `success` may inspect the result. */
export interface RunOpts<T> {
  /** Loading title; defaults to the run label. */
  loading?: string;
  loadingDesc?: string;
  success?: (result: T) => Feedback | null;
  /** Skip the success toast (e.g. the caller shows its own). */
  quiet?: boolean;
  /** Maps a git error message to friendlier feedback (null: default). */
  error?: (message: string) => Feedback | null;
}

export const TOAST_DURATION: Record<ToastKind, number> = { loading: 0, success: 3500, info: 4000, warning: 7000, error: 10000 };
const MAX_TOASTS = 4;

type Modal =
  | null
  | "palette"
  | "clone"
  | "shortcuts"
  | { kind: "rebase"; base: string | null }
  | { kind: "pr"; branch: string; base?: string };

/** The hosted repository behind a local one, reached through a connected integration. */
export interface RepoIntegration {
  integration: Integration;
  remote: RemoteRef;
  /** The git remote that points at the hosted repository. */
  remoteName: string;
  /** null until the provider answers (or when it can't be reached). */
  access: RepoAccess | null;
}

/** Tab id of the "New Tab" page. */
export const NEW_TAB = "kc:new";

const emptyRepo = (limit: number): RepoData => ({ info: null, graph: null, refs: null, status: null, limit });

interface State {
  ready: boolean;
  settings: SettingsData;
  tabs: string[];
  active: string | null;
  view: "repo" | "prefs";
  prefsSection: string;
  repos: Record<string, RepoData>;
  selection: Record<string, Selection>;
  center: Record<string, CenterView>;
  redo: Record<string, string[]>;
  conflicts: Record<string, ConflictCheck>;
  busy: string | null;
  progress: string;
  toasts: Toast[];
  menu: { x: number; y: number; items: MenuEntry[] } | null;
  dialog: DialogReq | null;
  modal: Modal;
  search: string;
  terminalOpen: boolean;
  logOpen: boolean;
  drawer: null | "left" | "right";
  hoverBranch: string | null;
  /** Gitflow config per repo (null while loading). */
  gitflow: Record<string, Gitflow | null>;
  /** Open Gitflow panel, started from a main branch in the left panel. */
  gitflowPanel: { base: string } | null;
  loadGitflow(repo?: string): Promise<Gitflow | null>;
  /** Hosted repository per local repo (null: no connected integration serves it). */
  repoIntegration: Record<string, RepoIntegration | null>;
  /** Bumped when a pull request is opened, so open PR lists reload. */
  pullRequestsVersion: number;

  init(): Promise<void>;
  setG<K extends GlobalKey>(key: K, value: GlobalSettings[K]): Promise<void>;
  setR<K extends RepoKey>(key: K, value: RepoSettings[K], repo?: string): Promise<void>;
  openRepo(path: string): Promise<void>;
  newTab(): void;
  closeTab(path: string): void;
  setActive(path: string): void;
  refresh(path?: string): Promise<void>;
  loadMore(): Promise<void>;
  select(sel: Selection): void;
  setCenter(v: CenterView): void;
  run<T>(label: string, fn: (repo: string) => Promise<T>, opts?: RunOpts<T>): Promise<T | undefined>;
  toast(text: string, kind?: "error" | "info" | "success" | "warning"): void;
  notify(t: { kind: ToastKind; title: string; description?: string }): number;
  updateToast(id: number, patch: Partial<Omit<Toast, "id">>): void;
  dismissToast(id: number): void;
  loadingToast: number | null;
  openMenu(e: { clientX: number; clientY: number }, items: MenuEntry[]): void;
  ask(req: Omit<DialogReq, "resolve">): Promise<Record<string, string> | null>;
  openPrefs(section?: string): void;
  set(p: Partial<State>): void;
}

let toastId = 0;

/** The useful part of a git error: drops the "git <cmd> failed" header. */
export function gitMessage(e: unknown): string {
  const text = String(e).replace(/^Error:\s*/, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const body = lines[0]?.startsWith("git ") && lines[0].endsWith("failed") ? lines.slice(1) : lines;
  return body.join("\n") || text;
}

/** Reads a global setting outside React. */
export function g<K extends GlobalKey>(key: K): GlobalSettings[K] {
  const v = useStore.getState().settings.global[key];
  return (v === undefined ? GLOBAL_DEFAULTS[key] : v) as GlobalSettings[K];
}

/** Reads a repo setting outside React (active repo by default). */
export function r<K extends RepoKey>(key: K, repo?: string | null): RepoSettings[K] {
  const s = useStore.getState();
  const path = repo ?? s.active;
  const v = path ? s.settings.repos[path]?.[key] : undefined;
  return (v === undefined ? REPO_DEFAULTS[key] : v) as RepoSettings[K];
}

export function useG<K extends GlobalKey>(key: K): GlobalSettings[K] {
  return useStore((s) => {
    const v = s.settings.global[key];
    return (v === undefined ? GLOBAL_DEFAULTS[key] : v) as GlobalSettings[K];
  });
}

export function useR<K extends RepoKey>(key: K, repo?: string | null): RepoSettings[K] {
  return useStore((s) => {
    const path = repo ?? s.active;
    const v = path ? s.settings.repos[path]?.[key] : undefined;
    return (v === undefined ? REPO_DEFAULTS[key] : v) as RepoSettings[K];
  });
}

const graphLimit = () => (g("showAllCommits") ? 1_000_000 : Math.max(500, g("initialCommits")));
/** Branches pinned to fixed graph columns (Preferences › UI › Graph). */
const trunks = () => (g("pinTrunk") ? g("trunkBranches") : []);

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: { global: {}, repos: {} },
  tabs: [],
  active: null,
  view: "repo",
  prefsSection: "general",
  repos: {},
  selection: {},
  center: {},
  redo: {},
  conflicts: {},
  busy: null,
  progress: "",
  toasts: [],
  loadingToast: null,
  menu: null,
  dialog: null,
  modal: null,
  search: "",
  terminalOpen: false,
  logOpen: false,
  drawer: null,
  hoverBranch: null,
  gitflow: {},
  gitflowPanel: null,
  repoIntegration: {},
  pullRequestsVersion: 0,

  async loadGitflow(path) {
    const repo = path ?? get().active;
    if (!repo || repo === NEW_TAB) return null;
    try {
      const gf = await ext.gitflow(repo);
      set((s) => ({ gitflow: { ...s.gitflow, [repo]: gf } }));
      return gf;
    } catch {
      return null;
    }
  },

  async init() {
    try {
      const settings = await ext.settings();
      set({ settings });
    } catch (e) {
      get().toast(`Could not load settings: ${e}`, "error");
    }
    set({ ready: true });
    const tabs = g("rememberTabs") ? g("tabs") : [];
    if (!tabs.length) set({ tabs: [NEW_TAB], active: NEW_TAB });
    for (const t of tabs) await get().openRepo(t);
  },

  async setG(key, value) {
    set((s) => ({ settings: { ...s.settings, global: { ...s.settings.global, [key]: value } } }));
    try {
      await ext.setSetting(null, key, value);
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  async setR(key, value, repo) {
    const path = repo ?? get().active;
    if (!path || path === NEW_TAB) return;
    set((s) => ({
      settings: { ...s.settings, repos: { ...s.settings.repos, [path]: { ...s.settings.repos[path], [key]: value } } },
    }));
    try {
      await ext.setSetting(path, key, value);
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  async openRepo(input) {
    try {
      const info = await api.repoInfo(input);
      const path = info.path;
      const s = get();
      const recent = [path, ...g("recent").filter((x) => x !== path)].slice(0, 12);
      let tabs = s.tabs.includes(path) ? s.tabs : [...s.tabs];
      if (!tabs.includes(path)) {
        const i = s.active === NEW_TAB ? tabs.indexOf(NEW_TAB) : -1;
        if (i >= 0) tabs[i] = path;
        else tabs.push(path);
      }
      tabs = tabs.filter((t, i) => tabs.indexOf(t) === i);
      set({
        tabs,
        active: path,
        view: "repo",
        repos: { ...s.repos, [path]: s.repos[path] ?? { ...emptyRepo(graphLimit()), info } },
        selection: { ...s.selection, [path]: s.selection[path] ?? { kind: "wip" } },
        center: { ...s.center, [path]: s.center[path] ?? { kind: "graph" } },
      });
      void get().setG("recent", recent);
      void get().setG("tabs", tabs.filter((t) => t !== NEW_TAB));
      api.watch(path).catch(() => {});
      await get().refresh(path);
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  newTab() {
    const s = get();
    set({ tabs: s.tabs.includes(NEW_TAB) ? s.tabs : [...s.tabs, NEW_TAB], active: NEW_TAB, view: "repo" });
  },

  closeTab(path) {
    const s = get();
    const idx = s.tabs.indexOf(path);
    let tabs = s.tabs.filter((t) => t !== path);
    if (path !== NEW_TAB) api.unwatch(path).catch(() => {});
    const repos = { ...s.repos };
    delete repos[path];
    let active = s.active === path ? tabs[Math.max(0, idx - 1)] ?? null : s.active;
    if (!tabs.length) {
      tabs = [NEW_TAB];
      active = NEW_TAB;
    }
    set({ tabs, repos, active });
    void get().setG("tabs", tabs.filter((t) => t !== NEW_TAB));
  },

  setActive(path) {
    set({ active: path, view: "repo" });
  },

  async refresh(path) {
    const repo = path ?? get().active;
    if (!repo || repo === NEW_TAB) return;
    const cur = get().repos[repo] ?? emptyRepo(graphLimit());
    try {
      const [info, graph, refs, status] = await Promise.all([
        api.repoInfo(repo),
        api.graph(repo, cur.limit, trunks()),
        api.refs(repo),
        api.status(repo),
      ]);
      set((s) => ({ repos: { ...s.repos, [repo]: { ...cur, ...s.repos[repo], info, graph, refs, status } } }));
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  async loadMore() {
    const repo = get().active;
    if (!repo || !g("lazyLoad")) return;
    const cur = get().repos[repo];
    if (!cur?.graph?.hasMore) return;
    const limit = cur.limit + 2000;
    const graph = await api.graph(repo, limit, trunks());
    set((s) => ({ repos: { ...s.repos, [repo]: { ...s.repos[repo], limit, graph } } }));
  },

  select(sel) {
    const repo = get().active;
    if (!repo) return;
    set((s) => ({
      selection: { ...s.selection, [repo]: sel },
      center: { ...s.center, [repo]: { kind: "graph" } },
      drawer: window.innerWidth < 1280 ? "right" : s.drawer,
    }));
  },

  setCenter(v) {
    const repo = get().active;
    if (!repo) return;
    set((s) => ({ center: { ...s.center, [repo]: v }, drawer: null }));
  },

  async run(label, fn, opts) {
    const repo = get().active;
    if (!repo || repo === NEW_TAB) return undefined;
    set({ busy: label, progress: "" });
    const id = get().notify({ kind: "loading", title: opts?.loading ?? t("op.working", { label }), description: opts?.loadingDesc });
    set({ loadingToast: id });
    try {
      const result = await fn(repo);
      const fb = opts?.success ? opts.success(result) : opts?.quiet ? null : { title: t("op.done", { label }) };
      if (fb) get().updateToast(id, { kind: fb.kind ?? "success", title: fb.title, description: fb.description });
      else get().dismissToast(id);
      return result;
    } catch (e) {
      const message = gitMessage(e);
      const custom = opts?.error?.(message);
      get().updateToast(id, custom ? { kind: custom.kind ?? "error", title: custom.title, description: custom.description } : { kind: "error", title: t("op.failed", { label }), description: message });
      return undefined;
    } finally {
      set((s) => ({ busy: null, loadingToast: s.loadingToast === id ? null : s.loadingToast }));
      await get().refresh(repo);
    }
  },

  toast(text, kind = "info") {
    const [title, ...rest] = text.split("\n");
    get().notify({ kind, title, description: rest.join("\n") || undefined });
  },

  notify({ kind, title, description }) {
    const id = ++toastId;
    set((s) => {
      let toasts = [...s.toasts, { id, kind, title, description, createdAt: Date.now() }];
      // Keep at most MAX_TOASTS on screen; drop the oldest finished ones first.
      const visible = toasts.filter((x) => !x.leaving);
      if (visible.length > MAX_TOASTS) {
        const victim = visible.find((x) => x.kind !== "loading") ?? visible[0];
        toasts = toasts.map((x) => (x.id === victim.id ? { ...x, leaving: true } : x));
        setTimeout(() => set((s2) => ({ toasts: s2.toasts.filter((x) => x.id !== victim.id) })), 220);
      }
      return { toasts };
    });
    return id;
  },

  updateToast(id, patch) {
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, ...patch, createdAt: patch.kind ? Date.now() : x.createdAt } : x)) }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 220);
  },

  openMenu(e, items) {
    set({ menu: { x: e.clientX, y: e.clientY, items } });
  },

  ask(req) {
    return new Promise((resolve) => set({ dialog: { ...req, resolve } }));
  },

  openPrefs(section) {
    set((s) => ({ view: "prefs", prefsSection: section ?? s.prefsSection, menu: null, modal: null }));
  },

  set(p) {
    set(p);
  },
}));

/** Convenience selector for the active repo's data. */
export function useRepo() {
  const active = useStore((s) => (s.active === NEW_TAB ? null : s.active));
  const data = useStore((s) => (s.active && s.active !== NEW_TAB ? s.repos[s.active] : undefined));
  return { repo: active, data };
}

export const shortSha = (oid: string) => oid.slice(0, 7);
