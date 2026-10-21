// Turns operation outcomes into user-facing feedback (title + description,
// success / warning / info). Used as `run(..., { success })` callbacks.

import type { OpOutcome } from "./api";
import { MsgKey, t } from "./i18n";
import type { Feedback } from "./store";

const listFiles = (files: string[]) => (files.length > 3 ? `${files.slice(0, 3).join(", ")} +${files.length - 3}` : files.join(", "));

/** Conflicts stop an operation part-way: report them as a warning. */
function conflicts(o: OpOutcome): Feedback | null {
  if (o.status !== "warning") return null;
  return { kind: "warning", title: t("op.conflicts.title"), description: t("op.conflicts.desc", { count: o.conflicts.length, files: listFiles(o.conflicts) }) };
}

export const fb = {
  simple: (key: MsgKey, description?: string, vars?: Record<string, string | number>) => (): Feedback => ({ title: t(key, vars), description }),

  checkout: (o: OpOutcome): Feedback => {
    const detached = !!o.to && /^[0-9a-f]{7}$/.test(o.to);
    const remote = o.detail.startsWith("tracking ") ? o.detail.slice(9) : null;
    return {
      title: t(detached ? "checkout.commit.title" : "checkout.title"),
      description: remote ? t("checkout.tracking", { from: o.from, to: o.to, remote }) : t("checkout.desc", { from: o.from ?? "—", to: o.to }),
    };
  },

  fetch: (o: OpOutcome): Feedback =>
    o.status === "noop" ? { kind: "info", title: t("fetch.title"), description: t("fetch.noop") } : { title: t("fetch.title"), description: t("fetch.desc", { count: o.count ?? 0 }) },

  pull: (o: OpOutcome): Feedback =>
    conflicts(o) ??
    (o.status === "noop"
      ? { kind: "info", title: t("pull.noop.title"), description: t("pull.noop.desc", { branch: o.from }) }
      : { title: t("pull.title"), description: t("pull.desc", { branch: o.from, count: o.count ?? 0 }) }),

  push: (o: OpOutcome): Feedback => ({
    title: t("push.title"),
    description: o.count ? t("push.descCount", { count: o.count, from: o.from, to: o.to ?? "" }) : t("push.desc", { from: o.from, to: o.to ?? "" }),
  }),

  merge: (squash: boolean) => (o: OpOutcome): Feedback =>
    conflicts(o) ??
    (o.status === "noop"
      ? { kind: "info", title: t("merge.noop"), description: t("merge.desc", { from: o.from, to: o.to }) }
      : squash
        ? { kind: "info", title: t("merge.squash.title"), description: t("merge.squash.desc", { from: o.from, to: o.to }) }
        : { title: t("merge.title"), description: t("merge.desc", { from: o.from, to: o.to }) }),

  rebase: (o: OpOutcome): Feedback =>
    conflicts(o) ??
    (o.status === "noop"
      ? { kind: "info", title: t("rebase.noop", { to: o.to }) }
      : { title: t("rebase.title"), description: t("rebase.desc", { from: o.from, to: o.to }) }),

  onto: (key: "cherry.title" | "revert.title") => (o: OpOutcome): Feedback =>
    conflicts(o) ?? { title: t(key), description: t("commitOnto.desc", { from: o.from, to: o.to }) },

  stash: (action: "apply" | "pop" | "drop") => (o: OpOutcome): Feedback =>
    conflicts(o) ?? { title: t(action === "pop" ? "stash.pop" : action === "apply" ? "stash.apply" : "stash.drop") },

  commit: (amend: boolean) => (o: OpOutcome): Feedback => ({
    title: t(amend ? "amend.title" : "commit.title"),
    description: t("commit.desc", { sha: o.to, summary: o.detail }),
  }),
};
