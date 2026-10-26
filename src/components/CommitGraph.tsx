import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, Settings2, Tag } from "lucide-react";
import { GraphRow, Seg } from "../api";
import * as A from "../actions";
import { commitMenu, dropBranchMenu } from "../actions";
import RefsPopover from "./RefsPopover";
import { RefIcons, refWhere } from "./RefIcons";
import { useAvatar, useDateFormat } from "../hooks";
import { GLOBAL_DEFAULTS, GlobalKey } from "../settings";
import { g, shortSha, useG, useRepo, useStore } from "../store";
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

/**
 * Commit node: the author's avatar (or initials) in a ring of the lane color,
 * centred at `cx`. A merge commit's author is whoever made the merge.
 */
function Node({ row, trunks, cx }: { row: GraphRow; trunks: number; cx: number }) {
  const url = useAvatar(row.email);
  const [broken, setBroken] = useState(false);
  const c = laneColor(row.color, trunks);
  const isTrunk = row.color < trunks;
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

/** How the dashed line from the WIP node down to HEAD crosses a row. */
type WipLink = { x: number; reach: "through" | "into-head" };

/** Dashes and gaps of the WIP line, in px; rows are a whole number of periods tall. */
const WIP_DASH = 3;

function WipLine({ link }: { link: WipLink }) {
  const end = link.reach === "through" ? ROW_H : MID;
  return <path d={`M${link.x} 0 V${end}`} stroke="var(--muted)" strokeDasharray={`${WIP_DASH} ${WIP_DASH}`} strokeWidth={2} />;
}

/** Gap kept above and below a row's band, so rows read as separate strips. */
const BAND_GAP = 2;
const BAR_W = 3;

/**
 * The row's band: from the node to the edge of the graph cell, tinted in the
 * lane colour and closed by a solid bar where the message column starts.
 * Faded until the row is selected (`.row-band` in App.css).
 */
function RowBand({ cx, width, color }: { cx: number; width: number; color: string }) {
  const h = ROW_H - 2 * BAND_GAP;
  return (
    <g className="row-band">
      <rect x={cx} y={BAND_GAP} width={Math.max(0, width - cx)} height={h} fill={color} fillOpacity={0.2} />
      <rect x={width - BAR_W} y={BAND_GAP} width={BAR_W} height={h} fill={color} />
    </g>
  );
}

/** Label connectors are faint hairlines; keep in step with `.refs-col .connector`. */
const LINK_OPACITY = 0.35;

/** Continues the branch label's connector (refs column) across the graph to the node. */
function LabelLink({ row, cx, color }: { row: GraphRow; cx: number; color: string }) {
  if (!row.refs.length) return null;
  // Half a pixel down: a crisp 1px line on the same pixel row as the CSS piece.
  return <path d={`M0 ${MID + 0.5} H${cx}`} stroke={color} strokeWidth={1} strokeOpacity={LINK_OPACITY} />;
}

function Lanes({ row, width, trunks, wipLink }: { row: GraphRow; width: number; trunks: number; wipLink?: WipLink }) {
  const angular = useG("graphLineStyle") === "angular";
  const segPath = angular ? angularPath : curvedPath;
  // Main branches (trunk columns) are drawn bolder so they read as the spine
  // of the graph. Paint order: feature verticals, feature elbows, then trunk
  // lines on top; the node last so it covers the joints.
  const order = (s: Seg) => (s.color < trunks ? 2 : 0) + (s.from !== s.to ? 1 : 0);
  const sorted = [...row.segs].sort((a, b) => order(a) - order(b));
  return (
    <svg width={width} height={ROW_H} className="lanes">
      <RowBand cx={x(row.lane)} width={width} color={laneColor(row.color, trunks)} />
      <LabelLink row={row} cx={x(row.lane)} color={laneColor(row.color, trunks)} />
      {wipLink && <WipLine link={wipLink} />}
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
      <Node row={row} trunks={trunks} cx={x(row.lane)} />
    </svg>
  );
}

/**
 * Compact graph, for a column narrower than the full graph: every commit on
 * one line at the column centre, linked to the commits above and below.
 */
function CompactLane({ row, width, trunks, linkUp }: { row: GraphRow; width: number; trunks: number; linkUp: boolean }) {
  const cx = width / 2;
  const color = laneColor(row.color, trunks);
  return (
    <svg width={width} height={ROW_H} className="lanes">
      <RowBand cx={cx} width={width} color={color} />
      <LabelLink row={row} cx={cx} color={color} />
      {linkUp && <path d={`M${cx} 0 V${MID}`} stroke={color} strokeWidth={2} />}
      {row.parents.length > 0 && <path d={`M${cx} ${MID} V${ROW_H}`} stroke={color} strokeWidth={2} />}
      <Node row={row} trunks={trunks} cx={cx} />
    </svg>
  );
}

function Pills({ row, trunks }: { row: GraphRow; trunks: number }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (!row.refs.length) return null;
  const color = laneColor(row.color, trunks);
  // One label per row, whatever the column width: the first branch (the
  // backend lists the current one first), else the first tag. The other
  // branches sit behind "+N"; tags are labels only, never switch targets.
  const branches = row.refs.filter((r) => r.kind !== "tag");
  const tags = row.refs.filter((r) => r.kind === "tag");
  const shown = [branches[0] ?? tags[0]];
  const hiddenBranches = Math.max(0, branches.length - 1);
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
            onDragStart={(e) => e.dataTransfer.setData("text/corvus-branch", r.name)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!r.current) void A.checkout(r.name, r.kind === "remote");
            }}
            onContextMenu={(e) => {
              // This branch's own menu, not the commit menu of the row.
              e.preventDefault();
              e.stopPropagation();
              useStore.getState().openMenu(e, A.refLabelMenu(r));
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
      <span className="connector" style={{ background: color }} />
      {anchor && <RefsPopover refs={branches} color={color} anchor={anchor} onClose={close} />}
    </>
  );
}
type ColumnId = "refs" | "graph" | "message" | "author" | "date" | "sha";

