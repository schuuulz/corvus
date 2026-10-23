# Corvus: project rules

Corvus is a desktop Git client built with **Tauri 2 + Rust + React/TypeScript**.
- `src/` holds the UI.
- `src-tauri/` holds the backend: `git2` for reads, the git CLI for writes and network.

It is a **clean-room** project. Never copy, decompile or reference GitKraken code, assets or branding.
`config-telas/` and `prints/` are local reference screenshots. They are git-ignored and must never be committed.

## Code quality: the standard for every change

All frontend and backend code must be **extremely high quality, elegant, and easy for a human to read**. Treat this as a requirement, not a preference. Solve each problem end-to-end: the backend returns structured, meaningful data, the frontend presents it with care, and neither guesses what the other means.

**Readability first**
- Write code for the next human reader. Clear names beat comments, and comments explain *why*, never *what*.
- Keep functions small and single-purpose. When a block needs a heading to be understood, extract it into a well-named function.
- Prefer straightforward control flow: early returns, no deep nesting, no clever one-liners that need decoding.
- Keep the code consistent with what already exists: the same patterns, naming and file layout. Read the neighbouring code before writing.

**Design**
- Model the domain explicitly with types: enums or unions over magic strings, and structs/interfaces over loose maps.
- Return structured results, never strings for the UI to parse (see `git/outcome.rs` → `OpOutcome`).
- Keep one source of truth per concept: no duplicated logic, constants or state. Reuse existing helpers before adding new ones.
- No dead code, commented-out code, debug prints, unused imports or leftover TODOs.
- Don't add speculative abstractions or options nobody asked for. Simple beats generic.

**Rust (`src-tauri/`)**
- Use `Result` and `?` with meaningful errors (`git::Error`). No `unwrap()` / `expect()` on fallible runtime paths; they are allowed only for true invariants, with the reason stated.
- Keep modules focused: git reads (`git2`), git writes (`cli`), outcomes, integrations, system.
- Tauri commands stay thin: validate the input, call the domain function, return typed data.
- Never enable Tauri's `devtools` feature: release builds must not expose the web inspector.
- Every behaviour change comes with a test (unit tests in the module, and integration tests in `tests/git_ops.rs` using throwaway repos).
- Keep `cargo test` clean and the build free of compiler warnings.

**TypeScript / React (`src/`)**
- Strict types: no `any`, no unchecked casts. Type the API (`api.ts`) after the Rust structs.
- Components are small and named after what they show. Logic lives in hooks or `actions.ts`, not in JSX.
- State: settings go through `useG` / `useR`; shared state lives in the zustand store; there is no duplicated local copy of shared state.
- User-facing feedback goes through `run(..., { success, error })` and the i18n helper `t()` (English and Brazilian Portuguese). No hard-coded strings in feedback.
- Keep `npx tsc --noEmit` clean.

**UX standard**
- Every action gives feedback: loading → success, warning or error, with specific, human messages.
- Polish the interaction details: keyboard support, sensible focus, smooth transitions (~150–200ms), empty and loading states, and responsive layouts.
- Styles use the existing CSS variables (theme tokens). There are no hard-coded colours outside the palette constants.

**When in doubt, ask.** If a decision is ambiguous or has trade-offs the user should weigh, stop and align with the user before implementing. This covers behaviour, UX, naming visible to users, scope, data formats and anything hard to undo. Present the options briefly, with a recommendation, and wait for the answer. Don't guess on decisions that belong to the user.

## Branches

- `main`: released code. Changes reach it only through a PR from `dev`.
- `dev`: integration branch.
- Work branches always branch off `dev` and go back to `dev` through a PR. Name them `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`, `refactor/<topic>`.
- Never commit or push directly to `main` or `dev`, and never `push --force` to them.

## Commit messages and PR titles: Conventional Commits

```
<type>(<optional scope>): <imperative, lowercase description>

<optional body: why>

<optional footers: BREAKING CHANGE: ..., Release-As: x.y.z>
```

