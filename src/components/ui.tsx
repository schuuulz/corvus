import { ReactNode, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useAvatar } from "../hooks";

export const PALETTE = ["#7c5cff", "#21d4b4", "#f06292", "#4fc3f7", "#ffb74d", "#aed581", "#ba68c8", "#e57373", "#4db6ac", "#9575cd", "#fff176", "#a1887f"];
/** Main branches (trunk columns) share one color across the graph. */
export const TRUNK_COLOR = "#5841D8";
/** Colors cycled by every other branch line. */
export const BRANCH_COLORS = ["#3EBB8A", "#F5A623", "#E54B4B", "#0090FF", "#5841D8", "#00A6C9"];

/**
 * Color of a graph line/label. The backend numbers trunk colors 0..trunks
 * and other branches from `trunks` upwards, so trunk lines are recognisable
 * by `color < trunks`.
 */
export const laneColor = (c: number, trunks = 0) => (c < trunks ? TRUNK_COLOR : BRANCH_COLORS[(c - trunks) % BRANCH_COLORS.length]);

/** Stable background color for an author's initials. */
export function avatarColor(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, email, size = "sm" }: { name: string; email: string; size?: "xs" | "sm" | "lg" }) {
  const url = useAvatar(email);
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar${size === "sm" ? "" : ` ${size}`}`} style={{ background: avatarColor(email || name) }} title={`${name} <${email}>`}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/** Drag handle that reports pixel deltas. */
export function Splitter({ onDrag, horizontal, onDoubleClick }: { onDrag: (delta: number) => void; horizontal?: boolean; onDoubleClick?: () => void }) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);
  return (
    <div
      className={`splitter${horizontal ? " h" : ""}${dragging ? " dragging" : ""}`}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = horizontal ? e.clientY : e.clientX;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const pos = horizontal ? e.clientY : e.clientX;
        onDrag(pos - last.current);
        last.current = pos;
      }}
      onPointerUp={() => setDragging(false)}
    />
  );
}

export function StatusBadge({ code, conflicted }: { code: string; conflicted?: boolean }) {
  const cls = conflicted ? "conflict" : { A: "added", M: "modified", D: "deleted", R: "renamed", C: "renamed", T: "modified" }[code] ?? "";
  return <span className={`st ${cls}`}>{conflicted ? "!" : code}</span>;
}

interface TreeNode<T> { name: string; path: string; children: Map<string, TreeNode<T>>; item?: T }

/** Renders path-keyed items as a collapsible directory tree. */
export function FileTree<T>({ items, pathOf, render }: { items: T[]; pathOf: (t: T) => string; render: (t: T, name: string, depth: number) => ReactNode }) {
  const root: TreeNode<T> = { name: "", path: "", children: new Map() };
  for (const it of items) {
    const parts = pathOf(it).split("/");
    let node = root;
    parts.forEach((p, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(p)) node.children.set(p, { name: p, path, children: new Map() });
      node = node.children.get(p)!;
    });
    node.item = it;
  }
  return <>{[...root.children.values()].map((n) => <TreeBranch key={n.path} node={n} depth={0} render={render} />)}</>;
}

function TreeBranch<T>({ node, depth, render }: { node: TreeNode<T>; depth: number; render: (t: T, name: string, depth: number) => ReactNode }) {
  const [open, setOpen] = useState(true);
  // Collapse single-child directory chains ("src/components").
  let n = node;
  let label = n.name;
  while (!n.item && n.children.size === 1) {
    const only = [...n.children.values()][0];
    if (only.item) break;
    n = only;
    label += "/" + n.name;
  }
  if (n.item) return <>{render(n.item, label, depth)}</>;
  return (
    <>
      <div className="file dir" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={13} />
        <span className="fname">{label}</span>
      </div>
      {open && [...n.children.values()].map((c) => <TreeBranch key={c.path} node={c} depth={depth + 1} render={render} />)}
    </>
  );
}
