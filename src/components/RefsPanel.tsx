import { ReactNode, useState } from "react";
import {
  Archive, Boxes, Check, ChevronDown, ChevronRight, CircleDot, Cloud, ExternalLink, Folder, FolderOpen, GitBranch,
  GitPullRequest, PanelLeftClose, Plus, RefreshCw, Search, Settings, Tag,
} from "lucide-react";
import { api, LocalBranch } from "../api";
import * as A from "../actions";
import { t, t as tr } from "../i18n";
import { usePullRequests, useIssues, useRepoIntegration } from "../hooks";
import { useRepo, useStore } from "../store";
import { useFlowBases } from "./GitflowPanel";

function Section({ id, title, count, children, actions, icon }: { id: string; title: string; count?: number; children: ReactNode; actions?: ReactNode; icon: ReactNode }) {
  const key = `kc.section.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? "0" : "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="section">
      <div className="section-head" onClick={toggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        <span className="spacer" />
        <span className="acts" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

interface BranchNode { name: string; full: string; children: Map<string, BranchNode>; branch?: LocalBranch }

function buildTree(list: LocalBranch[]) {
  const root: BranchNode = { name: "", full: "", children: new Map() };
  for (const b of list) {
    const parts = b.name.split("/");
    let n = root;
    parts.forEach((p, i) => {
      const full = parts.slice(0, i + 1).join("/");
      if (!n.children.has(p)) n.children.set(p, { name: p, full, children: new Map() });
      n = n.children.get(p)!;
    });
    n.branch = b;
  }
  return root;
}

function BranchTree({ node, depth, bases }: { node: BranchNode; depth: number; bases: Set<string> }) {
  const [open, setOpen] = useState(true);
  const { openMenu, select, set } = useStore.getState();
  const hover = useStore((s) => s.hoverBranch);
  const flowOpen = useStore((s) => s.gitflowPanel?.base);
  const pad = 12 + depth * 14;
  if (node.branch && !node.children.size) {
    const b = node.branch;
    return (
      <div
        className={`ref-item${b.isHead ? " current" : ""}${hover === b.name ? " hl" : ""}`}
        style={{ paddingLeft: pad }}
        onClick={() => b.oid && select({ kind: "commit", oid: b.oid })}
        onDoubleClick={() => !b.isHead && A.checkout(b.name)}
        onMouseEnter={() => set({ hoverBranch: b.name })}
        onMouseLeave={() => set({ hoverBranch: null })}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, A.localBranchMenu(b));
        }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/kc-branch", b.name)}
        title={b.upstream ? `${b.name} → ${b.upstream}` : `${b.name} (no upstream)`}
      >
        {b.isHead ? <Check size={13} className="cur" /> : <GitBranch size={13} />}
        <span className="name">{node.name}</span>
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
  return (
    <>
      <div className="ref-item" style={{ paddingLeft: pad }} onClick={() => setOpen(!open)}>
        {open ? <FolderOpen size={13} /> : <Folder size={13} />}
        <span className="name">{node.name}</span>
        <span className="meta">{countLeaves(node)}</span>
      </div>
      {open && [...node.children.values()].map((c) => <BranchTree key={c.full} node={c} depth={depth + 1} bases={bases} />)}
    </>
  );
}

const countLeaves = (n: BranchNode): number => (n.branch && !n.children.size ? 1 : [...n.children.values()].reduce((a, c) => a + countLeaves(c), 0));

function Integrated() {
  const ri = useRepoIntegration();
  const prs = usePullRequests(ri);
  const issues = useIssues(ri);
  const { openPrefs } = useStore.getState();
  if (!ri) {
    return (
      <Section id="prs" title="Pull Requests" icon={<GitPullRequest size={12} />}>
        <div className="hint-box">
          Connect GitHub or GitLab to see pull requests and issues for this repository.{" "}
          <span className="link-text" onClick={() => openPrefs("integrations")}>Connect…</span>
        </div>
      </Section>
    );
  }
  const reload = (
    <button className="icon" title="Refresh" onClick={() => (prs.reload(), issues.reload())}>
      <RefreshCw size={12} />
    </button>
  );
  return (
    <>
      <Section id="prs" title="Pull Requests" count={prs.items?.length} icon={<GitPullRequest size={12} />} actions={reload}>
        {prs.error && <div className="hint-box error-text">{prs.error}</div>}
        {!prs.items && !prs.error && <div className="hint-box"><span className="spinner" /> Loading…</div>}
        {prs.items?.map((p) => (
          <div
            key={p.number}
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
              <span>{p.title}</span>
            </div>
            <div className="s">{p.author} · {p.source} → {p.target}</div>
          </div>
        ))}
        {prs.items?.length === 0 && <div className="empty small">No open pull requests</div>}
      </Section>
      <Section id="issues" title="Issues" count={issues.items?.length} icon={<CircleDot size={12} />} actions={reload}>
        {issues.error && <div className="hint-box error-text">{issues.error}</div>}
        {issues.items?.map((i) => (
          <div
            key={i.number}
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
              <span>{i.title}</span>
            </div>
            {i.labels.length > 0 && <div className="s">{i.labels.join(" · ")}</div>}
          </div>
        ))}
        {issues.items?.length === 0 && <div className="empty small">No open issues</div>}
      </Section>
    </>
  );
}

export default function RefsPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { repo, data } = useRepo();
  const refs = data?.refs;
  const { openMenu, run, select, ask, openPrefs } = useStore.getState();
  const [filter, setFilter] = useState("");
  const bases = useFlowBases();
  if (!refs) return <aside className="left" style={{ padding: 12 }}><div className="skeleton" /></aside>;
  const f = filter.toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  const jump = (oid: string | null) => oid && select({ kind: "commit", oid });
  const locals = refs.locals.filter((b) => match(b.name));
  const viewing = locals.length + refs.remoteBranches.filter((b) => match(b.name)).length + refs.tags.filter((t) => match(t.name)).length;

  const byRemote = new Map<string, typeof refs.remoteBranches>();
  for (const b of refs.remoteBranches) {
    if (!match(b.name)) continue;
    byRemote.set(b.remote, [...(byRemote.get(b.remote) ?? []), b]);
  }

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

  return (
    <aside className="left" style={{ width: "100%" }}>
      <div className="left-head">
        <span className="viewing">Viewing {viewing}</span>
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
        <Section id="local" title="Local" count={refs.locals.length} icon={<GitBranch size={12} />} actions={<button className="icon" title="New branch" onClick={() => A.newBranch()}><Plus size={13} /></button>}>
          {[...buildTree(locals).children.values()].map((n) => <BranchTree key={n.full} node={n} depth={0} bases={bases} />)}
        </Section>

        <Section id="remote" title="Remote" count={refs.remotes.length} icon={<Cloud size={12} />} actions={<button className="icon" title="Add remote" onClick={addRemote}><Plus size={13} /></button>}>
          {refs.remotes.map((rm) => (
            <div key={rm.name}>
              <div
                className="ref-item"
                title={rm.url ?? ""}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(e, [
                    { label: "Fetch", action: () => A.fetchAll() },
                    { label: "Copy URL", action: () => navigator.clipboard.writeText(rm.url ?? "") },
                    {
                      label: `Remove remote ${rm.name}…`,
                      danger: true,
                      action: async () => {
                        if (await ask({ title: "Remove remote", message: `Remove ${rm.name}?`, confirmLabel: "Remove", danger: true }))
                          await run("Remove remote", (r) => api.removeRemote(r, rm.name), { success: () => ({ title: t("remote.removed"), description: rm.name }) });
                      },
                    },
                  ]);
                }}
              >
                <Cloud size={13} />
                <span className="name">{rm.name}</span>
                <span className="meta">{(byRemote.get(rm.name) ?? []).length}</span>
              </div>
              {(byRemote.get(rm.name) ?? []).map((b) => (
                <div
                  key={b.name}
                  className="ref-item"
                  style={{ paddingLeft: 30 }}
                  onClick={() => jump(b.oid)}
                  onDoubleClick={() => A.checkout(b.name, true)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(e, A.remoteBranchMenu(b));
                  }}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/kc-branch", b.name)}
                >
                  <GitBranch size={13} />
                  <span className="name">{b.branch}</span>
                </div>
              ))}
            </div>
          ))}
          {!refs.remotes.length && <div className="empty small">No remotes</div>}
        </Section>

        {repo && <Integrated />}

        <Section id="tags" title="Tags" count={refs.tags.length} icon={<Tag size={12} />}>
          {refs.tags.filter((t) => match(t.name)).map((t) => (
            <div
              key={t.name}
              className="ref-item"
              onClick={() => jump(t.oid)}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(e, [
                  { label: `Checkout ${t.name}`, action: () => A.checkout(t.name) },
                  { label: `Delete tag ${t.name}`, danger: true, action: () => run("Delete tag", (r) => api.deleteTag(r, t.name), { success: () => ({ title: tr("tag.deleted"), description: t.name }) }) },
                ]);
              }}
            >
              <Tag size={13} />
              <span className="name">{t.name}</span>
            </div>
          ))}
        </Section>

        <Section id="stashes" title="Stashes" count={refs.stashes.length} icon={<Archive size={12} />}>
          {refs.stashes.map((s) => (
            <div
              key={s.oid}
              className="ref-item"
              onClick={() => select({ kind: "commit", oid: s.oid })}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(e, [
                  { label: "Apply stash", action: () => A.stashAction("apply", s.index, s.message) },
                  { label: "Pop stash", action: () => A.stashAction("pop", s.index, s.message) },
                  { label: "Delete stash", danger: true, action: () => A.stashAction("drop", s.index, s.message) },
                ]);
              }}
              title={s.message}
            >
              <Archive size={13} />
              <span className="name">{s.message}</span>
            </div>
          ))}
        </Section>

        {refs.submodules.length > 0 && (
          <Section id="submodules" title="Submodules" count={refs.submodules.length} icon={<Boxes size={12} />}>
            {refs.submodules.map((s) => (
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
                <span className="name">{s.name}</span>
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
