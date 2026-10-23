import { useEffect, useState } from "react";
import { Copy, FileDiff, MoreHorizontal, PanelRightClose } from "lucide-react";
import { api, ChangedFile, CommitDetail as Detail } from "../api";
import { commitMenu, openInEditor } from "../actions";
import { useDateFormat } from "../hooks";
import { shortSha, useStore } from "../store";
import { Avatar, FileTree, StatusBadge } from "./ui";

export function FileRow({ f, name, depth = 0, onClick, onContextMenu, selected }: { f: ChangedFile; name?: string; depth?: number; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; selected?: boolean }) {
  const base = f.path.split("/").pop() ?? f.path;
  const dir = name ? "" : f.path.slice(0, f.path.length - base.length);
  return (
    <div className={`file${selected ? " selected" : ""}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={onClick} onContextMenu={onContextMenu} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
      <StatusBadge code={f.status} />
      <span className="fname">
        <span className="muted">{dir}</span>
        {name ?? base}
      </span>
      <span className="stats">
        {f.additions > 0 && <span className="plus">+{f.additions}</span>}
        {f.deletions > 0 && <span className="minus">−{f.deletions}</span>}
      </span>
    </div>
  );
}

export function ViewToggle({ value, onChange }: { value: "path" | "tree"; onChange: (v: "path" | "tree") => void }) {
  return (
    <div className="seg">
      <button className={value === "path" ? "on" : ""} onClick={() => onChange("path")}>Path</button>
      <button className={value === "tree" ? "on" : ""} onClick={() => onChange("tree")}>Tree</button>
    </div>
  );
}

export function useFileView(): ["path" | "tree", (v: "path" | "tree") => void] {
  const [v, setV] = useState<"path" | "tree">(() => {
    try {
      return (localStorage.getItem("corvus.fileView") as "path" | "tree") || "path";
    } catch {
      return "path";
    }
  });
  return [
    v,
    (n) => {
      setV(n);
      try {
        localStorage.setItem("corvus.fileView", n);
      } catch {
        /* ignore */
      }
    },
  ];
}

export default function CommitDetail({ oid, onCollapse }: { oid: string; onCollapse?: () => void }) {
  const repo = useStore((s) => s.active)!;
  const row = useStore((s) => s.repos[repo]?.graph?.rows.find((r) => r.oid === oid));
  const wip = useStore((s) => s.repos[repo]?.status?.files.length ?? 0);
  const center = useStore((s) => s.center[repo]);
  const { setCenter, select, openMenu } = useStore.getState();
  const fmt = useDateFormat();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useFileView();

  useEffect(() => {
    let live = true;
    setD(null);
    setErr(null);
    api.commitDetails(repo, oid).then((x) => live && setD(x), (e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [repo, oid]);

  const head = (
    <div className="files-head" style={{ position: "static" }}>
      <span>Commit</span>
      {onCollapse && (
        <button className="icon" title="Hide panel" onClick={onCollapse}>
          <PanelRightClose size={14} />
        </button>
      )}
    </div>
  );
  if (err) return <div className="right" style={{ width: "100%" }}>{head}<div className="pad error-text">{err}</div></div>;
  if (!d)
    return (
      <div className="right" style={{ width: "100%" }}>
        {head}
        <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="skeleton" style={{ width: "40%" }} />
          <div className="skeleton" style={{ width: "90%", height: 18 }} />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      </div>
    );

  const counts = d.files.reduce<Record<string, number>>((a, f) => ((a[f.status] = (a[f.status] ?? 0) + 1), a), {});
  const fileMenu = (f: ChangedFile) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e, [
      { label: "View diff", action: () => setCenter({ kind: "diff", file: f.path, oldFile: f.oldPath, mode: "commit", oid }) },
      { label: "File history", action: () => setCenter({ kind: "history", file: f.path }) },
      { label: "Blame", action: () => setCenter({ kind: "blame", file: f.path }) },
      { label: "Open in external editor", action: () => openInEditor(f.path) },
      { label: "Copy path", action: () => navigator.clipboard.writeText(f.path) },
    ]);
  };
  const isSel = (f: ChangedFile) => center?.kind === "diff" && center.file === f.path && center.oid === oid;
  const open = (f: ChangedFile) => setCenter({ kind: "diff", file: f.path, oldFile: f.oldPath, mode: "commit", oid });

  return (
    <div className="right" style={{ width: "100%" }}>
      {head}
      <div className="right-scroll">
        {wip > 0 && (
          <div className="wip-banner">
            <FileDiff size={14} />
            <span>{wip} file change{wip === 1 ? "" : "s"} in working directory</span>
            <span className="spacer" />
            <button className="small primary" onClick={() => select({ kind: "wip" })}>View changes</button>
          </div>
        )}
        <div className="detail-head">
          <div className="detail-sha mono">
            commit {shortSha(d.oid)}
            <button className="icon" title="Copy SHA" onClick={() => navigator.clipboard.writeText(d.oid)}>
              <Copy size={13} />
            </button>
            <span className="spacer" />
            {row && (
              <button className="icon" title="Actions" onClick={(e) => openMenu(e, commitMenu(row))}>
                <MoreHorizontal size={15} />
              </button>
            )}
          </div>
          <h3 className="detail-summary">{d.summary}</h3>
          {d.body && <pre className="detail-body">{d.body}</pre>}
          <div className="person">
            <Avatar name={d.author} email={d.email} size="lg" />
            <div className="who">
              <div>{d.author}</div>
              <div className="muted small">authored {fmt(d.authorTime, "datetime", true)}</div>
            </div>
          </div>
          {d.committer !== d.author && (
            <div className="person">
              <Avatar name={d.committer} email="" size="lg" />
              <div className="who">
                <div>{d.committer}</div>
                <div className="muted small">committed {fmt(d.commitTime, "datetime", true)}</div>
              </div>
            </div>
          )}
          <div className="parents muted">
            parent{d.parents.length > 1 ? "s" : ""}:{" "}
            {d.parents.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <a className="mono link" onClick={() => select({ kind: "commit", oid: p })}>{shortSha(p)}</a>
              </span>
            ))}
            {!d.parents.length && "none (root commit)"}
          </div>
        </div>
        <div className="change-summary">
          {counts.A && <span className="plus">+ {counts.A} added</span>}
          {counts.M && <span style={{ color: "var(--mod)" }}>~ {counts.M} modified</span>}
          {counts.D && <span className="minus">− {counts.D} deleted</span>}
          {(counts.R || counts.C) && <span style={{ color: "var(--ren)" }}>→ {(counts.R ?? 0) + (counts.C ?? 0)} renamed</span>}
          {!d.files.length && <span className="muted">No file changes</span>}
        </div>
        <div className="files-head">
          <span>{d.files.length} changed file{d.files.length === 1 ? "" : "s"}</span>
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div className="files">
          {view === "path"
            ? d.files.map((f) => <FileRow key={f.path} f={f} selected={isSel(f)} onClick={() => open(f)} onContextMenu={fileMenu(f)} />)
            : <FileTree items={d.files} pathOf={(f) => f.path} render={(f, name, depth) => <FileRow key={f.path} f={f} name={name} depth={depth + 1} selected={isSel(f)} onClick={() => open(f)} onContextMenu={fileMenu(f)} />} />}
        </div>
      </div>
    </div>
  );
}
