import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, Settings2, Tag } from "lucide-react";
import { GraphRow, Seg } from "../api";
import * as A from "../actions";
import { commitMenu, dropBranchMenu } from "../actions";
import RefsPopover from "./RefsPopover";
import { RefIcons, refWhere } from "./RefIcons";
import { useAvatar, useDateFormat } from "../hooks";
import { GlobalKey } from "../settings";
import { shortSha, useG, useRepo, useStore } from "../store";
import { Avatar, avatarColor, initials, laneColor } from "./ui";

const ROW_H = 30;
const LANE_W = 18;
const x = (lane: number) => LANE_W / 2 + lane * LANE_W;
const MID = ROW_H / 2;

/** Corner radius where a vertical line turns into a horizontal one. */
const RADIUS = 6;

function curvedPath(s: Seg) {
  const x1 = x(s.from), x2 = x(s.to);
  if (s.half === "full") return `M${x1} 0 L${x2} ${ROW_H}`;
  if (s.half === "top") return x1 === x2 ? `M${x1} 0 L${x2} ${MID}` : `M${x1} 0 C${x1} ${MID * 0.8} ${x2} ${MID * 0.2} ${x2} ${MID}`;
  return x1 === x2 ? `M${x1} ${MID} L${x2} ${ROW_H}` : `M${x1} ${MID} C${x1} ${MID * 1.8} ${x2} ${MID * 1.2} ${x2} ${ROW_H}`;
}

/**
 * Right-angle routing: lines run vertically in their column and change
 * column only at the commit's row (the row's vertical centre), with a small
 * rounded corner. A line arriving from another column comes down its own
 * column and turns into the node; a merge line leaves the node sideways and
 * turns down into the merged branch's column.
 */
function angularPath(s: Seg) {
  const x1 = x(s.from), x2 = x(s.to);
  if (x1 === x2) {
    if (s.half === "top") return `M${x1} 0 V${MID}`;
    if (s.half === "bottom") return `M${x1} ${MID} V${ROW_H}`;
    return `M${x1} 0 V${ROW_H}`;
  }
  const d = Math.sign(x2 - x1);
  const r = Math.min(RADIUS, Math.abs(x2 - x1) / 2, MID);
  // Down column x1, corner, then across to x2 at the row centre.
  const down = `M${x1} 0 V${MID - r} Q${x1} ${MID} ${x1 + d * r} ${MID}`;
  // Across to column x2, corner, then down to the row bottom.
  const turnDown = `H${x2 - d * r} Q${x2} ${MID} ${x2} ${MID + r} V${ROW_H}`;
  if (s.half === "top") return `${down} H${x2}`;
  if (s.half === "bottom") return `M${x1} ${MID} ${turnDown}`;
  return `${down} ${turnDown}`;
}

