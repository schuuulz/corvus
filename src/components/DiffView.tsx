import { useEffect, useRef, useState } from "react";
import Editor, { DiffEditor, DiffOnMount } from "@monaco-editor/react";
import { ExternalLink, History, Pencil, ScanSearch, Save, X } from "lucide-react";
import { api, DiffMode, ext, FileHunks, Hunk, Versions } from "../api";
import { applyHunk, openInEditor } from "../actions";
import { t } from "../i18n";
import { languageOf } from "../monaco";
import { shortSha, useG, useR, useStore } from "../store";

interface Props { file: string; oldFile?: string | null; mode: DiffMode; oid?: string }

/** Monaco options derived from Editor preferences. */
export function useEditorOptions() {
  const font = useG("editorFont");
  const size = useG("editorFontSize");
  const tab = useG("editorTabSize");
  const lines = useG("editorLineNumbers");
  const wrap = useG("editorWordWrap");
  return {
    fontFamily: `"${font}", var(--font-mono)`,
    fontSize: size,
    tabSize: tab,
    lineNumbers: lines ? ("on" as const) : ("off" as const),
    wordWrap: wrap ? ("on" as const) : ("off" as const),
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
  };
}

export function useEditorTheme() {
  const theme = useG("theme");
  return theme === "corvus-light" ? "corvus-light" : "corvus-dark";
}

