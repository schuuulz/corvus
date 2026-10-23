import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { api, ext } from "./api";
import * as A from "./actions";
import { useBrowserChromeGuard } from "./browserChrome";
import { useNarrow, useRepoIntegrationSync } from "./hooks";
import { g, NEW_TAB, useG, useRepo, useStore } from "./store";
import CommitGraph from "./components/CommitGraph";
import RefsPanel from "./components/RefsPanel";
import CommitDetail from "./components/CommitDetail";
import StagingPanel from "./components/StagingPanel";
import DiffView from "./components/DiffView";
import MergeEditor from "./components/MergeEditor";
import InteractiveRebase from "./components/InteractiveRebase";
import TerminalDock from "./components/Terminal";
import NewTab from "./components/NewTab";
import GitflowPanel from "./components/GitflowPanel";
import { Blame, FileHistory } from "./components/FileViews";
import { ActivityLog, Banner, StatusBar, TabBar, Toolbar } from "./components/Chrome";
import { CloneDialog, CommandPalette, Shortcuts } from "./components/Modals";
import CreatePullRequest from "./components/CreatePullRequest";
import { ContextMenu, Dialog, Toasts } from "./components/Overlays";
import { Splitter } from "./components/ui";
import PreferencesView from "./prefs/PreferencesView";
import "./App.css";

