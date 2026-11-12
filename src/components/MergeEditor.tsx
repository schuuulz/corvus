import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor, IRange } from "monaco-editor";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api, ConflictVersions, ext } from "../api";
import { languageOf } from "../monaco";
import { openMergeTool } from "../actions";
import { t } from "../i18n";
import { useEditorOptions, useEditorTheme } from "./DiffView";
import { useStore } from "../store";

type CodeEditor = monacoEditor.IStandaloneCodeEditor;
interface TextEdit { range: IRange; text: string }

/** One conflict, as 0-based line indices of its markers in the merged text. */
interface Block {
  start: number;
  /** The diff3 `|||||||` line, when the file carries the common ancestor. */
  base: number | null;
  mid: number;
  end: number;
  ours: string[];
  theirs: string[];
}

/** How to resolve a block: one side, or both in the given order. */
type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours";

const CHOICES: { choice: Choice; label: string }[] = [
  { choice: "ours", label: "Ours" },
  { choice: "theirs", label: "Theirs" },
  { choice: "ours-theirs", label: "Ours + Theirs" },
  { choice: "theirs-ours", label: "Theirs + Ours" },
];

/** Finds `<<<<<<<` / `=======` / `>>>>>>>` blocks (diff3 `|||||||` aware). */
export function conflictBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<<")) continue;
    const b: Block = { start: i, base: null, mid: -1, end: -1, ours: [], theirs: [] };
    let part: "ours" | "base" | "theirs" = "ours";
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("|||||||") && part === "ours") {
        part = "base";
        b.base = i;
      } else if (l.startsWith("=======") && part !== "theirs") {
        part = "theirs";
        b.mid = i;
      } else if (l.startsWith(">>>>>>>") && part === "theirs") {
        b.end = i;
        break;
      } else if (part === "ours") b.ours.push(l);
      else if (part === "theirs") b.theirs.push(l);
    }
    if (b.end >= 0) out.push(b);
  }
  return out;
}

function resolution(b: Block, choice: Choice): string[] {
  switch (choice) {
    case "ours":
      return b.ours;
    case "theirs":
      return b.theirs;
    case "ours-theirs":
      return [...b.ours, ...b.theirs];
    case "theirs-ours":
      return [...b.theirs, ...b.ours];
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const normalizeEol = (text: string) => text.replace(/\r\n/g, "\n");

/** A Monaco range over 0-based lines `from`..`to` (inclusive), or none when empty. */
function lineRange(from: number, to: number): IRange | null {
  return from > to ? null : { startLineNumber: from + 1, startColumn: 1, endLineNumber: to + 1, endColumn: 1 };
}

/** Tints each block's sides and markers, and frames the current one in the gutter. */
function blockDecorations(monaco: Monaco, blocks: Block[], current: number, rulerColor: string): monacoEditor.IModelDeltaDecoration[] {
  return blocks.flatMap((b, i) => {
    const oursEnd = (b.base ?? b.mid) - 1;
    const markers = [b.start, b.base, b.mid, b.end].filter((l): l is number => l !== null);
    const sections: [number, number, string][] = [
      [b.start + 1, oursEnd, "cf-ours"],
      [oursEnd + 2, b.mid - 1, "cf-base"],
      [b.mid + 1, b.end - 1, "cf-theirs"],
      ...markers.map((l): [number, number, string] => [l, l, "cf-marker"]),
    ];
    const tints = sections.flatMap(([from, to, className]) => {
      const range = lineRange(from, to);
      return range ? [{ range, options: { isWholeLine: true, className } }] : [];
    });
    const frame = {
      range: { startLineNumber: b.start + 1, startColumn: 1, endLineNumber: b.end + 1, endColumn: 1 },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: i === current ? "cf-gutter current" : "cf-gutter",
        overviewRuler: { color: rulerColor, position: monaco.editor.OverviewRulerLane.Full },
      },
    };
    return [...tints, frame];
  });
}

/**
 * Drives the editor that shows the merged text: colours its conflict blocks
 * and moves between them, landing on the first one when it opens.
 */
function useConflictNavigator(blocks: Block[]) {
  const [editor, setEditor] = useState<CodeEditor | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [index, setIndex] = useState(0);
  const theme = useEditorTheme();
  const revealPending = useRef(true);
  const current = blocks.length ? Math.min(index, blocks.length - 1) : -1;

  const goTo = (i: number) => {
    const b = blocks[i];
    if (!editor || !b) return;
    setIndex(i);
    editor.revealLineInCenter(b.start + 1);
    editor.setPosition({ lineNumber: b.start + 1, column: 1 });
  };
  const step = (delta: number) => {
    if (blocks.length) goTo((current + delta + blocks.length) % blocks.length);
  };

  // Reveals the current block on open, and after a resolved block shifts the next one into its place.
  useEffect(() => {
    if (!editor || !revealPending.current || !blocks.length) return;
    revealPending.current = false;
    goTo(current);
  });

  useEffect(() => {
    if (!editor || !monaco) return;
    // The overview ruler takes a concrete colour, so read the active theme's token.
    const ruler = getComputedStyle(document.documentElement).getPropertyValue("--mod").trim();
    const collection = editor.createDecorationsCollection(blockDecorations(monaco, blocks, current, ruler));
    return () => collection.clear();
  }, [editor, monaco, blocks, current, theme]);

  const onMount: OnMount = (e, m) => {
    setEditor(e);
    setMonaco(m);
  };
  /** F8 / Shift+F8 move between blocks wherever the focus is in the view. */
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (e.key !== "F8") return;
    e.preventDefault();
    e.stopPropagation();
    step(e.shiftKey ? -1 : 1);
  };
  const revealAfterEdit = () => {
    revealPending.current = true;
  };

  return { editor, current, goTo, step, onMount, onKeyDownCapture, revealAfterEdit };
}

