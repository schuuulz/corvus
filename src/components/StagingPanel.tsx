import { useEffect, useState } from "react";
import { ExternalLink, GitCommitHorizontal, Undo2, X } from "lucide-react";
import { api, FileStatus } from "../api";
import { commit as commitAction, discardFiles, openInEditor, openMergeTool, push, stageAll, stageFiles, unstageAll, unstageFiles } from "../actions";
import { r, useR, useRepo, useStore } from "../store";
import { useFileView, ViewToggle } from "./CommitDetail";
import { FileTree, StatusBadge } from "./ui";

function Row({ f, code, staged, selected, name, depth = 0 }: { f: FileStatus; code: string; staged: boolean; selected: boolean; name?: string; depth?: number }) {
  const { setCenter, openMenu, ask } = useStore.getState();
  const base = f.path.split("/").pop() ?? f.path;
  const dir = name ? "" : f.path.slice(0, f.path.length - base.length);
  const discard = async () => {
    if (await ask({ title: "Discard changes", message: `Discard all unstaged changes to ${f.path}? This cannot be undone.`, confirmLabel: "Discard", danger: true }))
      await discardFiles([f.path]);
  };
  const open = () =>
    f.conflicted ? setCenter({ kind: "merge", file: f.path }) : setCenter({ kind: "diff", file: f.path, oldFile: f.oldPath, mode: staged ? "staged" : "unstaged" });
  return (
    <div
      className={`file${selected ? " selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={open}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e, [
          staged
            ? { label: "Unstage", action: () => unstageFiles([f.path]) }
            : { label: "Stage", action: () => stageFiles([f.path]) },
          ...(staged ? [] : [{ label: "Discard changes…", danger: true, action: discard }]),
          ...(f.conflicted ? [{ label: "Open in external merge tool", action: () => openMergeTool(f.path) }] : []),
          "sep" as const,
          { label: "Open in external editor", action: () => openInEditor(f.path) },
          { label: "File history", action: () => setCenter({ kind: "history", file: f.path }) },
          { label: "Blame", action: () => setCenter({ kind: "blame", file: f.path }), disabled: code === "A" },
          { label: "Copy path", action: () => navigator.clipboard.writeText(f.path) },
        ]);
      }}
      title={f.path}
    >
      <StatusBadge code={code} conflicted={f.conflicted} />
      <span className="fname">
        <span className="muted">{dir}</span>
        {name ?? base}
      </span>
      <span className="row-actions">
        {!staged && !f.conflicted && (
          <button className="icon" title="Discard" onClick={(e) => (e.stopPropagation(), discard())}>
            <Undo2 size={13} />
          </button>
        )}
        {f.conflicted ? (
          <button className="small" onClick={(e) => (e.stopPropagation(), open())}>Resolve</button>
        ) : staged ? (
          <button className="small" onClick={(e) => (e.stopPropagation(), unstageFiles([f.path]))}>Unstage</button>
        ) : (
          <button className="small success" onClick={(e) => (e.stopPropagation(), stageFiles([f.path]))}>Stage</button>
        )}
      </span>
    </div>
  );
}

const SUMMARY_LIMIT = 72;

export default function StagingPanel({ onClose }: { onClose?: () => void }) {
  const { repo, data } = useRepo();
  const center = useStore((s) => (s.active ? s.center[s.active] : undefined));
  const { toast, openPrefs } = useStore.getState();
  const templateApply = useR("templateApply");
  const templateSummary = useR("templateSummary");
  const templateBody = useR("templateBody");
  const skipHooksDefault = useR("skipHooks");
  const pushAfter = useR("pushAfterCommit");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [skipHooks, setSkipHooks] = useState(skipHooksDefault);
  const [view, setView] = useFileView();
  const files = data?.status?.files ?? [];
  const unstaged = files.filter((f) => f.unstaged || f.conflicted);
  const staged = files.filter((f) => f.staged && !f.conflicted);
  const conflicts = files.some((f) => f.conflicted);

  const applyTemplate = () => {
    setSummary(templateApply ? templateSummary : "");
    setBody(templateApply ? templateBody : "");
  };
  useEffect(() => {
    applyTemplate();
    setAmend(false);
    setSkipHooks(skipHooksDefault);
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on && repo) {
      const msg = await api.headMessage(repo).catch(() => "");
      const [s, ...rest] = msg.split("\n");
      setSummary(s);
      setBody(rest.join("\n").trim());
    } else applyTemplate();
  };

  const commit = async () => {
    if (!summary.trim()) return toast("Enter a commit summary", "error");
    const message = body.trim() ? `${summary.trim()}\n\n${body.trim()}\n` : `${summary.trim()}\n`;
    const out = await commitAction(message, amend, skipHooks, r("templateStrip"));
    if (out !== undefined) {
      applyTemplate();
      setAmend(false);
      if (pushAfter) await push(false);
    }
  };

  const sel = (f: FileStatus, isStaged: boolean) =>
    (center?.kind === "diff" && center.file === f.path && center.mode === (isStaged ? "staged" : "unstaged")) ||
    (center?.kind === "merge" && center.file === f.path);

  const list = (items: FileStatus[], isStaged: boolean) =>
    view === "path" ? (
      items.map((f) => <Row key={(isStaged ? "s" : "u") + f.path} f={f} code={(isStaged ? f.staged : f.unstaged) ?? "M"} staged={isStaged} selected={sel(f, isStaged)} />)
    ) : (
      <FileTree items={items} pathOf={(f) => f.path} render={(f, name, depth) => <Row key={(isStaged ? "s" : "u") + f.path} f={f} name={name} depth={depth + 1} code={(isStaged ? f.staged : f.unstaged) ?? "M"} staged={isStaged} selected={sel(f, isStaged)} />} />
    );

  const over = summary.length > SUMMARY_LIMIT;
  return (
    <div className="right staging" style={{ width: "100%" }}>
      <div className="files-head" style={{ position: "static" }}>
        <span>{files.length} file change{files.length === 1 ? "" : "s"} {data?.info?.headBranch ? `on ${data.info.headBranch}` : ""}</span>
        <span className="row-inline">
          <ViewToggle value={view} onChange={setView} />
          {onClose && (
            <button className="icon" title="Close (Esc)" onClick={onClose}>
              <X size={14} />
            </button>
          )}
        </span>
      </div>
      <div className="files-head">
        <span>Unstaged ({unstaged.length})</span>
        {unstaged.length > 0 && <button className="small success" onClick={stageAll}>Stage all</button>}
      </div>
      <div className="files grow">
        {list(unstaged, false)}
        {!unstaged.length && <div className="empty small">Working tree clean</div>}
      </div>
      <div className="files-head">
        <span>Staged ({staged.length})</span>
        {staged.length > 0 && <button className="small" onClick={unstageAll}>Unstage all</button>}
      </div>
      <div className="files grow">
        {list(staged, true)}
        {!staged.length && <div className="empty small">Stage files to include them in the commit</div>}
      </div>
      <div className="commit-box">
        <div className="commit-opts">
          <label className="check">
            <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} disabled={data?.info?.unborn} />
            Amend previous commit
          </label>
          <label className="check" title="Commit with --no-verify">
            <input type="checkbox" checked={skipHooks} onChange={(e) => setSkipHooks(e.target.checked)} />
            Skip hooks
          </label>
          {pushAfter && <span className="chip accent">push after commit</span>}
        </div>
        <div className="summary-wrap">
          <input
            placeholder="Commit summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && commit()}
          />
          <span className={`counter${over ? " over" : ""}`}>{SUMMARY_LIMIT - summary.length}</span>
        </div>
        <textarea
          placeholder="Description"
          value={body}
          rows={4}
          spellCheck
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && commit()}
        />
        <button className="primary" disabled={conflicts || (!staged.length && !amend) || !summary.trim()} onClick={commit} title="Ctrl+Enter">
          <GitCommitHorizontal size={15} />
          {amend ? "Amend commit" : staged.length ? `Commit ${staged.length} file${staged.length === 1 ? "" : "s"}` : "Stage changes to commit"}
        </button>
        <button className="link small" style={{ alignSelf: "flex-start" }} onClick={() => openPrefs("repo-commit")}>
          <ExternalLink size={11} /> Commit template & options
        </button>
      </div>
    </div>
  );
}