function HunkBlock({ h, index, file, mode }: { h: Hunk; index: number; file: string; mode: DiffMode }) {
  const { ask } = useStore.getState();
  const wrap = useG("editorWordWrap");
  const lineNos = useG("editorLineNumbers");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => setSel(new Set()), [h]);
  const editable = mode !== "commit";
  const lines = sel.size ? [...sel] : undefined;
  const what = sel.size ? `${sel.size} line${sel.size === 1 ? "" : "s"}` : "hunk";

  const toggle = (i: number, shift: boolean) => {
    if (!editable || !"+-".includes(h.lines[i].origin)) return;
    const next = new Set(sel);
    if (shift && anchor !== null) {
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) if ("+-".includes(h.lines[k].origin)) next.add(k);
    } else if (next.has(i)) next.delete(i);
    else next.add(i);
    setAnchor(i);
    setSel(next);
  };

  return (
    <div className="hunk">
      <div className="hunk-head">
        <span className="mono muted">{h.header}</span>
        <span className="spacer" />
        {sel.size > 0 && <button className="small" onClick={() => setSel(new Set())}>Clear selection</button>}
        {mode === "unstaged" && (
          <>
            <button
              className="small danger-outline"
              onClick={async () => {
                if (await ask({ title: "Discard", message: `Discard this ${what}? This cannot be undone.`, confirmLabel: "Discard", danger: true }))
                  await applyHunk(file, "discard", index, lines);
              }}
            >
              Discard {what}
            </button>
            <button className="small success" onClick={() => applyHunk(file, "stage", index, lines)}>Stage {what}</button>
          </>
        )}
        {mode === "staged" && (
          <button className="small" onClick={() => applyHunk(file, "unstage", index, lines)}>Unstage {what}</button>
        )}
      </div>
      <div className="hunk-lines mono">
        {h.lines.map((l, i) => (
          <div
            key={i}
            className={`dl ${l.origin === "+" ? "add" : l.origin === "-" ? "del" : l.origin === "\\" ? "meta" : ""}${sel.has(i) ? " sel" : ""}${editable && "+-".includes(l.origin) ? " pickable" : ""}${wrap ? " wrap" : ""}`}
            onClick={(e) => toggle(i, e.shiftKey)}
          >
            {lineNos && <span className="ln">{l.oldNo ?? ""}</span>}
            {lineNos && <span className="ln">{l.newNo ?? ""}</span>}
            <span className="og">{l.origin === "\\" ? "" : l.origin}</span>
            <span className="code">{l.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiffView({ file, oldFile, mode, oid }: Props) {
  const repo = useStore((s) => s.active)!;
  const statusVersion = useStore((s) => s.repos[repo]?.status);
  const encoding = useR("encoding");
  const syntax = useG("editorSyntax");
  const eol = useG("editorEol");
  const options = useEditorOptions();
  const edTheme = useEditorTheme();
  const { setCenter, run, toast } = useStore.getState();
  const [view, setView] = useState<"hunks" | "split" | "inline" | "edit">("hunks");
  const [hunks, setHunks] = useState<FileHunks | null>(null);
  const [versions, setVersions] = useState<Versions | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hunkView = view === "hunks" && mode !== "commit";
  const canEdit = mode === "unstaged";
  // The diff editor keeps its models (avoids a Monaco dispose-order error);
  // dispose them ourselves once the editor that used them is gone.
  const models = useRef<{ dispose(): void }[]>([]);
  const onDiffMount: DiffOnMount = (ed) => {
    const m = ed.getModel();
    if (m) models.current.push(m.original, m.modified);
    const sub = ed.onDidDispose(() => {
      sub.dispose();
      const stale = models.current.splice(0);
      setTimeout(() => stale.forEach((x) => x.dispose()), 0);
    });
  };

  useEffect(() => {
    let live = true;
    setErr(null);
    if (hunkView) {
      api.hunks(repo, file, mode === "staged").then((h) => live && setHunks(h), (e) => live && setErr(String(e)));
    } else if (view !== "edit") {
      api.versions(repo, file, mode, oid, oldFile, encoding).then((v) => live && setVersions(v), (e) => live && setErr(String(e)));
    }
    return () => {
      live = false;
    };
    // statusVersion: re-read after any refresh (stage/unstage/external edit).
  }, [repo, file, oldFile, mode, oid, hunkView, view === "edit", statusVersion, encoding]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = async () => {
    try {
      const v = await api.versions(repo, file, "unstaged", undefined, null, encoding);
      setDraft(v.modified);
      setView("edit");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const save = async () => {
    if (draft === null) return;
    let text = draft;
    if (eol === "CRLF") text = text.replace(/\r?\n/g, "\r\n");
    else if (eol === "LF") text = text.replace(/\r\n/g, "\n");
    const ok = await run("Save", (r) => ext.writeRepoFile(r, file, text).then(() => true), { success: () => ({ title: t("saved.title"), description: file }) });
    if (ok) {
      setView("hunks");
    }
  };

  const lang = syntax ? languageOf(file) : "plaintext";
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-title" title={file}>
          {oldFile && oldFile !== file ? `${oldFile} → ` : ""}
          {file}
        </span>
        <span className="chip">{mode === "commit" ? `@ ${shortSha(oid ?? "")}` : mode}</span>
        {encoding !== "utf-8" && <span className="chip warn">{encoding}</span>}
        <span className="spacer" />
        <div className="seg">
          {mode !== "commit" && <button className={view === "hunks" ? "on" : ""} onClick={() => setView("hunks")}>Hunks</button>}
          <button className={view === "split" || (mode === "commit" && view === "hunks") ? "on" : ""} onClick={() => setView("split")}>Split</button>
          <button className={view === "inline" ? "on" : ""} onClick={() => setView("inline")}>Inline</button>
          {canEdit && <button className={view === "edit" ? "on" : ""} onClick={startEdit} title="Edit this file"><Pencil size={12} /> Edit</button>}
        </div>
        {view === "edit" && (
          <button className="small primary" onClick={save}>
            <Save size={13} /> Save
          </button>
        )}
        <button className="icon" title="File history" onClick={() => setCenter({ kind: "history", file })}>
          <History size={15} />
        </button>
        <button className="icon" title="Blame" onClick={() => setCenter({ kind: "blame", file })}>
          <ScanSearch size={15} />
        </button>
        <button className="icon" title="Open in external editor" onClick={() => openInEditor(file)}>
          <ExternalLink size={15} />
        </button>
        <button className="icon" title="Close (Esc)" onClick={() => setCenter({ kind: "graph" })}>
          <X size={16} />
        </button>
      </div>
      {err && <div className="pad error-text">{err}</div>}
      {!err && hunkView && hunks && (
        <div className="hunks">
          {hunks.binary && <div className="empty">Binary file changed</div>}
          {!hunks.binary && !hunks.hunks.length && <div className="empty">No {mode} changes in this file</div>}
          {hunks.hunks.length > 0 && <div className="hint muted">Click lines to select them (Shift-click for a range), then stage, unstage or discard only those lines.</div>}
          {hunks.hunks.map((h, i) => (
            <HunkBlock key={i} h={h} index={i} file={file} mode={mode} />
          ))}
        </div>
      )}
      {!err && view === "edit" && draft !== null && (
        <Editor value={draft} onChange={(t) => setDraft(t ?? "")} language={lang} theme={edTheme} options={options} />
      )}
      {!err && !hunkView && view !== "edit" && versions && (
        versions.binary ? (
          <div className="empty">{versions.modified || versions.original}</div>
        ) : (
          <DiffEditor
            key={`${mode}:${oid ?? ""}:${file}`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            onMount={onDiffMount}
            original={versions.original}
            modified={versions.modified}
            language={lang}
            theme={edTheme}
            options={{ ...options, readOnly: true, renderSideBySide: view !== "inline" }}
          />
        )
      )}
    </div>
  );
}
