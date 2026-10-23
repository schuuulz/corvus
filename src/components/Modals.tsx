import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as A from "../actions";
import { THEMES } from "../settings";
import { useRepo, useStore } from "../store";

export function CloneDialog() {
  const { set } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const [url, setUrl] = useState("");
  const [dir, setDir] = useState("");
  const name = url.replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "") ?? "";
  const dest = dir && name ? `${dir.replace(/[\\/]+$/, "")}/${name}` : "";
  const pick = async () => {
    const d = await open({ directory: true, title: "Clone into…" });
    if (typeof d === "string") setDir(d);
  };
  return (
    <div className="modal-back" onClick={() => !busy && set({ modal: null })}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await A.cloneRepo(url.trim(), dest)) set({ modal: null });
        }}
      >
        <h3>Clone a repository</h3>
        <label className="field">
          <span>URL</span>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" />
        </label>
        <label className="field">
          <span>Parent folder</span>
          <div className="row-inline">
            <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:/Users/me/code" />
            <button type="button" onClick={pick}>Browse…</button>
          </div>
        </label>
        {dest && <div className="muted small">Will clone into {dest}</div>}
        {busy && <div className="muted small"><span className="spinner" /> {progress}</div>}
        <div className="modal-actions">
          <button type="button" disabled={!!busy} onClick={() => set({ modal: null })}>Cancel</button>
          <button type="submit" className="primary" disabled={!url.trim() || !dest || !!busy}>Clone</button>
        </div>
      </form>
    </div>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["Command palette", "Ctrl+P"],
  ["Open repository", "Ctrl+O"],
  ["New tab", "Ctrl+T"],
  ["Close tab", "Ctrl+W"],
  ["Preferences", "Ctrl+,"],
  ["Search commits", "Ctrl+F"],
  ["Filter branches", "Ctrl+Alt+F"],
  ["Toggle terminal", "Ctrl+`"],
  ["Toggle left panel", "Ctrl+J"],
  ["Toggle right panel", "Ctrl+K"],
  ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
  ["Create branch", "Ctrl+B"],
  ["Stage all / Unstage all", "Ctrl+Shift+S / Ctrl+Shift+U"],
  ["Commit", "Ctrl+Enter"],
  ["Refresh", "F5"],
  ["Zoom in / out / reset", "Ctrl+= / Ctrl+- / Ctrl+0"],
  ["Close diff or dialog", "Esc"],
];

export function Shortcuts() {
  const { set } = useStore.getState();
  return (
    <div className="modal-back" onClick={() => set({ modal: null })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <div className="shortcuts">
          {SHORTCUTS.map(([a, k]) => (
            <div key={a} style={{ display: "contents" }}>
              <span>{a}</span>
              <span>{k.split(" / ").map((c, i) => <span key={c}>{i > 0 && " / "}{c.split("+").map((p, j) => <span key={j}>{j > 0 && "+"}<kbd>{p}</kbd></span>)}</span>)}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button onClick={() => set({ modal: null })}>Close</button></div>
      </div>
    </div>
  );
}

interface Cmd { label: string; hint?: string; run: () => void }

export function CommandPalette() {
  const { repo, data } = useRepo();
  const { set, setG, openPrefs, newTab } = useStore.getState();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const cmds = useMemo<Cmd[]>(() => {
    const c: Cmd[] = [
      { label: "Open repository…", hint: "Ctrl+O", run: A.openRepoDialog },
      { label: "Clone repository…", run: () => set({ modal: "clone" }) },
      { label: "Init repository…", run: A.initRepoDialog },
      { label: "New tab", hint: "Ctrl+T", run: newTab },
      { label: "Preferences", hint: "Ctrl+,", run: () => openPrefs() },
      { label: "Preferences: Integrations", run: () => openPrefs("integrations") },
      { label: "Preferences: SSH", run: () => openPrefs("ssh") },
      { label: "Keyboard shortcuts", run: () => set({ modal: "shortcuts" }) },
      { label: "Toggle activity log", run: () => set({ logOpen: !useStore.getState().logOpen }) },
      ...THEMES.map((t) => ({ label: `Theme: ${t.name}`, run: () => setG("theme", t.id) })),
    ];
    if (repo) {
      c.push(
        { label: "Fetch all", run: () => A.fetchAll() },
        { label: "Pull", run: A.pull },
        { label: "Push", run: () => A.push(false) },
        { label: "Undo", hint: "Ctrl+Z", run: A.undo },
        { label: "Redo", hint: "Ctrl+Y", run: A.redo },
        { label: "Create branch…", hint: "Ctrl+B", run: () => A.newBranch() },
        { label: "Stash changes…", run: A.stash },
        { label: "Pop stash", run: A.pop },
        { label: "Stage all changes", hint: "Ctrl+Shift+S", run: A.stageAll },
        { label: "Unstage all changes", hint: "Ctrl+Shift+U", run: A.unstageAll },
        { label: "Show working changes", run: () => useStore.getState().select({ kind: "wip" }) },
        { label: "Toggle terminal", hint: "Ctrl+`", run: () => set({ terminalOpen: !useStore.getState().terminalOpen }) },
        { label: "Open in external editor", run: () => A.openInEditor() },
        { label: "Open external terminal", run: A.openExternalTerminal },
        { label: "Gitflow: start feature…", run: () => A.gitflowStart("feature") },
        { label: "Gitflow: start release…", run: () => A.gitflowStart("release") },
        { label: "Gitflow: start hotfix…", run: () => A.gitflowStart("hotfix") },
        { label: "Repository preferences", run: () => openPrefs("repo-commit") },
        { label: "Refresh", hint: "F5", run: () => useStore.getState().refresh() },
      );
      const head = data?.info?.headBranch;
      if (head && A.pullRequestHost()) c.push({ label: "Create pull request…", run: () => A.openPullRequest(head) });
      for (const b of data?.refs?.locals ?? []) if (!b.isHead) c.push({ label: `Checkout ${b.name}`, run: () => A.checkout(b.name) });
      for (const b of data?.refs?.locals ?? []) if (!b.isHead) c.push({ label: `Merge ${b.name} into current`, run: () => A.merge(b.name) });
    }
    return c;
  }, [repo, data?.refs]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = cmds.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 60);
  const go = (c?: Cmd) => {
    if (!c) return;
    set({ modal: null });
    c.run();
  };
  return (
    <div className="modal-back top" onClick={() => set({ modal: null })}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Type a command…"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, list.length - 1));
            else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") go(list[idx]);
            else if (e.key === "Escape") set({ modal: null });
            else return;
            e.preventDefault();
          }}
        />
        <div className="palette-list">
          {list.map((c, i) => (
            <div key={c.label} className={`palette-item${i === idx ? " on" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => go(c)}>
              <span>{c.label}</span>
              {c.hint && <span className="muted small">{c.hint}</span>}
            </div>
          ))}
          {!list.length && <div className="empty small">No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
