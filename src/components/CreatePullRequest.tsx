import { FormEvent, KeyboardEvent, ReactNode, useEffect, useState } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, GitBranch, GitPullRequest, Link2, UploadCloud } from "lucide-react";
import * as A from "../actions";
import { IntegrationKind, PullRequest } from "../api";
import { usePullRequests, useRepoIntegration } from "../hooks";
import { t } from "../i18n";
import { reviewRef, tReview } from "../reviews";
import { RepoIntegration, useRepo, useStore } from "../store";

interface Props {
  branch: string;
  /** Preselected target, e.g. the branch picked in the graph menu. */
  base?: string;
}

/** A pull request just opened, with the provider it was opened on. */
interface Created {
  pr: PullRequest;
  kind: IntegrationKind;
}

const close = () => useStore.getState().set({ modal: null });

/**
 * Pull request (merge request on GitLab) dialog for `branch`: the form while
 * the account may open one, then the one it opened, without leaving Corvus.
 */
export default function CreatePullRequest({ branch, base }: Props) {
  const ri = useRepoIntegration();
  const [created, setCreated] = useState<Created | null>(null);
  const allowed = !!ri?.access?.canPush;
  // Every entry point is gated on access; close if it is lost meanwhile
  // (e.g. the integration was disconnected), unless there is a result to show.
  useEffect(() => {
    if (!allowed && !created) close();
  }, [allowed, created]);
  if (created) {
    return (
      <div className="modal-back" onMouseDown={close}>
        <CreatedView {...created} />
      </div>
    );
  }
  if (!ri?.access?.canPush) return null;
  return (
    <div className="modal-back" onMouseDown={close}>
      <PullRequestForm host={ri} defaultBranch={ri.access.defaultBranch} branch={branch} base={base} onCreated={(pr) => setCreated({ pr, kind: ri.integration.kind })} />
    </div>
  );
}

/** Suggests a title from the branch name: "feat/user-login" → "user login". */
const titleFromBranch = (branch: string) => branch.split("/").pop()?.replace(/[-_]/g, " ") || branch;

/** A branch name set in a chip, truncated with the full name on hover. */
function BranchChip({ name, picker, children }: { name: string; picker?: boolean; children?: ReactNode }) {
  return (
    <span className={`pr-branch${picker ? " picker" : ""}`} title={name}>
      <GitBranch size={12} aria-hidden />
      {children ?? <span className="pr-branch-name">{name}</span>}
    </span>
  );
}

/** "source → target": what the pull request merges, and where. */
function BranchFlow({ source, target }: { source: string; target: ReactNode }) {
  return (
    <div className="pr-flow">
      <BranchChip name={source} />
      <ArrowRight size={14} className="pr-flow-arrow" aria-hidden />
      {target}
    </div>
  );
}

/** The target branch, picked from the hosting remote's branches. */
function TargetPicker({ targets, target, onChange }: { targets: string[]; target: string; onChange: (target: string) => void }) {
  return (
    <BranchChip name={target} picker>
      <select className="pr-branch-name" aria-label={t("pr.dialog.to")} value={target} onChange={(e) => onChange(e.target.value)}>
        {targets.map((b) => (
          <option key={b}>{b}</option>
        ))}
      </select>
      <ChevronDown size={12} aria-hidden />
    </BranchChip>
  );
}

