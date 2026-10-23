import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { GitPullRequest, UploadCloud } from "lucide-react";
import * as A from "../actions";
import { usePullRequests, useRepoIntegration } from "../hooks";
import { t } from "../i18n";
import { RepoIntegration, useRepo, useStore } from "../store";

interface Props {
  branch: string;
  /** Preselected target, e.g. the branch picked in the graph menu. */
  base?: string;
}

const close = () => useStore.getState().set({ modal: null });

/** Pull request dialog for `branch`, shown while the account may open one. */
export default function CreatePullRequest({ branch, base }: Props) {
  const ri = useRepoIntegration();
  const allowed = !!ri?.access?.canPush;
  // Every entry point is gated on access; close if it is lost meanwhile
  // (e.g. the integration was disconnected).
  useEffect(() => {
    if (!allowed) close();
  }, [allowed]);
  if (!ri?.access?.canPush) return null;
  return (
    <div className="modal-back" onMouseDown={close}>
      <PullRequestForm host={ri} defaultBranch={ri.access.defaultBranch} branch={branch} base={base} />
    </div>
  );
}

/** Suggests a title from the branch name: "feat/user-login" → "user login". */
const titleFromBranch = (branch: string) => branch.split("/").pop()?.replace(/[-_]/g, " ") || branch;

function PullRequestForm({ host, defaultBranch, branch, base }: Props & { host: RepoIntegration; defaultBranch: string }) {
  const { data } = useRepo();
  const pulls = usePullRequests(host);
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
    if (created) close();
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
    <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={onKeyDown}>
      <h3>{t("pr.dialog.title")}</h3>
      <p className="muted small">
        {host.integration.host} · {host.remote.path}
      </p>
      {targets.length ? (
        <label className="field">
          <span>{t("pr.dialog.into", { source: branch })}</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
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
          <span className="grow">{t("pr.dialog.exists", { number: existing.number, source: branch, target })}</span>
          <button type="button" onClick={() => void A.openExternal(existing.url)}>
            {t("pr.dialog.open", { number: existing.number })}
          </button>
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
          {busy ? t("pr.dialog.creating") : t("pr.dialog.create")}
        </button>
      </div>
    </form>
  );
}