| Type | Use for | Version effect |
|---|---|---|
| `feat` | new feature | minor |
| `fix` | bug fix | patch |
| `perf` | performance improvement | patch |
| `feat!` / `fix!` / `BREAKING CHANGE:` footer | incompatible change | minor before 1.0, major after |
| `refactor`, `docs` | no behaviour change | none (listed in changelog) |
| `chore`, `ci`, `test`, `build`, `style` | maintenance | none (hidden) |

- Write the prefix in lowercase, followed by `: `. One topic per commit.
- **Never** write a commit or PR title without a type ("update", "wip", "ajustes"). It does not count for releases.
- A squashed PR's title becomes the commit message, so PR titles follow the same format.
- Commits made by Claude end with the `Co-Authored-By` trailer.

Examples: `feat(graph): one-click branch switch from the +N menu`, `fix(staging): stage lines in new files`, `docs: explain release flow`.

## Merging

- **feature → `dev`:** squash merge is fine. The PR title must be a valid conventional commit.
- **`dev` → `main`:** use a **merge commit**, never squash. Each commit must reach release-please.
- **Release PR** (`chore(main): release …`, opened by release-please): merge it as-is. Don't edit its title, don't squash or rebase it, and don't delete its branch while it is open.
- **After every release, `main` is synced back into `dev` automatically** by the `sync-dev` job in `release.yml`. If that job fails (merge conflict), sync by hand: `git checkout dev && git pull && git merge origin/main && git push`.

## Versioning and releases (release-please)

- Versions are computed from commit messages on `main`. **Never** edit versions by hand in any of these files:
  - `package.json`
  - `package-lock.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
- **Never** create `v*` / `corvus-v*` tags or GitHub Releases manually.
- **Never** edit `.release-please-manifest.json` or `release-please-config.json` (unless the task is explicitly about the release setup), nor published entries in `CHANGELOG.md`.
- To force a version, add a `Release-As: x.y.z` footer to a commit on `main`.
- Tags are named `corvus-vX.Y.Z`. Releases up to 0.1.1 were tagged `kraken-craft-vX.Y.Z`, from before the rename.
- Merging the release PR tags the version. `.github/workflows/release.yml` then builds the installers and attaches them to the GitHub Release:
  - Windows: msi/exe
  - Linux: deb/rpm/AppImage
  - macOS: dmg, arm64 and x64
- Every release also gets `latest.json` (the in-app updater's manifest) and `SHA256SUMS.txt`. Installer and updater signing is described in `docs/SIGNING.md`. The updater key's private half lives only in repository secrets: never commit it.

## CI/CD

- `.github/workflows/ci.yml` runs on every push to `main`/`dev` and on every PR:
  - gitleaks secret scan
  - `npx tsc --noEmit`
  - `npm run build`
  - `cargo test --locked`, on Linux and Windows
- It must be green before merging.
- `release.yml` only runs on pushes to `main`, so don't rename `main`.
- Install dependencies with `npm ci` and keep `package-lock.json` and `src-tauri/Cargo.lock` committed and in sync.
- Don't change `identifier` (`com.corvus.app`) in `tauri.conf.json`.
- Keep the repository setting "Allow GitHub Actions to create and approve pull requests" enabled. release-please needs it.

## Secrets

- The repository is **public**. Never commit `.env*`, keys (`*.pem`, `*.key`, `*.p12`, `*.pfx`), tokens or credentials.
- Integration tokens live in the OS keychain (`src-tauri/src/system.rs`) and settings in the app config dir. Neither belongs in the repo.
- If a secret is ever pushed, revoke it immediately. Rewriting history is not enough.

## Before committing or opening a PR

```bash
npx tsc --noEmit
npm run build
cd src-tauri && cargo test
git diff --cached --name-only   # no screenshots, binaries, target/ or secrets
```
