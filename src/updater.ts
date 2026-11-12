// Offers updates on launch: when a newer release exists, UpdateOverlay asks
// whether to install it now. Postponed, it waits behind the status bar's
// "Restart to update". Installing downloads it, installs it and restarts
// Corvus on the new version.

import { check, DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ext } from "./api";
import { t } from "./i18n";
import { parseReleaseNotes } from "./releaseNotes";
import { UpdateRelease, UpdateState, useStore } from "./store";

const setUpdate = (update: UpdateState | null) => useStore.setState({ update });

/** What installing needs: the update found on launch, or the dev demo's stand-in. */
interface PendingUpdate {
  release: UpdateRelease;
  downloadAndInstall(onEvent: (e: DownloadEvent) => void): Promise<void>;
  restart(): Promise<void>;
}

/** The update found on launch, kept until it is installed. */
let pending: PendingUpdate | null = null;

function offer(update: PendingUpdate) {
  pending = update;
  setUpdate({ phase: "available", release: update.release });
}

export async function updateOnLaunch() {
  if (import.meta.env.DEV) return;
  // Offline, or a release without a manifest: try again next launch.
  const update = await check().catch(() => null);
  if (!update) return;
  if (!(await ext.updaterSupported())) {
    useStore.getState().notify({ kind: "info", title: t("update.available", { version: update.version }), description: t("update.manual") });
    return;
  }
  offer({
    release: { version: update.version, current: update.currentVersion, notes: parseReleaseNotes(update.body ?? "") },
    downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent),
    restart: relaunch,
  });
}

/** Installs the update found on launch now (also "Try again" after a failure). */
export function installUpdate() {
  if (pending) void install(pending);
}

/** Leaves the update for later, behind the status bar's "Restart to update". */
export function postponeUpdate() {
  if (pending) setUpdate({ phase: "postponed", release: pending.release });
}

/** Downloads and installs `update`, reporting progress, then restarts. */
async function install({ release, downloadAndInstall, restart }: PendingUpdate) {
  let done = 0;
  let total: number | null = null;
  let shownPercent = -1;
  setUpdate({ phase: "downloading", release, done, total });

  const onEvent = (e: DownloadEvent) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    if (e.event === "Progress") done += e.data.chunkLength;
    if (e.event === "Finished") return setUpdate({ phase: "installing", release });
    // Chunks arrive many times a second; repaint once per percent.
    const percent = total ? Math.floor((done / total) * 100) : Math.floor(done / 1_000_000);
    if (percent === shownPercent) return;
    shownPercent = percent;
    setUpdate({ phase: "downloading", release, done, total });
  };

  try {
    await downloadAndInstall(onEvent);
    setUpdate({ phase: "relaunching", release });
    await restart();
  } catch (e) {
    setUpdate({ phase: "failed", release, message: String(e) });
  }
}

const DEMO_NOTES = `## [9.9.9](https://example.com) (2026-11-12)

### Features

* **updater:** redesign the update dialog around the corvus mark ([#38](https://example.com)) ([abc1234](https://example.com))
* **pr:** create merge requests without leaving the app ([def5678](https://example.com))

### Bug Fixes

* **integrations:** validate hosts, repo paths and links from the api ([0a1b2c3](https://example.com))
`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 21 MB download in 600 KB chunks, then a short install. */
async function demoDownload(onEvent: (e: DownloadEvent) => void) {
  const total = 21_300_000;
  const chunk = 600_000;
  onEvent({ event: "Started", data: { contentLength: total } });
  for (let done = 0; done < total; done += chunk) {
    await wait(120);
    onEvent({ event: "Progress", data: { chunkLength: Math.min(chunk, total - done) } });
  }
  onEvent({ event: "Finished" });
  await wait(1500);
}

/**
 * Dev only (`VITE_UPDATE_DEMO=1 npm run tauri dev`): offers a fake release
 * through the real overlay and install flow, to work on them without one.
 */
export function playUpdateDemo() {
  offer({
    release: { version: "9.9.9", current: "0.7.0", notes: parseReleaseNotes(DEMO_NOTES) },
    downloadAndInstall: demoDownload,
    restart: async () => {
      await wait(2500);
      setUpdate(null);
    },
  });
}
