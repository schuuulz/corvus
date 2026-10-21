import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Flame, GitBranchPlus, GitMerge, Loader2, Package, Workflow, X } from "lucide-react";
import { Gitflow } from "../api";
import * as A from "../actions";
import { t } from "../i18n";
import { g, useRepo, useStore } from "../store";

type Kind = A.FlowKind;

const KINDS: { kind: Kind; title: string; icon: React.ReactNode; base: (gf: Gitflow) => string; desc: "gitflow.feature.desc" | "gitflow.release.desc" | "gitflow.hotfix.desc" }[] = [
  { kind: "feature", title: "Feature", icon: <GitBranchPlus size={22} />, base: (gf) => gf.develop, desc: "gitflow.feature.desc" },
  { kind: "release", title: "Release", icon: <Package size={22} />, base: (gf) => gf.develop, desc: "gitflow.release.desc" },
  { kind: "hotfix", title: "Hotfix", icon: <Flame size={22} />, base: (gf) => gf.master, desc: "gitflow.hotfix.desc" },
];

const prefixOf = (gf: Gitflow, k: Kind) => (k === "feature" ? gf.feature : k === "release" ? gf.release : gf.hotfix);

/** Same rules git uses for branch names (check-ref-format), simplified. */
function validName(s: string) {
  return !!s && !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.lock$|\.$|^-/.test(s);
}

/** Inline Gitflow setup when the repo has no Gitflow config yet. */
function InitForm({ gf, onDone }: { gf: Gitflow; onDone: () => void }) {
  const { data } = useRepo();
  const locals = useMemo(() => new Set(data?.refs?.locals.map((b) => b.name) ?? []), [data?.refs]);
  const guess = (want: string[], fallback: string) => want.find((w) => locals.has(w)) ?? fallback;
  const [cfg, setCfg] = useState(() => ({
    master: locals.has(gf.master) ? gf.master : guess(["main", "master"], gf.master),
    develop: locals.has(gf.develop) ? gf.develop : guess(["develop", "dev"], gf.develop),
    feature: gf.feature,
    release: gf.release,
    hotfix: gf.hotfix,
    versionTag: gf.versionTag,
  }));
  const [busy, setBusy] = useState(false);
  const missing = (k: "master" | "develop") => !locals.has(cfg[k].trim());
  const field = (k: keyof typeof cfg, label: string, branch?: boolean) => (
    <label className="field">
      <span>{label}</span>
      <input className={branch && missing(k as "master") ? "invalid" : ""} list={branch ? "gf-locals" : undefined} value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
      {branch && missing(k as "master") && <span className="field-error">{t("gitflow.fieldMissing")}</span>}
    </label>
  );
  return (
    <div className="gf-init">
      <p className="muted">{t("gitflow.notInit")}</p>
      <datalist id="gf-locals">{[...locals].map((b) => <option key={b} value={b} />)}</datalist>
      <div className="gf-grid">
        {field("master", "Main / master", true)}
        {field("develop", "Develop", true)}
        {field("feature", "Feature prefix")}
        {field("release", "Release prefix")}
        {field("hotfix", "Hotfix prefix")}
        {field("versionTag", "Version tag prefix")}
      </div>
      <button
        className="primary"
        disabled={busy || missing("master") || missing("develop")}
        onClick={async () => {
          setBusy(true);
          if (await A.gitflowInit(cfg)) onDone();
          setBusy(false);
        }}
      >
        {busy ? <Loader2 size={14} className="spin" /> : <Workflow size={14} />} {t("gitflow.init")}
      </button>
    </div>
  );
}

/**
 * Gitflow launcher shown over the commit graph: pick feature / release /
 * hotfix, then name the branch. Opened from the ">" button on main branches
 * in the left panel.
 */
