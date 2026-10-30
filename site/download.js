// Picks the right installer of the latest Corvus release for this computer.
// Release data comes from GitHub's public API; everything it returns is
// treated as untrusted text and only links into this repository's releases.

const REPO = "schuuulz/corvus";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

/** Installers people download, by platform; signatures and updater bundles are left out. */
const INSTALLERS = [
  { id: "windows-exe", os: "windows", label: "Windows", detail: "Installer (.exe)", match: /_x64-setup\.exe$/ },
  { id: "windows-msi", os: "windows", label: "Windows", detail: "MSI package", match: /_x64_[\w-]+\.msi$/ },
  { id: "mac-arm", os: "mac", arch: "arm", label: "macOS · Apple Silicon", detail: "Disk image (.dmg)", match: /_aarch64\.dmg$/ },
  { id: "mac-intel", os: "mac", arch: "x86", label: "macOS · Intel", detail: "Disk image (.dmg)", match: /_x64\.dmg$/ },
  { id: "linux-appimage", os: "linux", label: "Linux", detail: "AppImage (updates itself)", match: /\.AppImage$/ },
  { id: "linux-deb", os: "linux", label: "Linux", detail: "Debian / Ubuntu (.deb)", match: /\.deb$/ },
  { id: "linux-rpm", os: "linux", label: "Linux", detail: "Fedora / openSUSE (.rpm)", match: /\.rpm$/ },
];

/** The operating system and, when the browser says, the CPU family. */
async function detectPlatform() {
  const hints = navigator.userAgentData;
  let platform = (hints?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  let arch = null;
  if (hints?.getHighEntropyValues) {
    try {
      arch = (await hints.getHighEntropyValues(["architecture"])).architecture || null;
    } catch {
      arch = null;
    }
  }
  if (!platform) platform = ua;
  if (platform.includes("win")) return { os: "windows", arch };
  if (platform.includes("mac") || ua.includes("mac os x")) return { os: "mac", arch };
  if (platform.includes("linux") && !ua.includes("android")) return { os: "linux", arch };
  return { os: null, arch };
}

/** The release's installers that point into this repository, by INSTALLERS id, in INSTALLERS order. */
function installersOf(release) {
  const found = new Map();
  for (const kind of INSTALLERS) {
    const asset = (release.assets ?? []).find((a) => kind.match.test(String(a.name ?? "")) && String(a.browser_download_url ?? "").startsWith(DOWNLOAD_PREFIX));
    if (asset) found.set(kind.id, { ...kind, url: asset.browser_download_url, size: Number(asset.size) || 0 });
  }
  return found;
}

/** Installers to offer first: one per OS, both Macs when the CPU is unknown. */
function recommended(installers, { os, arch }) {
  if (os === "windows") return [installers.get("windows-exe")];
  if (os === "linux") return [installers.get("linux-appimage")];
  if (os === "mac") {
    if (arch === "arm") return [installers.get("mac-arm")];
    if (arch === "x86") return [installers.get("mac-intel")];
    return [installers.get("mac-arm"), installers.get("mac-intel")];
  }
  return [];
}

const megabytes = (bytes) => (bytes ? `${(bytes / 1_048_576).toFixed(0)} MB` : "");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function downloadButton(installer, version, primary) {
  const meta = [version, megabytes(installer.size)].filter(Boolean).join(" · ");
  return el(
    "a",
    { class: primary ? "button" : "button secondary", href: installer.url, rel: "noopener" },
    `Download for ${installer.label}`,
    el("small", {}, meta),
  );
}

function showRelease(release, platform) {
  const installers = installersOf(release);
  const version = String(release.tag_name ?? "").replace(/^corvus-/, "");
  const first = recommended(installers, platform).filter(Boolean);
  const box = document.getElementById("download");
  box.replaceChildren(...first.map((installer, i) => downloadButton(installer, version, i === 0)));
  if (!first.length) box.replaceChildren(el("p", { class: "status" }, "Choose your platform below."));

  const list = document.getElementById("other-list");
  list.replaceChildren(
    ...[...installers.values()]
      .filter((installer) => !first.includes(installer))
      .map((installer) =>
        el("li", {}, el("a", { href: installer.url, rel: "noopener" }, `${installer.label}: ${installer.detail}`), el("span", { class: "meta" }, megabytes(installer.size))),
      ),
  );
  document.getElementById("others").hidden = list.children.length === 0;

  const sums = (release.assets ?? []).find((a) => a.name === "SHA256SUMS.txt" && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX));
  if (sums) document.getElementById("checksums").href = sums.browser_download_url;
}

function showFallback() {
  const box = document.getElementById("download");
  box.replaceChildren(el("a", { class: "button", href: `https://github.com/${REPO}/releases/latest`, rel: "noopener" }, "Download from GitHub Releases"));
}

async function main() {
  try {
    const [platform, response] = await Promise.all([detectPlatform(), fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } })]);
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    showRelease(await response.json(), platform);
  } catch {
    showFallback();
  }
}

main();
