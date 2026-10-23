import { t } from "../i18n";
import { UpdateState, useStore } from "../store";
import { dismissUpdate, retryUpdate } from "../updater";

// The scene: a graph lane drawn left to right as the download progresses,
// with a raven flying along it. Once downloaded, the raven lands on the last
// commit, which becomes the new version's label.
const WIDTH = 320;
const LANE_Y = 52;
const START = 20;
const END = 300;
const NODES = 5;
const nodeX = (i: number) => START + ((END - START) * i) / (NODES - 1);

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** Download progress in 0..1, or null while the size is unknown. */
function progressOf(u: UpdateState): number | null {
  if (u.phase !== "downloading") return 1;
  return u.total ? Math.min(1, u.done / u.total) : null;
}

function statusOf(u: UpdateState): string {
  switch (u.phase) {
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

/** An original raven silhouette, facing right, about 34×20 around its body. */
function Raven() {
  return (
    <>
      <path className="raven-tail" d="M-12 2 L-20 -3 L-19 5 Z" />
      <path className="raven-body" d="M-13 2 C-7 -4 4 -4 9 -2 L16 -4 L13 -0.5 C14 1 13 3 10 3 C5 7 -6 7 -13 2 Z" />
      <path className="raven-wing" d="M-2 -2 C-7 -12 -15 -13 -19 -9 C-13 -8 -8 -5 -6 0 Z" />
      <circle className="raven-eye" cx={10} cy={-1.5} r={0.9} />
    </>
  );
}

function Scene({ update }: { update: UpdateState }) {
  const progress = progressOf(update);
  const landed = update.phase === "installing" || update.phase === "relaunching";
  const ravenX = START + (END - START) * (progress ?? 0);
  return (
    <svg className={`update-scene${progress === null ? " indeterminate" : ""}${landed ? " landed" : ""}`} viewBox={`0 0 ${WIDTH} 80`} aria-hidden>
      <path className="update-lane" d={`M${START} ${LANE_Y} H${END}`} />
      <path className="update-lane-done" d={`M${START} ${LANE_Y} H${END}`} pathLength={1} strokeDashoffset={1 - (progress ?? 0)} />
      {Array.from({ length: NODES - 1 }, (_, i) => (
        <circle key={i} className={`update-node${progress !== null && progress >= i / (NODES - 1) ? " lit" : ""}`} cx={nodeX(i)} cy={LANE_Y} r={5} />
      ))}
      {landed ? (
        <g transform={`translate(${END} ${LANE_Y})`}>
          <g className="update-version">
            <rect x={-26} y={-9} width={52} height={18} rx={9} />
            <text textAnchor="middle" dy="0.35em">
              v{update.version}
            </text>
          </g>
        </g>
      ) : (
        <circle className="update-node" cx={END} cy={LANE_Y} r={5} />
      )}
      {/* Flies above the lane, then perches on the version label. */}
      <g className="raven-track" style={{ transform: `translate(${landed ? END : ravenX}px, ${landed ? LANE_Y - 15 : LANE_Y - 22}px)` }}>
        <g className="raven">
          <Raven />
        </g>
      </g>
    </svg>
  );
}

/** Shown while the update installed on launch downloads, installs and restarts. */
export default function UpdateOverlay() {
  const update = useStore((s) => s.update);
  if (!update) return null;
  return (
    <div className="modal-back update-back">
      <div className="modal update-modal" role="status" aria-live="polite">
        <h3>{t("update.title", { version: update.version })}</h3>
        <Scene update={update} />
        <p className={update.phase === "failed" ? "error-text small" : "muted small"}>{statusOf(update)}</p>
        {update.phase === "failed" && (
          <>
            <p className="muted small update-error">{update.message}</p>
            <div className="modal-actions">
              <button onClick={dismissUpdate}>{t("update.continue")}</button>
              <button className="primary" autoFocus onClick={retryUpdate}>
                {t("update.retry")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
