<p align="center">
  <img src="app-icon.svg" width="96" alt="kraken-craft logo" />
</p>

<h1 align="center">kraken-craft</h1>

<p align="center">A fast, friendly desktop Git client for Windows, Linux and macOS.</p>

---

kraken-craft is a graphical Git client built with **Tauri 2**, **Rust** and **React**. It is an independent, clean-room project: all code, visuals and assets are original.

## Features

- **Commit graph:** main branches pinned to fixed columns, right-angle lines, author avatars, local and remote branches grouped, one-click branch switching (including from the "+N" menu).
- **Working tree:** stage, unstage or discard whole files, hunks or single lines; amend; commit templates; skip hooks.
- **History:**
  - merge, rebase, cherry-pick, revert, reset;
  - interactive rebase (reorder, squash, fixup, reword, drop);
  - undo and redo.
- **Conflicts:** a 3-way merge editor, plus an external merge tool if you prefer one.
- **Remotes:** fetch, pull (ff-only, merge or rebase), push or force-push with lease, and auto-fetch.
- **Gitflow:** start and finish feature, release and hotfix branches from the main branches in the side panel.
- **Integrations:** GitHub, GitHub Enterprise, GitLab and GitLab Self-Managed through personal access tokens stored in your OS keychain, with pull requests, issues and SSH key upload.
- **Tooling:**
  - an in-app terminal;
  - external editor, terminal and merge tool;
  - file history and blame;
  - command palette;
  - activity log.
- **Preferences:**
  - themes, date formats, editor and terminal settings;
  - SSH and commit signing (GPG/SSH);
  - LFS and sparse checkout;
  - conflict prediction;
  - English and Portuguese (Brazil) feedback messages.

## Download

Get the latest installer from **[Releases](../../releases/latest)**:

| OS | Files |
| --- | --- |
| Windows | `.msi` or `-setup.exe` |
| Linux | `.deb`, `.rpm` or `.AppImage` |
| macOS | `.dmg` (Apple Silicon `aarch64` or Intel `x64`) |

> **Unsigned builds.** The installers are not code-signed yet.
> - **Windows:** SmartScreen may warn you. Choose *More info › Run anyway*.
> - **macOS:** right-click the app and choose *Open*, or run `xattr -cr "/Applications/kraken-craft.app"`.

## Development

Requirements:
- Node.js 22+
- Rust (stable)
- Git
- On Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev pkg-config`

```bash
npm install
npm run tauri dev        # run the app with hot reload
npx tsc --noEmit         # type-check the frontend
cd src-tauri && cargo test   # backend tests (uses throwaway git repos)
```

Project layout:

```
src/          React + TypeScript UI
src-tauri/    Rust backend (git2 for reads, git CLI for writes and network)
.github/      CI and release workflows
```

## Branches and releases

- **`dev`:** day-to-day work. Open pull requests against `dev`.
- **`main`:** released code. Changes reach it through a pull request from `dev`.

Commit messages follow **[Conventional Commits](https://www.conventionalcommits.org/)**:
- `feat:` adds a feature (minor bump);
- `fix:` fixes a bug (patch bump);
- `feat!:` or a `BREAKING CHANGE:` footer marks a breaking change.

Versioning is automated with [release-please](https://github.com/googleapis/release-please):

1. Pushes to `main` keep a **"chore(main): release x.y.z"** pull request up to date. It bumps the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and updates `CHANGELOG.md`.
2. Merging that pull request tags `vX.Y.Z` and publishes a GitHub Release.
3. The release workflow builds the installers for Windows, Linux and macOS (arm64 and x64) and attaches them to the release.

Every push and pull request also runs CI: a secret scan with gitleaks, a type-check, the frontend build, and the Rust tests on Linux and Windows.