interface Column {
  id: ColumnId;
  /** Setting that shows or hides the column. */
  visible: GlobalKey;
  label: string;
  /** Narrowest width a drag can reach. */
  min: number;
}

/** Narrowest graph column: one avatar with the HEAD ring. */
const GRAPH_MIN = 28;

const COLUMNS: Column[] = [
  { id: "refs", visible: "colRefs", label: "Branch / Tag", min: 90 },
  { id: "graph", visible: "colGraph", label: "Graph", min: GRAPH_MIN },
  { id: "message", visible: "colMessage", label: "Commit message", min: 120 },
  { id: "author", visible: "colAuthor", label: "Author", min: 60 },
  { id: "date", visible: "colDate", label: "Date / Time", min: 70 },
  { id: "sha", visible: "colSha", label: "SHA", min: 64 },
];

/**
 * Column widths (Preferences), resized by dragging a header edge and reset
 * by double-clicking it. The graph column fits the whole graph until the
 * user sizes it.
 */
function useColumnWidths(graphFit: number) {
  const stored = useG("colWidths");
  const { setG } = useStore.getState();
  const widthOf = (id: ColumnId) => stored[id] ?? (id === "graph" ? graphFit : GLOBAL_DEFAULTS.colWidths[id]);
  const resize = (col: Column, startX: number) => {
    const start = widthOf(col.id);
    const move = (e: PointerEvent) => setG("colWidths", { ...g("colWidths"), [col.id]: Math.max(col.min, Math.round(start + e.clientX - startX)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const reset = (id: ColumnId) => {
    const next = { ...g("colWidths") };
    delete next[id];
    setG("colWidths", next);
  };
  return { widthOf, resize, reset };
}

/** Right padding of every row and of the header (`.row`, `.graph-head`). */
const ROW_PAD = 10;

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
  // The WIP node links down to HEAD across every row between them.
  const headIndex = hasWip && headRow ? rows.indexOf(headRow) : -1;
  const total = rows.length + offset;
  const graphFit = Math.max(1, graph?.width ?? 1) * LANE_W + 6;
  const { widthOf, resize, reset } = useColumnWidths(graphFit);
  const columns = COLUMNS.filter((c) => show[c.visible]);
  const rowW = columns.reduce((sum, c) => sum + widthOf(c.id), ROW_PAD);
  const graphW = widthOf("graph");
  const compact = graphW < graphFit;
  const head = useRef<HTMLDivElement>(null);

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

  const colMenu = (e: React.MouseEvent) =>
    openMenu(e, COLUMNS.map((c) => ({ label: `${show[c.visible] ? "✓ " : "   "}${c.label}`, action: () => setG(c.visible, !show[c.visible] as never) })));

  const items = [];
  for (let i = first; i < last; i++) {
    if (hasWip && i === 0) {
      const sel = selection?.kind === "wip";
      const cx = compact ? graphW / 2 : x(headRow?.lane ?? 0);
      items.push(
        <div key="wip" className={`row wip${sel ? " selected" : ""}`} style={{ top: 0, width: rowW }} onClick={() => select({ kind: "wip" })}>
          {show.colRefs && <div className="col refs-col" style={{ width: widthOf("refs") }} />}
          {show.colGraph && (
            <div className="col" style={{ width: graphW, padding: 0 }}>
              <svg width={graphW} height={ROW_H} className="lanes">
                {headRow && (
                  // Offset so the dashes line up with the rows below, which start theirs at 0.
                  <path d={`M${cx} ${MID} L${cx} ${ROW_H}`} stroke="var(--muted)" strokeDasharray={`${WIP_DASH} ${WIP_DASH}`} strokeDashoffset={MID % (2 * WIP_DASH)} strokeWidth={2} />
                )}
                <circle cx={cx} cy={MID} r={8} fill="var(--bg)" stroke="var(--muted)" strokeDasharray="3 2" strokeWidth={2} />
              </svg>
            </div>
          )}
          <div className="col msg-col" style={{ width: widthOf("message") }}>
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
    const wipLink: WipLink | undefined =
      headRow && i - offset <= headIndex ? { x: x(headRow.lane), reach: i - offset < headIndex ? "through" : "into-head" } : undefined;
    items.push(
      <div
        key={row.oid}
        className={`row${sel ? " selected" : ""}${dim ? " dim" : ""}${tip ? " hl-tip" : ""}${row.isHead ? " head" : ""}`}
        style={{ top: i * ROW_H, width: rowW, "--branch": laneColor(row.color, graph?.trunks ?? 0) } as React.CSSProperties}
        onClick={() => select({ kind: "commit", oid: row.oid })}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, commitMenu(row));
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("text/corvus-branch") && e.preventDefault()}
        onDrop={(e) => {
          const src = e.dataTransfer.getData("text/corvus-branch");
          if (src) openMenu(e, dropBranchMenu(src, row));
        }}
      >
        {show.colRefs && (
          <div className="col refs-col" style={{ width: widthOf("refs") }}>
            <Pills row={row} trunks={graph?.trunks ?? 0} />
          </div>
        )}
        {show.colGraph && (
          <div className="col" style={{ width: graphW, padding: 0 }}>
            {compact ? (
              <CompactLane row={row} width={graphW} trunks={graph?.trunks ?? 0} linkUp={i > 0} />
            ) : (
              <Lanes row={row} width={graphW} trunks={graph?.trunks ?? 0} wipLink={wipLink} />
            )}
          </div>
        )}
        {show.colMessage && (
          <div className="col msg-col" style={{ width: widthOf("message") }}>
            <span className="msg-sum">{row.summary}</span>
            {descMode !== "never" && row.body && <span className={`msg-desc${descMode === "hover" ? " hover-only" : ""}`}>{row.body}</span>}
          </div>
        )}
        {show.colAuthor && (
          <div className="col author-col" style={{ width: widthOf("author") }}>
            <Avatar name={row.author} email={row.email} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.author}</span>
          </div>
        )}
        {show.colDate && <div className="col date-col" style={{ width: widthOf("date") }}>{fmt(row.time)}</div>}
        {show.colSha && <div className="col sha-col mono" style={{ width: widthOf("sha") }}>{shortSha(row.oid)}</div>}
      </div>,
    );
  }

  return (
    <div className="graph-wrap">
      <div className="graph-head" onContextMenu={(e) => (e.preventDefault(), colMenu(e))}>
        {/* Scrolled with the body (see onScroll); the Columns button stays put. */}
        <div className="graph-head-track" ref={head}>
          {columns.map((c) => (
            <div key={c.id} className="col" style={{ width: widthOf(c.id) }}>
              {c.label}
              <span
                className="col-resize"
                title="Drag to resize · double-click to reset"
                onPointerDown={(e) => resize(c, e.clientX)}
                onDoubleClick={() => reset(c.id)}
              />
            </div>
          ))}
        </div>
        <button className="icon" title="Columns" onClick={colMenu}>
          <Settings2 size={13} />
        </button>
      </div>
      <div
        className="graph"
        ref={scroller}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          if (head.current) head.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        // Hover/tip highlights paint from the message column onwards.
        style={{ "--row-start": `${(show.colRefs ? widthOf("refs") : 0) + (show.colGraph ? graphW : 0)}px` } as React.CSSProperties}
      >
        <div className="graph-rows" style={{ height: total * ROW_H, width: rowW }}>
          {items}
        </div>
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