function PullRequestForm({ host, defaultBranch, branch, base, onCreated }: Props & { host: RepoIntegration; defaultBranch: string; onCreated: (pr: PullRequest) => void }) {
  const { data } = useRepo();
  const pulls = usePullRequests(host);
  const { kind } = host.integration;
  const targets = A.remoteBranchNames(host.remoteName)
    .filter((b) => b !== branch)
    .sort();
  const [target, setTarget] = useState(() => [base, defaultBranch].find((b) => b && targets.includes(b)) ?? targets[0] ?? "");
  const [title, setTitle] = useState(() => titleFromBranch(branch));
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);

  const local = data?.refs?.locals.find((b) => b.name === branch);
  const hostedTip = data?.refs?.remoteBranches.find((b) => b.remote === host.remoteName && b.branch === branch)?.oid;
  const needsPush = !!local && local.oid !== hostedTip;
  const existing = pulls.items?.find((p) => p.source === branch && p.target === target);
  const ready = !busy && !existing && !!target && !!title.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const created = await A.createPullRequest(host, { source: branch, target, title: title.trim(), body, draft }, needsPush);
    setBusy(false);
    if (created) onCreated(created);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  };

  return (
    <form className="modal pr-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={onKeyDown}>
      <header className="pr-head">
        <span className="pr-head-icon" aria-hidden>
          <GitPullRequest size={16} />
        </span>
        <div className="grow">
          <h3>{tReview("pr.dialog.title", kind)}</h3>
          <p className="muted small">
            {host.integration.host} · {host.remote.path}
          </p>
        </div>
      </header>
      {targets.length ? (
        <BranchFlow source={branch} target={<TargetPicker targets={targets} target={target} onChange={setTarget} />} />
      ) : (
        <p className="error-text small">{t("pr.dialog.noTargets", { remote: host.remoteName })}</p>
      )}
      <label className="field">
        <span>{t("pr.dialog.titleField")}</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("pr.dialog.description")}</span>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        {t("pr.dialog.draft")}
      </label>
      {existing ? (
        <div className="modal-note">
          <GitPullRequest size={14} />
          <span className="grow">{t("pr.dialog.exists", { ref: reviewRef(kind, existing.number), source: branch, target })}</span>
          {existing.url && (
            <button type="button" onClick={() => void A.openExternal(existing.url)}>
              {t("pr.dialog.open", { ref: reviewRef(kind, existing.number) })}
            </button>
          )}
        </div>
      ) : (
        needsPush && (
          <div className="modal-note info">
            <UploadCloud size={14} />
            <span className="grow">{t("pr.dialog.push", { branch, remote: host.remoteName })}</span>
          </div>
        )
      )}
      <div className="modal-actions">
        <button type="button" onClick={close}>
          {t("pr.dialog.cancel")}
        </button>
        <button type="submit" className="primary" disabled={!ready}>
          {busy ? t("pr.dialog.creating") : tReview("pr.dialog.create", kind)}
        </button>
      </div>
    </form>
  );
}

/** Copies `url`, reporting it on the button for a moment. */
function useCopyLink(url: string) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      (e) => useStore.getState().toast(String(e), "error"),
    );
  return { copied, copy };
}

/** The pull request just opened: its number, what it merges, and its link. */
function CreatedView({ pr, kind }: Created) {
  const { copied, copy } = useCopyLink(pr.url);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") close();
  };
  return (
    <div className="modal pr-modal pr-created" role="dialog" aria-live="polite" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
      <span className="pr-created-icon" aria-hidden>
        <Check size={22} strokeWidth={2.5} />
      </span>
      <h3>{tReview("pr.success.title", kind, { ref: reviewRef(kind, pr.number) })}</h3>
      <p className="pr-created-title">{pr.title}</p>
      <BranchFlow source={pr.source} target={<BranchChip name={pr.target} />} />
      <div className="modal-actions">
        {/* No link when the provider sent one for another site (see integrations.rs). */}
        {pr.url && (
          <>
            <button type="button" onClick={copy}>
              {copied ? <Check size={13} /> : <Link2 size={13} />} {copied ? t("pr.success.copied") : t("pr.success.copy")}
            </button>
            <button type="button" onClick={() => void A.openExternal(pr.url)}>
              <ExternalLink size={13} /> {t("pr.success.open")}
            </button>
          </>
        )}
        <button type="button" className="primary" autoFocus onClick={close}>
          {t("pr.success.close")}
        </button>
      </div>
    </div>
  );
}