export default function GitflowPanel() {
  const panel = useStore((s) => s.gitflowPanel);
  const { repo, data } = useRepo();
  const gf = useStore((s) => (repo ? s.gitflow[repo] : undefined));
  const { set, loadGitflow } = useStore.getState();
  const [shown, setShown] = useState(panel);
  const [leaving, setLeaving] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Keep the last panel mounted while it fades out.
  useEffect(() => {
    if (panel) {
      setShown(panel);
      setLeaving(false);
      setKind(null);
      setName("");
      void loadGitflow();
    } else if (shown) {
      setLeaving(true);
      const tm = setTimeout(() => (setShown(null), setLeaving(false)), 180);
      return () => clearTimeout(tm);
    }
  }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (kind) setTimeout(() => input.current?.focus(), 30);
  }, [kind]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      kind ? setKind(null) : set({ gitflowPanel: null });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panel, kind, set]);

  if (!shown) return null;
  const close = () => set({ gitflowPanel: null });
  const locals = data?.refs?.locals.map((b) => b.name) ?? [];
  const inProgress = gf?.initialized
    ? KINDS.flatMap((k) => {
        const prefix = prefixOf(gf, k.kind);
        return locals.filter((b) => b.startsWith(prefix)).map((b) => ({ kind: k.kind, icon: k.icon, branch: b, name: b.slice(prefix.length) }));
      })
    : [];

  const full = gf && kind ? prefixOf(gf, kind) + name.trim() : "";
  const nameError = !name.trim() ? null : !validName(full) ? t("gitflow.nameInvalid") : locals.includes(full) ? t("gitflow.nameExists") : null;
  const create = async () => {
    if (!kind || !name.trim() || nameError || busy) return;
    setBusy(true);
    const ok = await A.gitflowStart(kind, name.trim());
    setBusy(false);
    if (ok) close();
  };

  return (
    <div className={`gf-overlay${leaving ? " leaving" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="gf-panel" role="dialog" aria-label="Gitflow">
        <div className="gf-head">
          {kind ? (
            <button className="icon" title={t("gitflow.back")} onClick={() => setKind(null)}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <Workflow size={18} className="gf-logo" />
          )}
          <div>
            <div className="gf-title">{kind ? KINDS.find((k) => k.kind === kind)!.title : t("gitflow.title")}</div>
            <div className="muted small">{t("gitflow.from", { base: kind && gf ? KINDS.find((k) => k.kind === kind)!.base(gf) : shown.base })}</div>
          </div>
          <span className="spacer" />
          <button className="icon" title="Esc" onClick={close}>
            <X size={16} />
          </button>
        </div>

        {gf === undefined || gf === null ? (
          <div className="gf-body"><div className="skeleton" style={{ height: 90 }} /></div>
        ) : !gf.initialized ? (
          <div className="gf-body">
            <InitForm gf={gf} onDone={() => void loadGitflow()} />
          </div>
        ) : !kind ? (
          <div className="gf-body">
            <div className="gf-cards">
              {KINDS.map((k) => (
                <button key={k.kind} className={`gf-card ${k.kind}`} onClick={() => setKind(k.kind)} disabled={!locals.includes(k.base(gf))}>
                  <span className="gf-card-icon">{k.icon}</span>
                  <b>{k.title}</b>
                  <span>{t(k.desc, { base: k.base(gf) })}</span>
                </button>
              ))}
            </div>
            <div className="gf-section">{t("gitflow.inProgress")}</div>
            {inProgress.length ? (
              <div className="gf-list">
                {inProgress.map((f) => (
                  <div key={f.branch} className="gf-item">
                    <span className={`gf-dot ${f.kind}`} />
                    <span className="gf-item-name">{f.branch}</span>
                    <button className="small" onClick={async () => (await A.gitflowFinish(f.kind, f.name)) && close()}>
                      <GitMerge size={12} /> {t("gitflow.finish")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">{t("gitflow.nothing")}</div>
            )}
          </div>
        ) : (
          <form
            className="gf-body"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="field">
              <span>{t("gitflow.name")}</span>
              <div className={`gf-name${nameError ? " invalid" : ""}`}>
                <span className="gf-prefix">{prefixOf(gf, kind)}</span>
                <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "feature" ? "login-page" : kind === "release" ? "1.2.0" : "fix-crash"} spellCheck={false} />
              </div>
              {nameError && <span className="field-error">{nameError}</span>}
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setKind(null)}>{t("gitflow.back")}</button>
              <button type="submit" className="primary" disabled={!name.trim() || !!nameError || busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <GitBranchPlus size={14} />} {t("gitflow.create")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Branch names the ">" Gitflow button appears on (configured or likely main branches). */
export function useFlowBases(): Set<string> {
  const { repo } = useRepo();
  const gf = useStore((s) => (repo ? s.gitflow[repo] : undefined));
  useEffect(() => {
    if (repo && gf === undefined) void useStore.getState().loadGitflow(repo);
  }, [repo, gf]);
  return useMemo(() => new Set(gf?.initialized ? [gf.master, gf.develop] : g("trunkBranches")), [gf]);
}
