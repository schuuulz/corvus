import { useEffect, useState } from "react";
import { ext, Integration, IntegrationKind, Issue, PullRequest, RemoteRef } from "./api";
import { formatDate, fromNow } from "./format";
import { g, useG, useRepo, useStore } from "./store";

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

export interface RepoIntegration {
  integration: Integration;
  remote: RemoteRef;
}

/** Finds the connected integration serving the active repo's remotes. */
export function useRepoIntegration(): RepoIntegration | null {
  const { repo, data } = useRepo();
  const integrations = useG("integrations");
  const tracker = useStore((s) => (repo ? (s.settings.repos[repo]?.issueTracker as string | undefined) : undefined)) || g("defaultIssueTracker");
  const remotes = data?.refs?.remotes;
  const [found, setFound] = useState<RepoIntegration | null>(null);
  const key = JSON.stringify([remotes?.map((r) => r.url), integrations.map((i) => i.id), tracker]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!remotes?.length || !integrations.length) return setFound(null);
      const ordered = [...remotes].sort((a, b) => (a.name === "origin" ? -1 : b.name === "origin" ? 1 : 0));
      for (const rm of ordered) {
        if (!rm.url) continue;
        const parsed = await ext.parseRemote(rm.url).catch(() => null);
        if (!parsed) continue;
        const candidates = integrations.filter((i) => (HOSTS[i.kind] ?? i.host).toLowerCase() === parsed.host);
        const pick = candidates.find((i) => i.id === tracker) ?? candidates[0];
        if (pick) {
          if (live) setFound({ integration: pick, remote: parsed });
          return;
        }
      }
      if (live) setFound(null);
    })();
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return found;
}

interface Remote<T> { items: T[] | null; error: string | null; reload: () => void }

function useRemoteList<T>(ri: RepoIntegration | null, load: (ri: RepoIntegration) => Promise<T[]>): Remote<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = ri ? `${ri.integration.id}|${ri.remote.path}|${tick}` : "";
  useEffect(() => {
    if (!ri) {
      setItems(null);
      return;
    }
    let live = true;
    setError(null);
    load(ri).then((x) => live && setItems(x), (e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, error, reload: () => setTick((t) => t + 1) };
}

export const usePullRequests = (ri: RepoIntegration | null) =>
  useRemoteList<PullRequest>(ri, ({ integration: i, remote }) => ext.pulls(i.kind, i.host, remote.path));

export const useIssues = (ri: RepoIntegration | null) =>
  useRemoteList<Issue>(ri, ({ integration: i, remote }) => ext.issues(i.kind, i.host, remote.path));

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
