# Signing releases

Unsigned installers trigger browser, SmartScreen, Defender and Gatekeeper warnings.
`.github/workflows/release.yml` signs every platform it has credentials for and builds the rest unsigned, so each step below can be enabled on its own.

| What | Status | Configured by |
|---|---|---|
| In-app updater signatures | **active** | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Windows (Authenticode, SignPath) | pending SignPath approval | `SIGNPATH_*` |
| macOS (Developer ID + notarization) | pending Apple Developer account | `APPLE_*` |

## In-app updater

The updater only installs bundles signed with the project key. The public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

- The private key and its password are repository secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The maintainer keeps a backup in `~/.tauri/corvus.key` and `~/.tauri/corvus.key.password`. **Never commit them.**
- If the key is lost, installed apps can no longer update themselves. Users then have to download the next version by hand once.

Each release gets a `latest.json` (the update manifest) and `SHA256SUMS.txt`, both written by `.github/scripts/release-manifests.sh` after every installer is attached.

## Windows: SignPath Foundation (free for open source)

1. Apply at <https://signpath.org> with the repository URL. The project must keep its OSI licence (MIT) and build on GitHub-hosted runners.
2. Once approved, in SignPath:
   - create the project;
   - create an artifact configuration that signs the `.msi` and the NSIS `-setup.exe`;
   - create a `release-signing` policy linked to the GitHub trusted build system.
3. In the repository settings, add:
   - the secret `SIGNPATH_API_TOKEN`;
   - the variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG`.

When `SIGNPATH_ORGANIZATION_ID` is set, the Windows build sends its installers to SignPath, waits for the signed files, and re-creates the updater signature of the signed NSIS installer before attaching them.

SmartScreen also weighs download reputation, so the first signed releases may still show a warning for a short while.

## macOS: Developer ID and notarization

Requires the Apple Developer Program. Add these repository secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | "Developer ID Application" certificate exported as `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password of that Apple ID |
| `APPLE_TEAM_ID` | team identifier |

With `APPLE_CERTIFICATE` set, `tauri-action` signs and notarizes both macOS builds.
