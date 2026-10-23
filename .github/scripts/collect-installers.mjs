// Copies the files tauri-action built into one flat directory, ready to sign
// or attach to the release.
//
//   node collect-installers.mjs <artifact-paths-json> <out-dir> [mac-arch]
//
// <artifact-paths-json> is tauri-action's `artifactPaths` output. Bundle
// directories (Corvus.app) are skipped. On macOS both architectures build a
// "Corvus.app.tar.gz" updater bundle, so it is renamed with <mac-arch>
// (aarch64 / x64), together with its signature.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const [pathsJson, outDir, macArch] = process.argv.slice(2);

mkdirSync(outDir, { recursive: true });
for (const path of JSON.parse(pathsJson)) {
  if (!statSync(path).isFile()) continue;
  const name = macArch ? basename(path).replace(".app.tar.gz", `_${macArch}.app.tar.gz`) : basename(path);
  copyFileSync(path, join(outDir, name));
  console.log(name);
}