function Center() {
  const center = useStore((s) => (s.active ? s.center[s.active] : undefined));
  switch (center?.kind) {
    case "diff":
      return <DiffView file={center.file} oldFile={center.oldFile} mode={center.mode} oid={center.oid} />;
    case "merge":
      return <MergeEditor key={center.file} file={center.file} />;
    case "history":
      return <FileHistory file={center.file} />;
    case "blame":
      return <Blame file={center.file} />;
    default:
      return <CommitGraph />;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Workspace() {
  const { repo } = useRepo();
  const selection = useStore((s) => (s.active ? s.selection[s.active] : undefined));
  const drawer = useStore((s) => s.drawer);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const leftW = useG("leftWidth");
  const rightW = useG("rightWidth");
  const leftCollapsed = useG("leftCollapsed");
  const rightCollapsed = useG("rightCollapsed");
  const termH = useG("terminalHeight");
  const { setG, set } = useStore.getState();
  const narrowRight = useNarrow(1280);
  const narrowLeft = useNarrow(960);

  const leftAsDrawer = narrowLeft;
  const rightAsDrawer = narrowRight;
  const right = (onCollapse?: () => void) =>
    selection?.kind === "commit" ? <CommitDetail oid={selection.oid} onCollapse={onCollapse} /> : <StagingPanel onCollapse={onCollapse} />;

  return (
    <>
      <Toolbar />
      <Banner />
      <div className="workspace" key={repo}>
        {/* left panel */}
        {leftAsDrawer ? (
          <div className="collapsed-rail">
            <button className="icon" title="Branches" onClick={() => set({ drawer: drawer === "left" ? null : "left" })}>
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : leftCollapsed ? (
          <div className="collapsed-rail">
            <button className="icon" title="Show left panel (Ctrl+J)" onClick={() => setG("leftCollapsed", false)}>
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
          <>
            <div style={{ width: leftW, display: "flex", flex: "none" }}>
              <RefsPanel onCollapse={() => setG("leftCollapsed", true)} />
            </div>
            <Splitter onDrag={(d) => setG("leftWidth", clamp(g("leftWidth") + d, 180, 520))} onDoubleClick={() => setG("leftWidth", 260)} />
          </>
        )}

        <div className="main-col">
          <main className="center">
            <Center />
          </main>
          <GitflowPanel />
          {terminalOpen && repo && (
            <>
              <Splitter horizontal onDrag={(d) => setG("terminalHeight", clamp(g("terminalHeight") - d, 120, window.innerHeight - 200))} />
              <div className="term-dock" style={{ height: termH }}>
                <TerminalDock cwd={repo} />
              </div>
            </>
          )}
        </div>

        {/* right panel */}
        {rightAsDrawer ? (
          <div className="collapsed-rail right-rail">
            <button className="icon" title="Details" onClick={() => set({ drawer: drawer === "right" ? null : "right" })}>
              <PanelRightOpen size={16} />
            </button>
          </div>
        ) : rightCollapsed ? (
          <div className="collapsed-rail right-rail">
            <button className="icon" title="Show right panel (Ctrl+K)" onClick={() => setG("rightCollapsed", false)}>
              <PanelRightOpen size={16} />
            </button>
          </div>
        ) : (
          <>
            <Splitter onDrag={(d) => setG("rightWidth", clamp(g("rightWidth") - d, 300, 640))} onDoubleClick={() => setG("rightWidth", 380)} />
            <div style={{ width: rightW, display: "flex", flex: "none" }}>{right(() => setG("rightCollapsed", true))}</div>
          </>
        )}

        {drawer && ((drawer === "left" && leftAsDrawer) || (drawer === "right" && rightAsDrawer)) && (
          <>
            <div className="drawer-back" onClick={() => set({ drawer: null })} />
            <div className={`drawer ${drawer}`} style={{ width: drawer === "left" ? Math.min(320, window.innerWidth - 60) : Math.min(400, window.innerWidth - 60), display: "flex" }}>
              {drawer === "left" ? <RefsPanel /> : right()}
            </div>
          </>
        )}
        <ActivityLog />
      </div>
      <StatusBar leftCollapsed={leftCollapsed && !leftAsDrawer} rightCollapsed={rightCollapsed && !rightAsDrawer} />
    </>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const inEditor = e.target instanceof HTMLElement && !!e.target.closest(".monaco-editor, .xterm");
      const k = e.key.toLowerCase();
      const hasRepo = !!s.active && s.active !== NEW_TAB;
      const zoom = (z: number) => s.setG("zoom", Math.round(Math.min(2, Math.max(0.6, z)) * 10) / 10);
      if (e.ctrlKey && (k === "=" || k === "+")) return e.preventDefault(), zoom(g("zoom") + 0.1);
      if (e.ctrlKey && k === "-") return e.preventDefault(), zoom(g("zoom") - 0.1);
      if (e.ctrlKey && k === "0") return e.preventDefault(), zoom(1);
      if (e.ctrlKey && k === "`") return e.preventDefault(), hasRepo && s.set({ terminalOpen: !s.terminalOpen });
      if (inEditor) return;
      if (e.ctrlKey && k === "p") {
        e.preventDefault();
        s.set({ modal: "palette" });
      } else if (e.ctrlKey && k === "o") {
        e.preventDefault();
        void A.openRepoDialog();
      } else if (e.ctrlKey && k === "t") {
        e.preventDefault();
        s.newTab();
      } else if (e.ctrlKey && k === "w") {
        e.preventDefault();
        if (s.active) s.closeTab(s.active);
      } else if (e.ctrlKey && k === ",") {
        e.preventDefault();
        s.view === "prefs" ? s.set({ view: "repo" }) : s.openPrefs();
      } else if (e.key === "Escape" && !s.modal && !s.dialog) {
        s.set({ menu: null, drawer: null, logOpen: false });
        if (s.view === "prefs") s.set({ view: "repo" });
        else if (s.active && s.center[s.active] && s.center[s.active].kind !== "graph") s.setCenter({ kind: "graph" });
      } else if (!hasRepo || s.modal || s.dialog || s.view === "prefs") {
        return;
      } else if (e.ctrlKey && e.altKey && k === "f") {
        e.preventDefault();
        document.getElementById("refs-filter")?.focus();
      } else if (e.ctrlKey && k === "f") {
        e.preventDefault();
        document.getElementById("graph-search")?.focus();
      } else if (e.ctrlKey && k === "j") {
        e.preventDefault();
        s.setG("leftCollapsed", !g("leftCollapsed"));
      } else if (e.ctrlKey && k === "k") {
        e.preventDefault();
        s.setG("rightCollapsed", !g("rightCollapsed"));
      } else if (e.key === "F5") {
        e.preventDefault();
        void s.refresh();
      } else if (typing) {
        return;
      } else if (e.ctrlKey && k === "z") {
        e.preventDefault();
        void A.undo();
      } else if (e.ctrlKey && k === "y") {
        e.preventDefault();
        void A.redo();
      } else if (e.ctrlKey && k === "b") {
        e.preventDefault();
        void A.newBranch();
      } else if (e.ctrlKey && e.shiftKey && k === "s") {
        e.preventDefault();
        void s.run("Staging all", (r) => api.stageAll(r));
      } else if (e.ctrlKey && e.shiftKey && k === "u") {
        e.preventDefault();
        void s.run("Unstaging all", (r) => api.unstageAll(r));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Pushes settings that the backend needs (git path, SSH key, tokens). */
function useBackendConfig() {
  const gitPath = useG("gitPath");
  const sshUseAgent = useG("sshUseAgent");
  const sshKey = useG("sshPrivateKey");
  const extendedLog = useG("extendedLog");
  const integrations = useG("integrations");
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    void ext.configureCli({ gitPath, sshKey: sshUseAgent ? null : sshKey || null, extendedLog });
  }, [ready, gitPath, sshUseAgent, sshKey, extendedLog]);
  useEffect(() => {
    if (!ready) return;
    void ext.configureTokens(integrations.map((i) => ({ kind: i.kind, host: i.host })));
  }, [ready, integrations]);
}

/** Re-lays out the graph when the column (trunk) preferences change. */
function useGraphPrefs() {
  const pin = useG("pinTrunk");
  const trunks = useG("trunkBranches").join("\n");
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const s = useStore.getState();
    for (const repo of Object.keys(s.repos)) void s.refresh(repo);
  }, [pin, trunks]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useAutoFetch() {
  const minutes = useG("autoFetchMinutes");
  const active = useStore((s) => s.active);
  useEffect(() => {
    if (!minutes || !active || active === NEW_TAB) return;
    const t = setInterval(() => {
      if (!useStore.getState().busy) void A.fetchAll(true);
    }, minutes * 60_000);
    return () => clearInterval(t);
  }, [minutes, active]);
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const active = useStore((s) => s.active);
  const view = useStore((s) => s.view);
  const theme = useG("theme");
  const zoom = useG("zoom");
  const labels = useG("toolbarLabels");
  const modal = useStore((s) => s.modal);
  useShortcuts();
  useBrowserChromeGuard();
  useBackendConfig();
  useAutoFetch();
  useGraphPrefs();
  useRepoIntegrationSync();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    getCurrentWebview().setZoom(zoom).catch(() => {});
  }, [zoom]);

  useEffect(() => {
    void useStore.getState().init();
    const subs = [
      listen<string>("repo-changed", (e) => {
        const s = useStore.getState();
        if (s.repos[e.payload] && !s.busy) void s.refresh(e.payload);
      }),
      listen<{ repo: string; line: string }>("git-progress", (e) => {
        const s = useStore.getState();
        s.set({ progress: e.payload.line });
        // Live git progress ("Receiving objects: 42%") under the loading toast.
        if (s.loadingToast !== null) s.updateToast(s.loadingToast, { description: e.payload.line });
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  return (
    <div className={`app${labels ? "" : " no-labels"}`}>
      <TabBar />
      {!ready ? (
        <div className="newtab" />
      ) : view === "prefs" ? (
        <PreferencesView />
      ) : !active || active === NEW_TAB ? (
        <NewTab />
      ) : (
        <Workspace />
      )}
      {modal === "palette" && <CommandPalette />}
      {modal === "clone" && <CloneDialog />}
      {modal === "shortcuts" && <Shortcuts />}
      {modal && typeof modal === "object" && modal.kind === "rebase" && <InteractiveRebase base={modal.base} />}
      {modal && typeof modal === "object" && modal.kind === "pr" && <CreatePullRequest branch={modal.branch} base={modal.base} />}
      <Dialog />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
