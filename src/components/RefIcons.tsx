import { Check, Cloud, Laptop, Tag } from "lucide-react";
import { RefLabel } from "../api";
import { useRepo } from "../store";

/** Where a ref lives, as a sentence for tooltips: "local + origin". */
export function refWhere(r: RefLabel) {
  if (r.kind === "tag") return "tag";
  if (r.kind === "head") return "detached HEAD";
  const parts = r.kind === "local" ? ["local", ...r.remotes] : r.remotes;
  return parts.join(" + ");
}

/** Ahead/behind of a local branch against its upstream (from the refs list). */
export function useSync(r: RefLabel) {
  const { data } = useRepo();
  if (r.kind !== "local") return null;
  const b = data?.refs?.locals.find((x) => x.name === r.name);
  return b && (b.ahead || b.behind) ? { ahead: b.ahead, behind: b.behind, upstream: b.upstream } : null;
}

/**
 * Leading icon + location markers for a ref:
 * ✓ current · 💻 exists locally · ☁ per remote at this same commit.
 */
export function RefIcons({ r, size = 11, lead = true }: { r: RefLabel; size?: number; lead?: boolean }) {
  const sync = useSync(r);
  return (
    <>
      {lead && (r.current ? <Check size={size} strokeWidth={3} /> : r.kind === "tag" ? <Tag size={size} /> : null)}
      {r.kind === "local" && <Laptop size={size} className="ref-loc" aria-label="local" />}
      {r.remotes.map((rm) => (
        <span key={rm} className="ref-remote" title={rm}>
          <Cloud size={size} />
          {r.remotes.length > 1 && <i>{rm.slice(0, 1)}</i>}
        </span>
      ))}
      {sync && (
        <span className="ref-sync" title={`${sync.ahead} ahead, ${sync.behind} behind ${sync.upstream ?? "upstream"}`}>
          {sync.ahead > 0 && `↑${sync.ahead}`}
          {sync.behind > 0 && `↓${sync.behind}`}
        </span>
      )}
    </>
  );
}