/** Commit node: the author's avatar (or initials) in a ring of the lane color. */
function Node({ row, trunks }: { row: GraphRow; trunks: number }) {
  const url = useAvatar(row.email);
  const [broken, setBroken] = useState(false);
  const c = laneColor(row.color, trunks);
  const isTrunk = row.color < trunks;
  const cx = x(row.lane);
  if (row.parents.length > 1) {
    // Merges stay small dots, so real work stands out.
    return <circle cx={cx} cy={MID} r={isTrunk ? 5 : 4.5} fill={c} stroke="var(--bg)" strokeWidth={1.5} />;
  }
  const r = 9;
  const clip = `av-${row.oid}`;
  return (
    <g>
      <title>{row.author}</title>
      <clipPath id={clip}>
        <circle cx={cx} cy={MID} r={r} />
      </clipPath>
      <circle cx={cx} cy={MID} r={r} fill={avatarColor(row.email || row.author)} />
      {url && !broken ? (
        <image href={url} x={cx - r} y={MID - r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" onError={() => setBroken(true)} />
      ) : (
        <text x={cx} y={MID} dy="0.35em" textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">
          {initials(row.author)}
        </text>
      )}
      <circle cx={cx} cy={MID} r={r} fill="none" stroke={c} strokeWidth={row.isHead ? 3.5 : isTrunk ? 2.6 : 2} />
      {row.isHead && <circle cx={cx} cy={MID} r={r + 3.5} fill="none" stroke={c} strokeOpacity={0.35} strokeWidth={2} />}
    </g>
  );
}

function Lanes({ row, width, trunks }: { row: GraphRow; width: number; trunks: number }) {
  const angular = useG("graphLineStyle") === "angular";
  const segPath = angular ? angularPath : curvedPath;
  // Main branches (trunk columns) are drawn bolder so they read as the spine
  // of the graph. Paint order: feature verticals, feature elbows, then trunk
  // lines on top; the node last so it covers the joints.
  const order = (s: Seg) => (s.color < trunks ? 2 : 0) + (s.from !== s.to ? 1 : 0);
  const sorted = [...row.segs].sort((a, b) => order(a) - order(b));
  return (
    <svg width={width} height={ROW_H} className="lanes">
      {sorted.map((s, i) => (
        <path
          key={i}
          d={segPath(s)}
          stroke={laneColor(s.color, trunks)}
          strokeWidth={s.color < trunks ? 3.2 : 2}
          // Butt caps keep vertical lines seamless across row boundaries.
          strokeLinecap={angular ? "butt" : "round"}
          strokeLinejoin="round"
          fill="none"
        />
      ))}
      <Node row={row} trunks={trunks} />
    </svg>
  );
}

function Pills({ row, width, trunks }: { row: GraphRow; width: number; trunks: number }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (!row.refs.length) return null;
  const color = laneColor(row.color, trunks);
  // Branches first, tags last. Tags are labels only: never switchable and
  // never listed in the "+N" switcher.
  const branches = row.refs.filter((r) => r.kind !== "tag");
  const tags = row.refs.filter((r) => r.kind === "tag");
  const max = Math.max(1, Math.floor((width - 40) / 120));
  const shown = [...branches, ...tags].slice(0, max);
  const hiddenBranches = branches.length - shown.filter((r) => r.kind !== "tag").length;
  const hiddenTags = tags.filter((t) => !shown.includes(t));
  return (
    <>
      {shown.map((r) =>
        r.kind === "tag" ? (
          <span key={"tag" + r.name} className="pill tag" title={`Tag ${r.name}`}>
            <Tag size={11} />
            <span className="pill-name">{r.name}</span>
          </span>
        ) : (
          <span
            key={r.kind + r.name}
            className={`pill ${r.kind}${r.current ? " current" : ""}`}
            style={{ background: color, color: r.kind === "remote" ? color : undefined }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/kc-branch", r.name)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!r.current) void A.checkout(r.name, r.kind === "remote");
            }}
            title={`${r.name} · ${refWhere(r)}\nLast commit by ${row.author}${r.current ? "\nCurrent branch" : "\nDouble-click to switch"}`}
          >
            {/* The label sits on the branch tip, so this is its latest author. */}
            <Avatar name={row.author} email={row.email} size="xs" />
            {r.current && <Check size={11} strokeWidth={3} />}
            <span className="pill-name">{r.name}</span>
            <span className="pill-locs">
              <RefIcons r={r} lead={false} size={10} />
            </span>
          </span>
        ),
      )}
      {hiddenBranches > 0 && (
        <button
          className={`pill more${anchor ? " open" : ""}`}
          title={`${hiddenBranches} more branch${hiddenBranches === 1 ? "" : "es"}`}
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect());
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          +{hiddenBranches}
          <ChevronDown size={11} />
        </button>
      )}
      {hiddenTags.length > 0 && (
        <span className="pill more tags" title={hiddenTags.map((t) => t.name).join("\n")}>
          +{hiddenTags.length}
          <Tag size={10} />
        </span>
      )}
      <span className="connector" style={{ background: color, width: 8 }} />
      {anchor && <RefsPopover refs={branches} color={color} anchor={anchor} onClose={close} />}
    </>
  );
}
const COLS: { key: GlobalKey; label: string; width?: string }[] = [
  { key: "colRefs", label: "Branch / Tag", width: "refs" },
  { key: "colGraph", label: "Graph" },
  { key: "colMessage", label: "Commit message" },
  { key: "colAuthor", label: "Author", width: "author" },
  { key: "colDate", label: "Date / Time", width: "date" },
  { key: "colSha", label: "SHA", width: "sha" },
];

