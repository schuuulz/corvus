import { useEffect } from "react";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { t } from "../i18n";
import { NoteSection } from "../releaseNotes";
import { UpdateRelease, UpdateState, useStore } from "../store";
import { installUpdate, postponeUpdate } from "../updater";
import Logo from "./Logo";

/** The phases the overlay shows; a postponed update lives in the status bar. */
type ShownUpdate = Exclude<UpdateState, { phase: "postponed" }>;

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** Download progress in 0..1, or null while the size is unknown. */
function progressOf(u: ShownUpdate): number | null {
  if (u.phase === "available") return 0;
  if (u.phase !== "downloading") return 1;
  return u.total ? Math.min(1, u.done / u.total) : null;
}

function statusOf(u: ShownUpdate): string {
  switch (u.phase) {
    case "available":
      return t("update.prompt");
    case "downloading":
      return u.total ? t("update.downloading", { done: megabytes(u.done), total: megabytes(u.total) }) : t("update.downloadingSize", { done: megabytes(u.done) });
    case "installing":
      return t("update.installing");
    case "relaunching":
      return t("update.relaunching");
    case "failed":
      return t("update.failed");
  }
}

/**
 * How the ring around the mark reads: still while the update is offered,
 * filling with the download, spinning while the amount of work is unknown,
 * closed once installed, red when it failed.
 */
type Ring = "idle" | "progress" | "busy" | "done" | "failed";

function ringOf(u: ShownUpdate): Ring {
  switch (u.phase) {
    case "available":
      return "idle";
    case "downloading":
      return u.total ? "progress" : "busy";
    case "installing":
      return "busy";
    case "relaunching":
      return "done";
    case "failed":
      return "failed";
  }
}

const RING_RADIUS = 46;

function UpdateEmblem({ update }: { update: ShownUpdate }) {
  const ring = ringOf(update);
  const filled = ring === "progress" ? progressOf(update) ?? 0 : 1;
  return (
    <div className={`update-emblem ${ring}`}>
      <svg className="update-ring" viewBox="0 0 100 100" aria-hidden>
        <circle className="update-ring-track" cx={50} cy={50} r={RING_RADIUS} />
        {/* Starts at twelve o'clock and runs clockwise. */}
        <circle className="update-ring-arc" cx={50} cy={50} r={RING_RADIUS} pathLength={1} strokeDashoffset={1 - filled} transform="rotate(-90 50 50)" />
      </svg>
      <Logo size={58} />
      {ring === "done" && (
        <span className="update-badge" aria-hidden>
          <Check size={13} strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function VersionChange({ release }: { release: UpdateRelease }) {
  return (
    <div className="update-versions" aria-label={t("update.from", { current: release.current, version: release.version })}>
      <span>{release.current}</span>
      <ArrowRight size={12} aria-hidden />
      <span className="update-version-next">{release.version}</span>
    </div>
  );
}

/** A thin bar under the emblem while the update downloads and installs. */
function DownloadProgress({ update }: { update: ShownUpdate }) {
  const progress = progressOf(update);
  const known = progress !== null && update.phase === "downloading";
  return (
    <div className="update-progress">
      <div className={`update-bar${known ? "" : " indeterminate"}`}>
        <span style={known ? { transform: `scaleX(${progress})` } : undefined} />
      </div>
      {known && <span className="update-percent">{Math.floor(progress * 100)}%</span>}
    </div>
  );
}

/** "What's new", closed by default. Notes come from the manifest: plain text only. */
function ReleaseNotes({ notes }: { notes: NoteSection[] }) {
  if (!notes.length) return null;
  return (
    <details className="update-notes">
      <summary>
        <ChevronRight size={13} aria-hidden />
        {t("update.whatsNew")}
      </summary>
      <div className="update-notes-body">
        {notes.map((section, i) => (
          <section key={i}>
            {section.title && <h4>{section.title}</h4>}
            <ul>
              {section.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/** Escape postpones the update while the overlay waits for an answer. */
function usePostponeOnEscape(waiting: boolean) {
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") postponeUpdate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waiting]);
}

/** Offers the update found on launch, then shows it download, install and restart. */
export default function UpdateOverlay() {
  const update = useStore((s) => s.update);
  const waiting = update?.phase === "available" || update?.phase === "failed";
  usePostponeOnEscape(waiting);
  if (!update || update.phase === "postponed") return null;
  const { release } = update;
  const title = update.phase === "available" ? t("update.available", { version: release.version }) : t("update.title", { version: release.version });
  const working = update.phase === "downloading" || update.phase === "installing" || update.phase === "relaunching";
  return (
    <div className="modal-back update-back">
      <div className="modal update-modal" role={waiting ? "dialog" : "status"} aria-live="polite">
        <UpdateEmblem update={update} />
        <h3>{title}</h3>
        <VersionChange release={release} />
        {working && <DownloadProgress update={update} />}
        <p className={`update-status small ${update.phase === "failed" ? "error-text" : "muted"}`}>{statusOf(update)}</p>
        {update.phase === "available" && (
          <>
            <ReleaseNotes notes={release.notes} />
            <div className="modal-actions">
              <button onClick={postponeUpdate}>{t("update.later")}</button>
              <button className="primary" autoFocus onClick={installUpdate}>
                {t("update.install")}
              </button>
            </div>
          </>
        )}
        {update.phase === "failed" && (
          <>
            <p className="muted small update-error">{update.message}</p>
            <div className="modal-actions">
              <button onClick={postponeUpdate}>{t("update.continue")}</button>
              <button className="primary" autoFocus onClick={installUpdate}>
                {t("update.retry")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