function BlockNav({ count, current, step }: { count: number; current: number; step: (delta: number) => void }) {
  if (!count) return <span className="muted">No conflict blocks</span>;
  return (
    <span className="block-nav">
      <button className="icon" onClick={() => step(-1)} title="Previous conflict (Shift+F8)" aria-label="Previous conflict">
        <ChevronUp size={14} />
      </button>
      <span className="block-nav-pos">
        {current + 1} / {count}
      </span>
      <button className="icon" onClick={() => step(1)} title="Next conflict (F8)" aria-label="Next conflict">
        <ChevronDown size={14} />
      </button>
    </span>
  );
}

/** The edit that swaps block `b`, markers included, for `lines`. */
function blockEdit(model: monacoEditor.ITextModel, b: Block, lines: string[]): TextEdit {
  const last = model.getLineCount();
  if (b.end + 1 < last) {
    const range = { startLineNumber: b.start + 1, startColumn: 1, endLineNumber: b.end + 2, endColumn: 1 };
    return { range, text: lines.map((l) => `${l}\n`).join("") };
  }
  // The block ends the file, so no newline follows it.
  const end = { endLineNumber: last, endColumn: model.getLineMaxColumn(last) };
  if (lines.length || b.start === 0) return { range: { startLineNumber: b.start + 1, startColumn: 1, ...end }, text: lines.join("\n") };
  return { range: { startLineNumber: b.start, startColumn: model.getLineMaxColumn(b.start), ...end }, text: "" };
}

/** Applies an edit as its own undo step, so Ctrl+Z restores what it replaced. */
function applyEdit(editor: CodeEditor, edit: TextEdit) {
  editor.pushUndoStop();
  editor.executeEdits("merge", [edit]);
  editor.pushUndoStop();
}

interface BlockChoicesProps {
  blocks: Block[];
  current: number;
  goTo: (i: number) => void;
  choose: (b: Block, choice: Choice) => void;
}

