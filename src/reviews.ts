// How each provider names the review Corvus opens: GitHub's pull requests
// ("#42") and GitLab's merge requests ("!42"). Every place that shows one
// goes through here, so the app speaks the provider's language.

import { IntegrationKind } from "./api";
import { MsgKey, t } from "./i18n";

type Review = "pull" | "merge";

const reviewOf = (kind: IntegrationKind): Review => (kind === "gitlab" || kind === "gitlab-self" ? "merge" : "pull");

/** "#42" on GitHub, "!42" on GitLab. */
export const reviewRef = (kind: IntegrationKind, number: number) => `${reviewOf(kind) === "merge" ? "!" : "#"}${number}`;

/** `t(key, vars)` with `{noun}` ("merge request") and `{Noun}` ("Merge request") filled in for `kind`. */
export function tReview(key: MsgKey, kind: IntegrationKind, vars: Record<string, string | number> = {}): string {
  const noun = t(reviewOf(kind) === "merge" ? "pr.noun.merge" : "pr.noun.pull");
  return t(key, { noun, Noun: noun.charAt(0).toUpperCase() + noun.slice(1), ...vars });
}
