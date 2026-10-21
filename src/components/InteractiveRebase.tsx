import { useEffect, useState } from "react";
import { api, RebaseAction, RebaseCommit } from "../api";
import { shortSha, useStore } from "../store";
import { t } from "../i18n";

interface Item extends RebaseCommit { action: RebaseAction; newMessage: string }

const ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export default function InteractiveRebase({ base }: { base: string | null }) {
  const repo = useStore((s) => s.active)!;
  const head = useStore((s) => s.repos[repo]?.info?.headBranch ?? "HEAD");
  const { set, run } = useStore.getState();
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => set({ modal: null });

  useEffect(() => {
    api.rebaseCommits(repo, base).then(
      (cs) => setItems(cs.map((c) => ({ ...c, action: "pick", newMessage: c.message.trim() }))),
      (e) => setErr(String(e)),
    );
  }, [repo, base]);

  const update = (i: number, p: Partial<Item>) => setItems((xs) => xs && xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      if (!xs) return xs;
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const firstKept = items?.find((x) => x.action !== "drop");
  const invalid = !!firstKept && (firstKept.action === "squash" || firstKept.action === "fixup");

  const start = async () => {
    if (!items) return;
    const todo = items.map((x) => ({ oid: x.oid, action: x.action, message: x.action === "reword" ? x.newMessage + "\n" : undefined }));
    close();
    await run("Interactive rebase", (r) => api.rebaseInteractive(r, base, todo), { success: () => ({ title: t("rebaseI.title"), description: `${todo.length} commit(s)` }) });
  };

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Interactive rebase of {head}{base ? ` onto ${shortSha(base)}` : " (from root)"}</h3>
        <p className="muted">Commits are applied top to bottom (oldest first). Squash and fixup fold a commit into the one above it.</p>
        {err && <div className="error-text">{err}</div>}
        {!items && !err && <div className="muted">Loading…</div>}
        {items && (
          <div className="rebase-list">
            {items.map((x, i) => (
              <div key={x.oid} className={`rebase-row a-${x.action}`}>
                <div className="rebase-move">
                  <button className="icon" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                  <button className="icon" onClick={() => move(i, 1)} disabled={i === items.length - 1}>▼</button>
                </div>
                <select value={x.action} onChange={(e) => update(i, { action: e.target.value as RebaseAction })}>
                  {ACTIONS.map((a) => <option key={a}>{a}</option>)}
                </select>
                <span className="sha mono">{shortSha(x.oid)}</span>
                {x.action === "reword" ? (
                  <textarea className="grow" rows={2} value={x.newMessage} onChange={(e) => update(i, { newMessage: e.target.value })} />
                ) : (
                  <span className="grow">{x.summary}</span>
                )}
                <span className="muted">{x.author}</span>
              </div>
            ))}
            {!items.length && <div className="empty">No commits to rebase</div>}
          </div>
        )}
        {invalid && <div className="error-text">The first commit can't be squashed or fixed up: there is nothing above it to fold into.</div>}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" disabled={!items?.length || invalid} onClick={start}>Start rebase</button>
        </div>
      </div>
    </div>
  );
}
