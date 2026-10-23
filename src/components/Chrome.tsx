import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Archive, ArchiveRestore, Bell, ChevronDown, ChevronRight, Command, FolderGit2,
  GitBranch, GitFork, Keyboard, ListTree, Minus, PanelLeftOpen, PanelRightOpen, Plus, Redo2, ScrollText, Search, Settings, Terminal,
  Trash2, Undo2, X, ZoomIn,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { api, ext, LogEntry } from "../api";
import * as A from "../actions";
import { t } from "../i18n";
import { MenuEntry, NEW_TAB, useG, useR, useRepo, useStore } from "../store";
import Logo from "./Logo";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const view = useStore((s) => s.view);
  const { setActive, closeTab, newTab, openPrefs, set, openMenu } = useStore.getState();
  return (
    <div className="tabbar">
      <div className="brand">
        <Logo size={20} />
        Corvus
      </div>
      <div className="tabs-scroll">
        {tabs.map((t) => (
          <div
            key={t}
            className={`tab${t === active && view === "repo" ? " active" : ""}`}
            onClick={() => setActive(t)}
            title={t === NEW_TAB ? "New tab" : t}
            onAuxClick={(e) => e.button === 1 && closeTab(t)}
          >
            {t === NEW_TAB ? <Plus size={13} /> : <FolderGit2 size={13} />}
            <span>{t === NEW_TAB ? "New Tab" : t.split("/").pop()}</span>
            <button className="icon tab-x" onClick={(e) => (e.stopPropagation(), closeTab(t))}>
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="icon" title="New tab (Ctrl+T)" onClick={newTab} style={{ alignSelf: "center" }}>
          <Plus size={15} />
        </button>
      </div>
      <div className="tabbar-right">
        {tabs.length > 4 && (
          <button
            className="icon"
            title="All tabs"
            onClick={(e) => openMenu(e, tabs.map((t) => ({ label: t === NEW_TAB ? "New Tab" : t, action: () => setActive(t) })))}
          >
            <ChevronDown size={15} />
          </button>
        )}
        <button className="icon" title="Activity log" onClick={() => set({ logOpen: !useStore.getState().logOpen })}>
          <Bell size={15} />
        </button>
        <button className={`icon${view === "prefs" ? " on" : ""}`} title="Preferences (Ctrl+,)" onClick={() => (view === "prefs" ? set({ view: "repo" }) : openPrefs())}>
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}

function Tool({ icon, label, onClick, title, disabled, badge }: { icon: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void; title?: string; disabled?: boolean; badge?: number }) {
  return (
    <button className="tool" onClick={onClick} title={title ?? label} disabled={disabled}>
      <span className="tool-wrap">
        {icon}
        {!!badge && <span className="badge-n">{badge}</span>}
      </span>
      <span className="tool-label">{label}</span>
    </button>
  );
}

function ConflictChip() {
  const { repo, data } = useRepo();
  const enabledGlobal = useG("conflictDetection");
  const enabledRepo = useR("conflictDetection");
  const patterns = useR("baseBranches");
  const check = useStore((s) => (repo ? s.conflicts[repo] : undefined));
  const head = data?.info?.headOid;
  const status = data?.status;
  const { set, openMenu } = useStore.getState();
  useEffect(() => {
    if (!repo || !enabledGlobal || !enabledRepo || !head) return;
    let live = true;
    const t = setTimeout(() => {
      ext
        .conflictCheck(repo, patterns.split("\n").map((p) => p.trim()).filter(Boolean), null)
        .then((c) => live && set({ conflicts: { ...useStore.getState().conflicts, [repo]: c } }))
        .catch(() => {});
    }, 800);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [repo, head, status, enabledGlobal, enabledRepo, patterns, set]);
  if (!enabledGlobal || !enabledRepo || !check?.base || !check.files.length) return null;
  return (
    <button
      className="chip warn"
      style={{ cursor: "pointer" }}
      title="Predicted merge conflicts"
      onClick={(e) =>
        openMenu(e, [
          { label: `Conflicts with ${check.base}:`, disabled: true },
          ...check.files.map((f) => ({ label: f, action: () => useStore.getState().setCenter({ kind: "diff", file: f, mode: "unstaged" as const }) })),
        ])
      }
    >
      <AlertTriangle size={12} /> {check.files.length} potential conflict{check.files.length === 1 ? "" : "s"}
    </button>
  );
}

export function Toolbar() {
  const { repo, data } = useRepo();
  const busy = useStore((s) => s.busy);
  const pullMode = useG("pullMode");
  const redoCount = useStore((s) => (repo ? s.redo[repo]?.length ?? 0 : 0));
  const search = useStore((s) => s.search);
  const tabs = useStore((s) => s.tabs);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const { set, setG, openMenu, setActive } = useStore.getState();
  const head = data?.info?.headBranch;
  const local = data?.refs?.locals.find((b) => b.isHead);
  const dirty = (data?.status?.files.length ?? 0) > 0;
  const stashes = data?.refs?.stashes.length ?? 0;

  const repoMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      ...tabs.filter((t) => t !== NEW_TAB).map((t) => ({ label: `${t === repo ? "● " : ""}${t.split("/").pop()}`, action: () => setActive(t) })),
      "sep",
      { label: "Open repository…", action: A.openRepoDialog },
      { label: "Clone repository…", action: () => set({ modal: "clone" }) },
      { label: "Open in external editor", action: () => A.openInEditor() },
      { label: "Open external terminal", action: A.openExternalTerminal },
    ]);

  const branchMenu = async (e: React.MouseEvent) => {
    const items: MenuEntry[] = (data?.refs?.locals ?? []).map((b) => ({ label: `${b.isHead ? "✓ " : "   "}${b.name}`, action: () => !b.isHead && A.checkout(b.name), disabled: b.isHead }));
    openMenu(e, [...items.slice(0, 30), "sep", { label: "New branch…", action: () => A.newBranch() }, { label: "Search branches…", action: () => document.getElementById("refs-filter")?.focus() }]);
  };

  return (
    <div className="toolbar">
      <div className="crumbs">
        <button className="crumb" onClick={repoMenu}>
          <span className="cap">repository</span>
          <span className="val">
            <span>{data?.info?.name}</span>
            <ChevronDown size={12} />
          </span>
        </button>
        <ChevronRight size={14} className="muted" />
        <button className="crumb" onClick={branchMenu}>
          <span className="cap">branch</span>
          <span className="val">
            <GitBranch size={13} />
            <span>{head ?? (data?.info?.headOid ? `detached @ ${data.info.headOid.slice(0, 7)}` : "—")}</span>
            <ChevronDown size={12} />
          </span>
        </button>
        <ConflictChip />
      </div>
      <div className="tools">
        <Tool icon={<Undo2 size={17} />} label="Undo" onClick={A.undo} disabled={!!busy} title="Undo (Ctrl+Z)" />
        <Tool icon={<Redo2 size={17} />} label="Redo" onClick={A.redo} disabled={!!busy || !redoCount} title="Redo (Ctrl+Y)" />
        <div className="tool-sep" />
        <Tool icon={<ArrowDownToLine size={17} />} label="Pull" badge={local?.behind} onClick={A.pull} disabled={!!busy} title={`Pull (${pullMode})`} />
        <button
          className="tool caret-btn"
          title="Pull options"
          onClick={(e) =>
            openMenu(e, [
              { label: "Fetch all", action: () => A.fetchAll() },
              "sep",
              { label: `${pullMode === "ff-only" ? "● " : "   "}Pull (fast-forward if possible)`, action: () => setG("pullMode", "ff-only") },
              { label: `${pullMode === "merge" ? "● " : "   "}Pull (merge)`, action: () => setG("pullMode", "merge") },
              { label: `${pullMode === "rebase" ? "● " : "   "}Pull (rebase)`, action: () => setG("pullMode", "rebase") },
            ])
          }
        >
          <ChevronDown size={12} />
        </button>
        <Tool icon={<ArrowUpFromLine size={17} />} label="Push" badge={local?.ahead} onClick={() => A.push(false)} disabled={!!busy} />
        <button
          className="tool caret-btn"
          title="Push options"
          onClick={(e) =>
            openMenu(e, [
              {
                label: "Force push (with lease)…",
                danger: true,
                action: async () => {
                  if (await useStore.getState().ask({ title: "Force push", message: `Overwrite the remote ${head ?? ""} with your local history?`, confirmLabel: "Force push", danger: true }))
                    await A.push(true);
                },
              },
              ...(head ? [{ label: "Create pull request…", action: () => set({ modal: { kind: "pr" as const, branch: head } }) }] : []),
            ])
          }
        >
          <ChevronDown size={12} />
        </button>
        <div className="tool-sep" />
        <Tool icon={<GitFork size={17} />} label="Branch" onClick={() => A.newBranch()} disabled={!!busy} />
        <Tool icon={<Archive size={17} />} label="Stash" onClick={A.stash} disabled={!!busy || !dirty} />
        <Tool icon={<ArchiveRestore size={17} />} label="Pop" onClick={A.pop} disabled={!!busy || !stashes} />
        <div className="tool-sep" />
        <Tool icon={<Terminal size={17} />} label="Terminal" onClick={() => set({ terminalOpen: !terminalOpen })} title="Terminal (Ctrl+`)" />
      </div>
      <div className="toolbar-right">
        <div className="search-box">
          <Search size={13} />
          <input
            id="graph-search"
            placeholder="Search commits (Ctrl+F)"
            value={search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && set({ search: "" })}
          />
        </div>
        <Tool icon={<Command size={17} />} label="Actions" onClick={() => set({ modal: "palette" })} title="Command palette (Ctrl+P)" />
      </div>
    </div>
  );
}

export function Banner() {
  const { data } = useRepo();
  const { run } = useStore.getState();
  const state = data?.info?.state;
  if (!state || state === "clean") return null;
  const conflicts = data?.status?.files.filter((f) => f.conflicted).length ?? 0;
  const label = { merge: "Merging", rebase: "Rebasing", "cherry-pick": "Cherry-picking", revert: "Reverting", bisect: "Bisecting" }[state] ?? state;
  const canContinue = ["merge", "rebase", "cherry-pick", "revert"].includes(state);
  return (
    <div className="banner">
      <AlertTriangle size={16} />
      <strong>{label} in progress.</strong>
      <span>{conflicts ? `${conflicts} conflicted file${conflicts === 1 ? "" : "s"} — resolve them in the panel on the right, then continue.` : "All conflicts resolved."}</span>
      <span className="spacer" />
      {canContinue && (
        <>
          <button className="small danger-outline" onClick={() => run("Abort", (r) => api.abortOp(r), { success: () => ({ kind: "info", title: t("abort.title"), description: label }) })}>Abort</button>
          <button className="small primary" disabled={conflicts > 0} onClick={() => run("Continue", (r) => api.continueOp(r), { success: () => ({ title: t("continue.title"), description: label }) })}>Continue</button>
        </>
      )}
    </div>
  );
}

export function StatusBar({ leftCollapsed, rightCollapsed }: { leftCollapsed: boolean; rightCollapsed: boolean }) {
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const zoom = useG("zoom");
  const { data } = useRepo();
  const { set, setG } = useStore.getState();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);
  const z = (d: number) => setG("zoom", Math.round(Math.min(2, Math.max(0.6, zoom + d)) * 10) / 10);
  return (
    <div className="statusbar">
      {leftCollapsed && (
        <button className="icon" title="Show left panel (Ctrl+J)" onClick={() => setG("leftCollapsed", false)}>
          <PanelLeftOpen size={13} />
        </button>
      )}
      {busy ? (
        <span>
          <span className="spinner" /> {busy}… <span className="muted">{progress}</span>
        </span>
      ) : (
        <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{data?.info?.path}</span>
      )}
      <span className="spacer" />
      <span className="muted">{data?.graph ? `${data.graph.rows.length}${data.graph.hasMore ? "+" : ""} commits` : ""}</span>
      <button className="icon" title="Activity log" onClick={() => set({ logOpen: !useStore.getState().logOpen })}>
        <ScrollText size={13} />
      </button>
      <button className="icon" title="Keyboard shortcuts" onClick={() => set({ modal: "shortcuts" })}>
        <Keyboard size={13} />
      </button>
      <span className="zoom">
        <button className="icon" onClick={() => z(-0.1)} title="Zoom out (Ctrl+-)"><Minus size={11} /></button>
        <button className="icon" onClick={() => setG("zoom", 1)} title="Reset zoom (Ctrl+0)"><ZoomIn size={12} /> {Math.round(zoom * 100)}%</button>
        <button className="icon" onClick={() => z(0.1)} title="Zoom in (Ctrl+=)"><Plus size={11} /></button>
      </span>
      {rightCollapsed && (
        <button className="icon" title="Show right panel (Ctrl+K)" onClick={() => setG("rightCollapsed", false)}>
          <PanelRightOpen size={13} />
        </button>
      )}
      <span className="muted">v{version}</span>
    </div>
  );
}

export function ActivityLog() {
  const open = useStore((s) => s.logOpen);
  const { set } = useStore.getState();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [failedOnly, setFailedOnly] = useState(false);
  useEffect(() => {
    if (!open) return;
    const load = () => ext.activityLog().then(setLog, () => {});
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [open]);
  if (!open) return null;
  const items = [...log].reverse().filter((l) => !failedOnly || !l.ok);
  return (
    <div className="activity">
      <div className="diff-head">
        <ListTree size={15} />
        <span className="diff-title">Activity log</span>
        <span className="muted small">{log.length} git commands</span>
        <span className="spacer" />
        <label className="check small">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failures only
        </label>
        <button className="icon" title="Clear" onClick={() => ext.clearActivityLog().then(() => setLog([]))}>
          <Trash2 size={14} />
        </button>
        <button className="icon" onClick={() => set({ logOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="list">
        {items.map((l) => (
          <div key={l.id} className="list-row">
            <span className={l.ok ? "chip ok" : "chip"} style={l.ok ? undefined : { color: "var(--danger)" }}>{l.ok ? "ok" : "fail"}</span>
            <div className="grow">
              <div className="mono">git {l.args}</div>
              {l.output && <pre>{l.output}</pre>}
            </div>
            <span className="muted small">{l.ms} ms</span>
            <span className="muted small">{new Date(l.time * 1000).toLocaleTimeString()}</span>
          </div>
        ))}
        {!items.length && <div className="empty">No commands yet</div>}
      </div>
    </div>
  );
}
