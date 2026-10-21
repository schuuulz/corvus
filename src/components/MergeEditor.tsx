import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { api, ConflictVersions } from "../api";
import { languageOf } from "../monaco";
import { openMergeTool } from "../actions";
import { t } from "../i18n";
import { useEditorOptions, useEditorTheme } from "./DiffView";
import { useStore } from "../store";

interface Block { start: number; end: number; ours: string[]; theirs: string[] }

/** Finds `<<<<<<<` / `=======` / `>>>>>>>` blocks (diff3 `|||||||` aware). */
export function conflictBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<<")) continue;
    const b: Block = { start: i, end: -1, ours: [], theirs: [] };
    let part: "ours" | "base" | "theirs" = "ours";
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("|||||||") && part === "ours") part = "base";
      else if (l.startsWith("=======") && part !== "theirs") part = "theirs";
      else if (l.startsWith(">>>>>>>") && part === "theirs") {
        b.end = i;
        break;
      } else if (part === "ours") b.ours.push(l);
      else if (part === "theirs") b.theirs.push(l);
    }
    if (b.end >= 0) out.push(b);
  }
  return out;
}

function replaceBlock(text: string, b: Block, use: string[]) {
  const lines = text.split("\n");
  lines.splice(b.start, b.end - b.start + 1, ...use);
  return lines.join("\n");
}

export default function MergeEditor({ file }: { file: string }) {
  const repo = useStore((s) => s.active)!;
  const { run, setCenter } = useStore.getState();
  const [v, setV] = useState<ConflictVersions | null>(null);
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.conflictVersions(repo, file).then((x) => {
      setV(x);
      setOutput(x.merged.replace(/\r\n/g, "\n"));
    }, (e) => setErr(String(e)));
  }, [repo, file]);

  const blocks = useMemo(() => conflictBlocks(output), [output]);
  const lang = languageOf(file);
  const edTheme = useEditorTheme();
  const opts = useEditorOptions();
  const ro = { ...opts, readOnly: true };

  if (err) return <div className="pad error-text">{err}</div>;
  if (!v) return <div className="pad muted">Loading…</div>;

  const save = async () => {
    const done = await run("Resolve", (r) => api.resolveConflict(r, file, output).then(() => true), { success: () => ({ title: t("resolve.title"), description: file }) });
    if (done) setCenter({ kind: "graph" });
  };

  return (
    <div className="merge">
      <div className="diff-head">
        <span className="diff-title">Resolve conflict: {file}</span>
        <span className="spacer" />
        <button className="small" onClick={() => openMergeTool(file)}>External merge tool</button>
        <button className="small" onClick={() => setOutput(v.ours)}>Take all ours</button>
        <button className="small" onClick={() => setOutput(v.theirs)}>Take all theirs</button>
        <button className="primary small" onClick={save} disabled={blocks.length > 0} title={blocks.length ? "Resolve every conflict block first" : ""}>
          Save &amp; mark resolved
        </button>
        <button className="icon" onClick={() => setCenter({ kind: "graph" })}>✕</button>
      </div>
      <div className="merge-top">
        <div className="pane">
          <div className="pane-title ours">Ours (current branch)</div>
          <Editor value={v.ours} language={lang} theme={edTheme} options={ro} />
        </div>
        <div className="pane">
          <div className="pane-title theirs">Theirs (incoming)</div>
          <Editor value={v.theirs} language={lang} theme={edTheme} options={ro} />
        </div>
      </div>
      <div className="merge-blocks">
        {blocks.length ? (
          blocks.map((b, i) => (
            <div key={b.start} className="block-chip">
              <span>Conflict {i + 1} · line {b.start + 1}</span>
              <button className="small" onClick={() => setOutput(replaceBlock(output, b, b.ours))}>Ours</button>
              <button className="small" onClick={() => setOutput(replaceBlock(output, b, b.theirs))}>Theirs</button>
              <button className="small" onClick={() => setOutput(replaceBlock(output, b, [...b.ours, ...b.theirs]))}>Both</button>
            </div>
          ))
        ) : (
          <span className="muted">No conflict markers left — review the output and save.</span>
        )}
      </div>
      <div className="pane output">
        <div className="pane-title">Output (editable)</div>
        <Editor value={output} onChange={(t) => setOutput(t ?? "")} language={lang} theme={edTheme} options={opts} />
      </div>
    </div>
  );
}
