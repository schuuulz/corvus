import { ReactNode, useState } from "react";
import {
  Archive, Boxes, Check, ChevronRight, CircleDot, Cloud, ExternalLink, Eye, EyeOff, GitBranch, GitPullRequest, Link2,
  PanelLeftClose, Plus, RefreshCw, Search, Settings, Tag,
} from "lucide-react";
import { api, Issue, LocalBranch, PullRequest, Refs, RemoteBranch } from "../api";
import * as A from "../actions";
import { t, t as tr } from "../i18n";
import { usePullRequests, useIssues, useRepoIntegration } from "../hooks";
import { useG, useRepo, useStore } from "../store";
import { useFlowBases, usePinnedBranches } from "./GitflowPanel";
import { Collapsed, folderKeys, indent, RefTree, useCollapsed } from "./RefTree";
import { Collapse, Highlight } from "./ui";

const SECTIONS = new Set(["local", "remote", "prs", "issues", "tags", "stashes", "submodules"]);

interface SectionProps {
  id: string;
  title: string;
  icon: ReactNode;
  count?: number;
  /** Whether the filter matches anything inside; opens the section while filtering. */
  hasMatches?: boolean;
  actions?: ReactNode;
  sections: Collapsed;
  children: ReactNode;
}

function Section({ id, title, icon, count, hasMatches, actions, sections, children }: SectionProps) {
  const open = sections.isOpen(id, hasMatches);
  return (
    <div className="section">
      <div className="section-head" role="button" aria-expanded={open} onClick={() => sections.toggle(id, hasMatches)}>
        <ChevronRight size={12} className={`chev${open ? " open" : ""}`} />
        {icon}
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        <span className="spacer" />
        <span className="acts" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </div>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}

/** `items` whose name matches `filter` (case-insensitive substring). */
const matching = <T,>(items: T[], filter: string, ...fields: ((item: T) => string)[]) => {
  const f = filter.toLowerCase();
  return f ? items.filter((it) => fields.some((field) => field(it).toLowerCase().includes(f))) : items;
};

/** Splits `items` into the pinned main branches (in pinned order) and the rest. */
function splitPinned<T>(items: T[], nameOf: (item: T) => string, pinned: string[]): [T[], T[]] {
  const top = pinned.flatMap((name) => items.filter((it) => nameOf(it) === name));
  return [top, items.filter((it) => !top.includes(it))];
}

function LocalBranchItem({ b, label, depth, filter, bases, pinned }: { b: LocalBranch; label: string; depth: number; filter: string; bases: Set<string>; pinned?: boolean }) {
  const { openMenu, select, set } = useStore.getState();
  const hover = useStore((s) => s.hoverBranch);
  const flowOpen = useStore((s) => s.gitflowPanel?.base);
  return (
    <div
      className={`ref-item${b.isHead ? " current" : ""}${hover === b.name ? " hl" : ""}${pinned ? " pinned" : ""}`}
      style={{ paddingLeft: indent(depth) }}
      onClick={() => b.oid && select({ kind: "commit", oid: b.oid })}
      onDoubleClick={() => !b.isHead && A.checkout(b.name)}
      onMouseEnter={() => set({ hoverBranch: b.name })}
      onMouseLeave={() => set({ hoverBranch: null })}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e, A.localBranchMenu(b));
      }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/corvus-branch", b.name)}
      title={b.upstream ? `${b.name} → ${b.upstream}` : `${b.name} (no upstream)`}
    >
      {b.isHead ? <Check size={13} className="cur" /> : <GitBranch size={13} />}
      <span className="name">
        <Highlight text={label} query={filter} />
      </span>
      {(b.ahead > 0 || b.behind > 0) && (
        <span className="ab">
          {b.ahead > 0 && <span className="up">↑{b.ahead}</span>}
          {b.behind > 0 && <span className="down">↓{b.behind}</span>}
        </span>
      )}
      {bases.has(b.name) && (
        <button
          className={`flow-btn${flowOpen === b.name ? " on" : ""}`}
          title={`Gitflow (${b.name})`}
          onClick={(e) => {
            e.stopPropagation();
            set({ gitflowPanel: flowOpen === b.name ? null : { base: b.name } });
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

function RemoteBranchItem({ b, label, depth, filter, trackedBy, pinned }: { b: RemoteBranch; label: string; depth: number; filter: string; trackedBy?: string; pinned?: boolean }) {
  const { openMenu, select } = useStore.getState();
  return (
    <div
      className={`ref-item${trackedBy ? " tracked" : ""}${pinned ? " pinned" : ""}`}
      style={{ paddingLeft: indent(depth) }}
      onClick={() => b.oid && select({ kind: "commit", oid: b.oid })}
      onDoubleClick={() => A.checkout(b.name, true)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e, A.remoteBranchMenu(b));
      }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/corvus-branch", b.name)}
      title={trackedBy ? `${b.name} · tracked by ${trackedBy}` : b.name}
    >
      <GitBranch size={13} />
      <span className="name">
        <Highlight text={label} query={filter} />
      </span>
      {trackedBy && <Link2 size={11} className="tracked-icon" />}
    </div>
  );
}

/** A thin line between the pinned main branches and the folders below them. */
const PinnedDivider = ({ show }: { show: boolean }) => (show ? <div className="pinned-divider" /> : null);

function LocalBranches({ locals, filter, folders }: { locals: LocalBranch[]; filter: string; folders: Collapsed }) {
  const bases = useFlowBases();
  const [pinned, rest] = splitPinned(locals, (b) => b.name, usePinnedBranches());
  const leaf = (b: LocalBranch, label: string, depth: number) => <LocalBranchItem b={b} label={label} depth={depth} filter={filter} bases={bases} />;
  return (
    <>
      {pinned.map((b) => <LocalBranchItem key={b.name} b={b} label={b.name} depth={0} filter={filter} bases={bases} pinned />)}
      <PinnedDivider show={pinned.length > 0 && rest.length > 0} />
      <RefTree items={rest} nameOf={(b) => b.name} scope="local:" depth={0} filter={filter} folders={folders} renderLeaf={leaf} />
    </>
  );
}

function RemoteGroup({ remote, branches, trackedBy, filter, folders }: { remote: Refs["remotes"][number]; branches: RemoteBranch[]; trackedBy: Map<string, string>; filter: string; folders: Collapsed }) {
  const { openMenu, ask, run } = useStore.getState();
  const [pinned, rest] = splitPinned(branches, (b) => b.branch, usePinnedBranches());
  const key = `remote:${remote.name}`;
  const open = folders.isOpen(key, branches.length > 0);
  const leaf = (b: RemoteBranch, label: string, depth: number) => <RemoteBranchItem b={b} label={label} depth={depth} filter={filter} trackedBy={trackedBy.get(b.name)} />;
  return (
    <>
      <div
        className="ref-item folder"
        title={remote.url ?? ""}
        onClick={() => folders.toggle(key, branches.length > 0)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, [
            { label: "Fetch", action: () => A.fetchAll() },
            { label: "Copy URL", action: () => navigator.clipboard.writeText(remote.url ?? "") },
            {
              label: `Remove remote ${remote.name}…`,
              danger: true,
              action: async () => {
                if (await ask({ title: "Remove remote", message: `Remove ${remote.name}?`, confirmLabel: "Remove", danger: true }))
                  await run("Remove remote", (r) => api.removeRemote(r, remote.name), { success: () => ({ title: t("remote.removed"), description: remote.name }) });
              },
            },
          ]);
        }}
      >
        <ChevronRight size={12} className={`chev${open ? " open" : ""}`} />
        <Cloud size={13} />
        <span className="name">{remote.name}</span>
        <span className="meta">{branches.length}</span>
      </div>
      <Collapse open={open}>
        {pinned.map((b) => <RemoteBranchItem key={b.name} b={b} label={b.branch} depth={1} filter={filter} trackedBy={trackedBy.get(b.name)} pinned />)}
        <PinnedDivider show={pinned.length > 0 && rest.length > 0} />
        <RefTree items={rest} nameOf={(b) => b.branch} scope={`${key}/`} depth={1} filter={filter} folders={folders} renderLeaf={leaf} />
      </Collapse>
    </>
  );
}

function PullRequestItem({ p, filter }: { p: PullRequest; filter: string }) {
  return (
    <div
      className="pr-item"
      onClick={() => A.openExternal(p.url)}
      onContextMenu={(e) => {
        e.preventDefault();
        useStore.getState().openMenu(e, [
          { label: "Open in browser", action: () => A.openExternal(p.url) },
          { label: `Checkout ${p.source}`, action: () => A.checkout(`origin/${p.source}`, true) },
          { label: "Copy link", action: () => navigator.clipboard.writeText(p.url) },
        ]);
      }}
      title={p.title}
    >
      <div className="t">
        <GitPullRequest size={13} color={p.draft ? "var(--muted)" : "var(--add)"} />
        <span className="muted">#{p.number}</span>
        <span><Highlight text={p.title} query={filter} /></span>
      </div>
      <div className="s">{p.author} · <Highlight text={p.source} query={filter} /> → {p.target}</div>
    </div>
  );
}

function IssueItem({ i, filter }: { i: Issue; filter: string }) {
  return (
    <div
      className="pr-item"
      onClick={() => A.openExternal(i.url)}
      onContextMenu={(e) => {
        e.preventDefault();
        const slug = i.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        useStore.getState().openMenu(e, [
          { label: "Open in browser", action: () => A.openExternal(i.url) },
          { label: "Create branch for this issue…", action: () => A.newBranch(null, `feature/${i.number}-${slug}`) },
        ]);
      }}
      title={i.title}
    >
      <div className="t">
        <CircleDot size={13} color="var(--add)" />
        <span className="muted">#{i.number}</span>
        <span><Highlight text={i.title} query={filter} /></span>
      </div>
      {i.labels.length > 0 && <div className="s">{i.labels.join(" · ")}</div>}
    </div>
  );
}

const prFields = [(p: PullRequest) => p.title, (p: PullRequest) => `#${p.number}`, (p: PullRequest) => p.source];
const issueFields = [(i: Issue) => i.title, (i: Issue) => `#${i.number}`];

function Integrated({ filter, sections }: { filter: string; sections: Collapsed }) {
  const ri = useRepoIntegration();
  const prs = usePullRequests(ri);
  const issues = useIssues(ri);
  const { openPrefs } = useStore.getState();
  if (!ri) {
    return (
      <Section id="prs" title="Pull Requests" icon={<GitPullRequest size={12} />} hasMatches={false} sections={sections}>
        <div className="hint-box">
          Connect GitHub or GitLab to see pull requests and issues for this repository.{" "}
          <span className="link-text" onClick={() => openPrefs("integrations")}>Connect…</span>
        </div>
      </Section>
    );
  }
  const shownPrs = prs.items && matching(prs.items, filter, ...prFields);
  const shownIssues = issues.items && matching(issues.items, filter, ...issueFields);
  const reload = (
    <button className="icon" title="Refresh" onClick={() => (prs.reload(), issues.reload())}>
      <RefreshCw size={12} />
    </button>
  );
  return (
    <>
      <Section id="prs" title="Pull Requests" count={prs.items?.length} icon={<GitPullRequest size={12} />} hasMatches={!!shownPrs?.length} actions={reload} sections={sections}>
        {prs.error && <div className="hint-box error-text">{prs.error}</div>}
        {!prs.items && !prs.error && <div className="hint-box"><span className="spinner" /> Loading…</div>}
        {shownPrs?.map((p) => <PullRequestItem key={p.number} p={p} filter={filter} />)}
        {prs.items?.length === 0 && <div className="empty small">No open pull requests</div>}
      </Section>
      <Section id="issues" title="Issues" count={issues.items?.length} icon={<CircleDot size={12} />} hasMatches={!!shownIssues?.length} actions={reload} sections={sections}>
        {issues.error && <div className="hint-box error-text">{issues.error}</div>}
        {shownIssues?.map((i) => <IssueItem key={i.number} i={i} filter={filter} />)}
        {issues.items?.length === 0 && <div className="empty small">No open issues</div>}
      </Section>
    </>
  );
}

/** Every folder key the panel can show for `refs`, to prune what is remembered. */
function knownFolders(refs: Refs): Set<string> {
  return new Set([
    ...folderKeys("local:", refs.locals.map((b) => b.name)),
    ...refs.remotes.map((r) => `remote:${r.name}`),
    ...refs.remoteBranches.flatMap((b) => folderKeys(`remote:${b.remote}/`, [b.branch])),
  ]);
}

export default function RefsPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { repo, data } = useRepo();
  const refs = data?.refs;
  const { run, select, ask, openPrefs, setG } = useStore.getState();
  const [filter, setFilter] = useState("");
  const hideTracked = useG("hideTrackedRemotes");
  const sections = useCollapsed("collapsedSections", SECTIONS, filter);
  const folders = useCollapsed("collapsedFolders", refs ? knownFolders(refs) : new Set(), filter);
  if (!refs) return <aside className="left" style={{ padding: 12 }}><div className="skeleton" /></aside>;

  const trackedBy = new Map(refs.locals.flatMap((b) => (b.upstream ? [[b.upstream, b.name] as const] : [])));
  const locals = matching(refs.locals, filter, (b) => b.name);
  const remoteBranches = matching(refs.remoteBranches, filter, (b) => b.name).filter((b) => !(hideTracked && trackedBy.has(b.name)));
  const tags = matching(refs.tags, filter, (tg) => tg.name);
  const stashes = matching(refs.stashes, filter, (s) => s.message);
  const submodules = matching(refs.submodules, filter, (s) => s.name);
  const shown = locals.length + remoteBranches.length + tags.length + stashes.length;
  const total = refs.locals.length + refs.remoteBranches.length + refs.tags.length + refs.stashes.length;
  const branchesOf = (remote: string) => remoteBranches.filter((b) => b.remote === remote);

  const addRemote = async () => {
    const v = await ask({
      title: "Add remote",
      fields: [
        { name: "name", label: "Name", value: refs.remotes.length ? "" : "origin" },
        { name: "url", label: "URL", placeholder: "https://github.com/you/repo.git" },
      ],
      confirmLabel: "Add",
    });
    if (v?.name && v.url) await run("Add remote", (r) => api.addRemote(r, v.name.trim(), v.url.trim()), { success: () => ({ title: t("remote.added"), description: `${v.name.trim()} · ${v.url.trim()}` }) });
  };
  const remoteActions = (
    <>
      <button className="icon" title={hideTracked ? "Show branches tracked locally" : "Hide branches tracked locally"} onClick={() => setG("hideTrackedRemotes", !hideTracked)}>
        {hideTracked ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button className="icon" title="Add remote" onClick={addRemote}>
        <Plus size={13} />
      </button>
    </>
  );

  return (
    <aside className="left" style={{ width: "100%" }}>
      <div className="left-head">
        <span className="viewing">{filter ? `Viewing ${shown} of ${total}` : `Viewing ${total}`}</span>
        <span className="spacer" />
        {onCollapse && (
          <button className="icon" title="Hide panel (Ctrl+J)" onClick={onCollapse}>
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>
      <div className="filter-box">
        <Search size={13} />
        <input placeholder="Filter (Ctrl+Alt+F)" id="refs-filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setFilter("")} />
      </div>
      <div className="left-scroll">
        {filter && shown + submodules.length === 0 && (
          <div className="empty small filter-empty">
            No branches, tags or stashes match “{filter}”.{" "}
            <button className="link" onClick={() => setFilter("")}>Clear filter</button>
          </div>
        )}
        <Section id="local" title="Local" count={refs.locals.length} icon={<GitBranch size={12} />} hasMatches={locals.length > 0} sections={sections} actions={<button className="icon" title="New branch" onClick={() => A.newBranch()}><Plus size={13} /></button>}>
          <LocalBranches locals={locals} filter={filter} folders={folders} />
        </Section>

        <Section id="remote" title="Remote" count={refs.remotes.length} icon={<Cloud size={12} />} hasMatches={remoteBranches.length > 0} sections={sections} actions={remoteActions}>
          {refs.remotes.map((rm) => <RemoteGroup key={rm.name} remote={rm} branches={branchesOf(rm.name)} trackedBy={trackedBy} filter={filter} folders={folders} />)}
          {!refs.remotes.length && <div className="empty small">No remotes</div>}
        </Section>

        {repo && <Integrated filter={filter} sections={sections} />}

        <Section id="tags" title="Tags" count={refs.tags.length} icon={<Tag size={12} />} hasMatches={tags.length > 0} sections={sections}>
          {tags.map((tg) => (
            <div
              key={tg.name}
              className="ref-item"
              title={tg.name}
              onClick={() => tg.oid && select({ kind: "commit", oid: tg.oid })}
              onContextMenu={(e) => {
                e.preventDefault();
                useStore.getState().openMenu(e, [
                  { label: `Checkout ${tg.name}`, action: () => A.checkout(tg.name) },
                  { label: `Delete tag ${tg.name}`, danger: true, action: () => run("Delete tag", (r) => api.deleteTag(r, tg.name), { success: () => ({ title: tr("tag.deleted"), description: tg.name }) }) },
                ]);
              }}
            >
              <Tag size={13} />
              <span className="name"><Highlight text={tg.name} query={filter} /></span>
            </div>
          ))}
        </Section>

        <Section id="stashes" title="Stashes" count={refs.stashes.length} icon={<Archive size={12} />} hasMatches={stashes.length > 0} sections={sections}>
          {stashes.map((s) => (
            <div
              key={s.oid}
              className="ref-item"
              onClick={() => select({ kind: "commit", oid: s.oid })}
              onContextMenu={(e) => {
                e.preventDefault();
                useStore.getState().openMenu(e, [
                  { label: "Apply stash", action: () => A.stashAction("apply", s.index, s.message) },
                  { label: "Pop stash", action: () => A.stashAction("pop", s.index, s.message) },
                  { label: "Delete stash", danger: true, action: () => A.stashAction("drop", s.index, s.message) },
                ]);
              }}
              title={s.message}
            >
              <Archive size={13} />
              <span className="name"><Highlight text={s.message} query={filter} /></span>
            </div>
          ))}
        </Section>

        {refs.submodules.length > 0 && (
          <Section id="submodules" title="Submodules" count={refs.submodules.length} icon={<Boxes size={12} />} hasMatches={submodules.length > 0} sections={sections}>
            {submodules.map((s) => (
              <div
                key={s.path}
                className="ref-item"
                title="Double-click to open in a new tab"
                onDoubleClick={() => {
                  const base = data?.info?.path;
                  if (base) void useStore.getState().openRepo(`${base}/${s.path}`);
                }}
              >
                <Boxes size={13} />
                <span className="name"><Highlight text={s.name} query={filter} /></span>
                <ExternalLink size={11} />
              </div>
            ))}
          </Section>
        )}
      </div>
      <div className="left-foot">
        <button className="link" onClick={() => openPrefs()}>
          <Settings size={14} /> Preferences
        </button>
      </div>
    </aside>
  );
}