function BlockChoices({ blocks, current, goTo, choose }: BlockChoicesProps) {
  if (!blocks.length) return <div className="merge-blocks muted">No conflict markers left — review the output and save.</div>;
  return (
    <div className="merge-blocks">
      {blocks.map((b, i) => (
        <div key={b.start} className={`block-chip${i === current ? " current" : ""}`}>
          <button className="link" onClick={() => goTo(i)} title={`Go to line ${b.start + 1}`}>
            Conflict {i + 1} · line {b.start + 1}
          </button>
          <span className="muted">
            {plural(b.ours.length, "line")} vs {plural(b.theirs.length, "line")}
          </span>
          {CHOICES.map(({ choice, label }) => (
            <button key={choice} className={`small choice-${choice}`} onClick={() => choose(b, choice)}>
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
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
      setOutput(normalizeEol(x.merged));
    }, (e) => setErr(String(e)));
  }, [repo, file]);

  const blocks = useMemo(() => conflictBlocks(output), [output]);
  const nav = useConflictNavigator(blocks);
  const lang = languageOf(file);
  const edTheme = useEditorTheme();
  const opts = useEditorOptions();
  const ro = { ...opts, readOnly: true };

  if (err) return <div className="pad error-text">{err}</div>;
  if (!v) return <div className="pad muted">Loading…</div>;

  const edit = (make: (model: monacoEditor.ITextModel) => TextEdit) => {
    const model = nav.editor?.getModel();
    if (nav.editor && model) applyEdit(nav.editor, make(model));
  };
  const choose = (b: Block, choice: Choice) => {
    nav.revealAfterEdit();
    edit((model) => blockEdit(model, b, resolution(b, choice)));
  };
  const takeAll = (text: string) => edit((model) => ({ range: model.getFullModelRange(), text: normalizeEol(text) }));
  const save = async () => {
    const done = await run("Resolve", (r) => api.resolveConflict(r, file, output).then(() => true), { success: () => ({ title: t("resolve.title"), description: file }) });
    if (done) setCenter({ kind: "graph" });
  };

  return (
    <div className="merge" onKeyDownCapture={nav.onKeyDownCapture}>
      <div className="diff-head">
        <span className="diff-title">Resolve conflict: {file}</span>
        <BlockNav count={blocks.length} current={nav.current} step={nav.step} />
        <span className="spacer" />
        <button className="small" onClick={() => openMergeTool(file)}>External merge tool</button>
        <button className="small" onClick={() => takeAll(v.ours)}>Take all ours</button>
        <button className="small" onClick={() => takeAll(v.theirs)}>Take all theirs</button>
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
      <BlockChoices blocks={blocks} current={nav.current} goTo={nav.goTo} choose={choose} />
      <div className="pane output">
        <div className="pane-title">Output (editable)</div>
        <Editor value={output} onChange={(text) => setOutput(text ?? "")} onMount={nav.onMount} language={lang} theme={edTheme} options={opts} />
      </div>
    </div>
  );
}

/** Read-only view of the conflict that merging `base` would cause in `file`. */
export function ConflictPreview({ file, base }: { file: string; base: string }) {
  const repo = useStore((s) => s.active)!;
  const { setCenter } = useStore.getState();
  const [v, setV] = useState<ConflictVersions | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    ext.conflictPreview(repo, base, file).then(setV, (e) => setErr(String(e)));
  }, [repo, base, file]);

  const merged = useMemo(() => normalizeEol(v?.merged ?? ""), [v]);
  const blocks = useMemo(() => conflictBlocks(merged), [merged]);
  const nav = useConflictNavigator(blocks);
  const lang = languageOf(file);
  const edTheme = useEditorTheme();
  const ro = { ...useEditorOptions(), readOnly: true };

  if (err) return <div className="pad error-text">{err}</div>;
  if (!v) return <div className="pad muted">Loading…</div>;

  return (
    <div className="merge" onKeyDownCapture={nav.onKeyDownCapture}>
      <div className="diff-head">
        <span className="diff-title">Predicted conflict with {base}: {file}</span>
        <BlockNav count={blocks.length} current={nav.current} step={nav.step} />
        <span className="spacer" />
        <span className="muted">Nothing has been merged yet</span>
        <button className="icon" onClick={() => setCenter({ kind: "graph" })}>✕</button>
      </div>
      <div className="merge-top">
        <div className="pane">
          <div className="pane-title ours">Ours (current branch)</div>
          <Editor value={v.ours} language={lang} theme={edTheme} options={ro} />
        </div>
        <div className="pane">
          <div className="pane-title theirs">Theirs ({base})</div>
          <Editor value={v.theirs} language={lang} theme={edTheme} options={ro} />
        </div>
      </div>
      <div className="pane output">
        <div className="pane-title">Merge result (preview)</div>
        <Editor value={merged} onMount={nav.onMount} language={lang} theme={edTheme} options={ro} />
      </div>
    </div>
  );
}