export default function CommitGraph() {
  const { data } = useRepo();
  const selection = useStore((s) => (s.active ? s.selection[s.active] : undefined));
  const search = useStore((s) => s.search.trim().toLowerCase());
  const hoverBranch = useStore((s) => s.hoverBranch);
  const { select, openMenu, loadMore, setG } = useStore.getState();
  const fmt = useDateFormat();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const show = {
    colRefs: useG("colRefs"),
    colGraph: useG("colGraph"),
    colMessage: useG("colMessage"),
    colAuthor: useG("colAuthor"),
    colDate: useG("colDate"),
    colSha: useG("colSha"),
  } as Record<string, boolean>;
  const widths = useG("colWidths");
  const descMode = useG("showDescription");
  const visibility = useG("branchVisibility");
  const hoverHl = useG("hoverHighlight");

  const graph = data?.graph;
  const wipCount = data?.status?.files.length ?? 0;
  const hasWip = wipCount > 0;
  const allRows = graph?.rows ?? [];
  const headRow = allRows.find((r) => r.isHead);

  // Branch visibility: limit to rows reachable from local branches or HEAD.
  const rows = useMemo(() => {
    if (visibility === "all") return allRows;
    const keep = new Set<string>();
    const starts = visibility === "current" ? allRows.filter((r) => r.isHead) : allRows.filter((r) => r.isHead || r.refs.some((x) => x.kind === "local"));
    const byOid = new Map(allRows.map((r) => [r.oid, r]));
    const stack = starts.map((r) => r.oid);
    while (stack.length) {
      const o = stack.pop()!;
      if (keep.has(o)) continue;
      keep.add(o);
      stack.push(...(byOid.get(o)?.parents ?? []));
    }
    return allRows.filter((r) => keep.has(r.oid));
  }, [allRows, visibility]);

  const offset = hasWip ? 1 : 0;
  const total = rows.length + offset;
  const graphW = Math.max(1, graph?.width ?? 1) * LANE_W + 6;

  const matches = useMemo(() => {
    if (!search) return null;
    const m = new Set<string>();
    for (const r of rows)
      if (r.summary.toLowerCase().includes(search) || r.author.toLowerCase().includes(search) || r.oid.startsWith(search)) m.add(r.oid);
    return m;
  }, [rows, search]);

  // Hovering a branch in the left panel marks only its latest commit (tip).
  const tipOid = useMemo(
    () => (hoverHl && hoverBranch ? rows.find((r) => r.refs.some((x) => x.name === hoverBranch && x.kind !== "tag"))?.oid ?? null : null),
    [rows, hoverBranch, hoverHl],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!matches?.size || !scroller.current) return;
    const i = rows.findIndex((r) => matches.has(r.oid));
    if (i >= 0) scroller.current.scrollTop = Math.max(0, (i + offset) * ROW_H - 100);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected commit in view (e.g. after clicking a branch).
  useEffect(() => {
    if (selection?.kind !== "commit" || !scroller.current) return;
    const i = rows.findIndex((r) => r.oid === selection.oid);
    if (i < 0) return;
    const top = (i + offset) * ROW_H;
    const el = scroller.current;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 10);
  const nearEnd = !!graph?.hasMore && last >= total - 20;
  useEffect(() => {
    if (nearEnd) void loadMore();
  }, [nearEnd, loadMore]);

  const w = (k: string) => widths[k] ?? 120;
  const resize = (k: string, startX: number) => {
    const start = w(k);
    const move = (e: PointerEvent) => setG("colWidths", { ...useStore.getState().settings.global.colWidths as Record<string, number>, ...{ [k]: Math.max(50, start + e.clientX - startX) } });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const colMenu = (e: React.MouseEvent) =>
    openMenu(e, COLS.map((c) => ({ label: `${show[c.key] ? "✓ " : "   "}${c.label}`, action: () => setG(c.key, !show[c.key] as never) })));

  const items = [];
  for (let i = first; i < last; i++) {
    if (hasWip && i === 0) {
      const sel = selection?.kind === "wip";
      const lane = headRow?.lane ?? 0;
      items.push(
        <div key="wip" className={`row wip${sel ? " selected" : ""}`} style={{ top: 0 }} onClick={() => select({ kind: "wip" })}>
          {show.colRefs && <div className="col refs-col" style={{ width: w("refs") }} />}
          {show.colGraph && (
            <div className="col" style={{ padding: 0 }}>
              <svg width={graphW} height={ROW_H} className="lanes">
                {headRow && <path d={`M${x(lane)} ${MID} L${x(lane)} ${ROW_H}`} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={2} />}
                <circle cx={x(lane)} cy={MID} r={8} fill="var(--bg)" stroke="var(--muted)" strokeDasharray="3 2" strokeWidth={2} />
              </svg>
            </div>
          )}
          <div className="col msg-col">
            <em className="wip-label">// WIP</em>
            <span className="chip accent">+{wipCount}</span>
          </div>
        </div>,
      );
      continue;
    }
    const row = rows[i - offset];
    const sel = selection?.kind === "commit" && selection.oid === row.oid;
    const dim = matches && !matches.has(row.oid);
    const tip = row.oid === tipOid;
    items.push(
      <div
        key={row.oid}
        className={`row${sel ? " selected" : ""}${dim ? " dim" : ""}${tip ? " hl-tip" : ""}${row.isHead ? " head" : ""}`}
        style={{ top: i * ROW_H, ...(tip ? { "--branch": laneColor(row.color, graph?.trunks ?? 0) } : {}) } as React.CSSProperties}
        onClick={() => select({ kind: "commit", oid: row.oid })}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, commitMenu(row));
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("text/kc-branch") && e.preventDefault()}
        onDrop={(e) => {
          const src = e.dataTransfer.getData("text/kc-branch");
          if (src) openMenu(e, dropBranchMenu(src, row));
        }}
      >
        {show.colRefs && (
          <div className="col refs-col" style={{ width: w("refs") }}>
            <Pills row={row} width={w("refs")} trunks={graph?.trunks ?? 0} />
          </div>
        )}
        {show.colGraph && (
          <div className="col" style={{ padding: 0 }}>
            <Lanes row={row} width={graphW} trunks={graph?.trunks ?? 0} />
          </div>
        )}
        {show.colMessage && (
          <div className="col msg-col">
            <span className="msg-sum">{row.summary}</span>
            {descMode !== "never" && row.body && <span className={`msg-desc${descMode === "hover" ? " hover-only" : ""}`}>{row.body}</span>}
          </div>
        )}
        {!show.colMessage && <div className="spacer" />}
        {show.colAuthor && (
          <div className="col author-col" style={{ width: w("author") }}>
            <Avatar name={row.author} email={row.email} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.author}</span>
          </div>
        )}
        {show.colDate && <div className="col date-col" style={{ width: w("date") }}>{fmt(row.time)}</div>}
        {show.colSha && <div className="col sha-col mono" style={{ width: w("sha") }}>{shortSha(row.oid)}</div>}
      </div>,
    );
  }

  return (
    <div className="graph-wrap">
      <div className="graph-head" onContextMenu={(e) => (e.preventDefault(), colMenu(e))}>
        {show.colRefs && (
          <div className="col" style={{ width: w("refs") }}>
            Branch / Tag<span className="col-resize" onPointerDown={(e) => resize("refs", e.clientX)} />
          </div>
        )}
        {show.colGraph && <div className="col" style={{ width: graphW }}>Graph</div>}
        {show.colMessage ? <div className="col" style={{ flex: 1, minWidth: 120 }}>Commit message</div> : <div className="spacer" />}
        {show.colAuthor && (
          <div className="col" style={{ width: w("author") }}>
            Author<span className="col-resize" onPointerDown={(e) => resize("author", e.clientX)} />
          </div>
        )}
        {show.colDate && (
          <div className="col" style={{ width: w("date") }}>
            Date / Time<span className="col-resize" onPointerDown={(e) => resize("date", e.clientX)} />
          </div>
        )}
        {show.colSha && <div className="col" style={{ width: w("sha") }}>SHA</div>}
        <button className="icon" title="Columns" onClick={colMenu}>
          <Settings2 size={13} />
        </button>
      </div>
      <div
        className="graph"
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        // Hover/tip highlights paint from the message column onwards.
        style={{ "--row-start": `${(show.colRefs ? w("refs") : 0) + (show.colGraph ? graphW : 0)}px` } as React.CSSProperties}
      >
        <div style={{ height: total * ROW_H, position: "relative" }}>{items}</div>
        {!graph && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton" style={{ width: `${40 + ((i * 37) % 50)}%` }} />)}
          </div>
        )}
        {graph && total === 0 && (
          <div className="graph-empty empty">
            <GitBranch size={32} />
            No commits yet. Stage some files and make the first commit.
          </div>
        )}
      </div>
    </div>
  );
}
