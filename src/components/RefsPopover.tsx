import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Cloud, GitBranch, Loader2, Search, Tag, X } from "lucide-react";
import { RefLabel } from "../api";
import * as A from "../actions";
import { MenuEntry, useRepo, useStore } from "../store";
import { RefIcons, refWhere } from "./RefIcons";

interface Props {
  refs: RefLabel[];
  color: string;
  anchor: DOMRect;
  onClose: () => void;
}

// Tags are labels only: they are never offered as a switch target.
const GROUPS: { kind: RefLabel["kind"][]; label: string }[] = [
  { kind: ["head", "local"], label: "Local" },
  { kind: ["remote"], label: "Remote" },
];

/** Dropdown with every branch on a commit; one click switches to it. */
export default function RefsPopover({ refs, color, anchor, onClose }: Props) {
  const { data } = useRepo();
  const { openMenu } = useStore.getState();
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });

  const items = useMemo(() => {
    const f = q.trim().toLowerCase();
    return GROUPS.map((g) => ({ ...g, refs: refs.filter((r) => g.kind.includes(r.kind) && (!f || r.name.toLowerCase().includes(f))) })).filter((g) => g.refs.length);
  }, [refs, q]);
  const flat = items.flatMap((g) => g.refs);

  // Keep inside the viewport; flip above the chip when there's no room below.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8));
    const below = anchor.bottom + 4;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, anchor.top - r.height - 4) : below;
    setPos({ left, top });
  }, [anchor, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const onScroll = (e: Event) => !root.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => root.current?.focus(), []);

  const pick = async (r: RefLabel) => {
    if (r.current || pending) return;
    setFailed(null);
    setPending(r.name);
    const ok = await A.checkout(r.name, r.kind === "remote");
    setPending(null);
    if (ok) onClose();
    else setFailed(r.name);
  };

  // A grouped label is one branch in several places: offer the local
  // branch menu, then the remote-only actions for each remote copy.
  const menu = (e: React.MouseEvent, r: RefLabel) => {
    e.preventDefault();
    const refs = data?.refs;
    const local = r.kind === "local" ? refs?.locals.find((b) => b.name === r.name) : undefined;
    const remoteNames = r.kind === "local" ? r.remotes.map((name) => `${name}/${r.name}`) : [r.name];
    const remotes = remoteNames.flatMap((n) => refs?.remoteBranches.filter((b) => b.name === n) ?? []);
    const items: MenuEntry[] = local ? A.localBranchMenu(local) : [];
    for (const rb of remotes) {
      const own = A.remoteBranchMenu(rb).filter((x) => x !== "sep" && (!local || !x.label.startsWith("Checkout")));
      items.push("sep", { label: rb.name, disabled: true, icon: <Cloud size={12} /> }, ...own);
    }
    if (!items.length) items.push({ label: `Checkout ${r.name}`, action: () => pick(r) }, { label: "Copy name", action: () => navigator.clipboard.writeText(r.name) });
    openMenu(e, items);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return e.preventDefault(), onClose();
    if (e.key === "ArrowDown") return e.preventDefault(), setIdx((i) => Math.min(i + 1, flat.length - 1));
    if (e.key === "ArrowUp") return e.preventDefault(), setIdx((i) => Math.max(i - 1, 0));
    if (e.key === "Enter" && flat[idx]) return e.preventDefault(), void pick(flat[idx]);
  };

  let n = -1;
  return createPortal(
    <div ref={root} className="refs-pop" style={pos} tabIndex={-1} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      <div className="refs-pop-head">
        <span className="dot" style={{ background: color }} />
        <span>{refs.length} branches on this commit</span>
        <span className="spacer" />
        <button className="icon" onClick={onClose} title="Close (Esc)">
          <X size={13} />
        </button>
      </div>
      {refs.length > 8 && (
        <div className="filter-box" style={{ margin: "6px 8px" }}>
          <Search size={13} />
          <input autoFocus placeholder="Filter" value={q} onChange={(e) => (setQ(e.target.value), setIdx(0))} />
        </div>
      )}
      <div className="refs-pop-list">
        {items.map((g) => (
          <div key={g.label}>
            <div className="refs-pop-group">{g.label}</div>
            {g.refs.map((r) => {
              n += 1;
              const i = n;
              const busy = pending === r.name;
              return (
                <div
                  key={r.kind + r.name}
                  className={`refs-pop-item${i === idx ? " on" : ""}${r.current ? " current" : ""}${failed === r.name ? " failed" : ""}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(r)}
                  onContextMenu={(e) => menu(e, r)}
                  draggable={r.kind === "local" || r.kind === "remote"}
                  onDragStart={(e) => e.dataTransfer.setData("text/kc-branch", r.name)}
                  title={`${r.name} · ${refWhere(r)}${r.current ? " (current branch)" : r.kind === "remote" ? "\nCreates a local tracking branch" : ""}`}
                >
                  <span className="refs-pop-icon">
                    {busy ? <Loader2 size={13} className="spin" /> : r.current ? <Check size={13} strokeWidth={3} /> : r.kind === "tag" ? <Tag size={13} /> : r.kind === "remote" ? <Cloud size={13} /> : <GitBranch size={13} />}
                  </span>
                  <span className="refs-pop-name">{r.name}</span>
                  <span className="pill-locs">
                    <RefIcons r={r} lead={false} size={11} />
                  </span>
                  {r.current && <span className="chip accent">HEAD</span>}
                  {!r.current && <span className="refs-pop-hint">{busy ? "…" : "↵"}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {!flat.length && <div className="empty small">No refs match “{q}”</div>}
      </div>
    </div>,
    document.body,
  );
}
