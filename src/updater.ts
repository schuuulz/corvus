// Offers updates on launch: when a newer release exists, UpdateOverlay asks
// whether to install it now. Postponed, it waits behind the status bar's
// "Restart to update". Installing downloads it, installs it and restarts
// Corvus on the new version.

import { check, DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ext } from "./api";
import { t } from "./i18n";
import { UpdateState, useStore } from "./store";

const setUpdate = (update: UpdateState | null) => useStore.setState({ update });

/** The update found on launch, kept until it is installed. */
let pending: Update | null = null;

export async function updateOnLaunch() {
  if (import.meta.env.DEV) return;
  // Offline, or a release without a manifest: try again next launch.
  const update = await check().catch(() => null);
  if (!update) return;
  if (!(await ext.updaterSupported())) {
    useStore.getState().notify({ kind: "info", title: t("update.available", { version: update.version }), description: t("update.manual") });
    return;
  }
  pending = update;
  setUpdate({ phase: "available", version: update.version });
}

/** Installs the update found on launch now (also "Try again" after a failure). */
export function installUpdate() {
  if (pending) void install(pending);
}

/** Leaves the update for later, behind the status bar's "Restart to update". */
export function postponeUpdate() {
  if (pending) setUpdate({ phase: "postponed", version: pending.version });
}

/** Downloads and installs `update`, reporting progress, then restarts. */
async function install(update: Update) {
  const { version } = update;
  let done = 0;
  let total: number | null = null;
  let shownPercent = -1;
  setUpdate({ phase: "downloading", version, done, total });

  const onEvent = (e: DownloadEvent) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    if (e.event === "Progress") done += e.data.chunkLength;
    if (e.event === "Finished") return setUpdate({ phase: "installing", version });
    // Chunks arrive many times a second; repaint once per percent.
    const percent = total ? Math.floor((done / total) * 100) : Math.floor(done / 1_000_000);
    if (percent === shownPercent) return;
    shownPercent = percent;
    setUpdate({ phase: "downloading", version, done, total });
  };

  try {
    await update.downloadAndInstall(onEvent);
    setUpdate({ phase: "relaunching", version });
    await relaunch();
  } catch (e) {
    setUpdate({ phase: "failed", version, message: String(e) });
  }
}

/**
 * Dev only (`VITE_UPDATE_DEMO=1 npm run tauri dev`): plays the update overlay
 * with a simulated download, to work on it without a release.
 */
export function playUpdateDemo() {
  const total = 21_300_000;
  let done = 0;
  const timer = setInterval(() => {
    done = Math.min(total, done + 600_000);
    if (done < total) return setUpdate({ phase: "downloading", version: "9.9.9", done, total });
    clearInterval(timer);
    setUpdate({ phase: "installing", version: "9.9.9" });
    setTimeout(() => setUpdate({ phase: "relaunching", version: "9.9.9" }), 1500);
    setTimeout(() => setUpdate(null), 4000);
  }, 120);
}
