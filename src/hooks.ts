import { useEffect, useState } from "react";
import { ext, Integration, IntegrationKind, Issue, PullRequest, Remote, RemoteRepo } from "./api";
import { formatDate, fromNow } from "./format";
import { g, RepoIntegration, useG, useRepo, useStore } from "./store";

export type DateKind = "date" | "word" | "datetime" | "verbose";

/** Formats unix seconds according to the UI Customization settings. */
export function useDateFormat() {
  const locale = useG("dateLocale");
  const style = useG("dateStyle");
  const fmts = {
    date: useG("dateFormat"),
    word: useG("dateWordFormat"),
    datetime: useG("dateTimeFormat"),
    verbose: useG("dateVerboseFormat"),
  };
  return (secs: number, kind: DateKind = "datetime", forceAbsolute = false) =>
    style === "relative" && !forceAbsolute && kind === "datetime" ? fromNow(secs, locale) : formatDate(secs, fmts[kind], locale);
}

/** Hosts a provider kind serves by default. */
const HOSTS: Partial<Record<IntegrationKind, string>> = { github: "github.com", gitlab: "gitlab.com" };

type Hosting = Omit<RepoIntegration, "access">;

/** The connected integration serving one of `remotes`: origin first, the repo's issue tracker preferred. */
async function findHosting(remotes: Remote[], integrations: Integration[], tracker: string): Promise<Hosting | null> {
  const ordered = [...remotes].sort((a, b) => (a.name === "origin" ? -1 : b.name === "origin" ? 1 : 0));
  for (const rm of ordered) {
    if (!rm.url) continue;
    const parsed = await ext.parseRemote(rm.url).catch(() => null);
    if (!parsed) continue;
    const candidates = integrations.filter((i) => (HOSTS[i.kind] ?? i.host).toLowerCase() === parsed.host);
    const pick = candidates.find((i) => i.id === tracker) ?? candidates[0];
    if (pick) return { integration: pick, remote: parsed, remoteName: rm.name };
  }
  return null;
}

/**
 * Keeps the active repo's hosted repository, and what the account may do
 * there, in the store, where components and menus both read it.
 */
export function useRepoIntegrationSync() {
  const { repo, data } = useRepo();
  const integrations = useG("integrations");
  const tracker = useStore((s) => (repo ? (s.settings.repos[repo]?.issueTracker as string | undefined) : undefined)) || g("defaultIssueTracker");
  const remotes = data?.refs?.remotes;
  const key = JSON.stringify([repo, remotes?.map((r) => [r.name, r.url]), integrations.map((i) => i.id), tracker]);

  useEffect(() => {
    if (!repo) return;
    let live = true;
    const publish = (ri: RepoIntegration | null) => {
      if (live) useStore.setState((s) => ({ repoIntegration: { ...s.repoIntegration, [repo]: ri } }));
    };
    (async () => {
      const hosting = remotes?.length && integrations.length ? await findHosting(remotes, integrations, tracker) : null;
      if (!hosting) return publish(null);
      publish({ ...hosting, access: null });
      const { integration: i, remote } = hosting;
      // Unreachable or unknown access counts as none: PR actions stay hidden.
      const access = await ext.repoAccess(i.kind, i.host, remote.path).catch(() => null);
      publish({ ...hosting, access });
    })();
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The connected integration serving the active repo, if any. */
export const useRepoIntegration = () => useStore((s) => (s.active ? s.repoIntegration[s.active] ?? null : null));

interface RemoteList<T> { items: T[] | null; error: string | null; reload: () => void }

/**
 * A list loaded from `source`, and again whenever `key` changes (it names
 * the source, plus anything that should trigger a reload). With no source
 * there is nothing to list.
 */
function useRemoteList<S, T>(source: S | null, key: string, load: (source: S) => Promise<T[]>): RemoteList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!source) {
      setItems(null);
      return;
    }
    let live = true;
    setError(null);
    load(source).then((x) => live && setItems(x), (e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [source ? key : null, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, error, reload: () => setTick((t) => t + 1) };
}

const hostedRepoKey = (ri: RepoIntegration | null) => (ri ? `${ri.integration.id}|${ri.remote.path}` : "");

/** Reloads when a pull request is created (`pullRequestsVersion`). */
export function usePullRequests(ri: RepoIntegration | null) {
  const version = useStore((s) => s.pullRequestsVersion);
  return useRemoteList<RepoIntegration, PullRequest>(ri, `${hostedRepoKey(ri)}|${version}`, ({ integration: i, remote }) => ext.pulls(i.kind, i.host, remote.path));
}

export const useIssues = (ri: RepoIntegration | null) =>
  useRemoteList<RepoIntegration, Issue>(ri, hostedRepoKey(ri), ({ integration: i, remote }) => ext.issues(i.kind, i.host, remote.path));

/** A repository to clone, with the server it lives on. */
export interface HostedRepo extends RemoteRepo { host: string }

async function listRepos(accounts: Integration[]): Promise<HostedRepo[]> {
  const perAccount = await Promise.all(
    accounts.map(async (i) => (await ext.repositories(i.kind, i.host)).map((repo) => ({ ...repo, host: i.host }))),
  );
  return perAccount.flat();
}

/** The repositories the connected `accounts` can clone. */
export const useCloneableRepos = (accounts: Integration[]) =>
  useRemoteList<Integration[], HostedRepo>(accounts.length ? accounts : null, accounts.map((i) => i.id).join(","), listRepos);

/** True when the viewport is narrower than `px`. */
export function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return narrow;
}

const avatarCache = new Map<string, Promise<string>>();

/**
 * Avatar URL for a commit author:
 * - GitHub noreply addresses (`123+user@users.noreply.github.com`) map to the
 *   account's GitHub avatar;
 * - anything else uses Gravatar (SHA-256), with `d=404` so callers fall back
 *   to initials when there is no picture.
 * Resolved once per email.
 */
function avatarUrl(email: string): Promise<string> {
  const key = email.trim().toLowerCase();
  let hit = avatarCache.get(key);
  if (!hit) {
    const gh = key.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
    hit = gh
      ? Promise.resolve(gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=64&v=4` : `https://github.com/${gh[2]}.png?size=64`)
      : crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)).then((buf) => {
          const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
          return `https://www.gravatar.com/avatar/${hex}?s=64&d=404`;
        });
    avatarCache.set(key, hit);
  }
  return hit;
}

/** Author avatar URL when avatars are enabled (Preferences › UI), else null. */
export function useAvatar(email: string): string | null {
  const enabled = useG("useAvatars");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !email) return setUrl(null);
    let live = true;
    void avatarUrl(email).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [email, enabled]);
  return enabled ? url : null;
}
