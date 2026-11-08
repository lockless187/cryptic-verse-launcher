# Cryptic Verse desktop launcher (Windows)

The intended product for players is a **single Windows installer EXE**, named `Cryptic-Verse-Setup-1.0.0.exe`. Players double-click it and get a Start Menu + desktop shortcut. **They do not receive a ZIP.**

## For the site owner (one-time build)

1. Copy all files in this folder (including `.github/workflows/windows-installer.yml`) to a GitHub repository.
2. In GitHub open **Actions → Build Windows installer → Run workflow**.
3. After the workflow succeeds, open the repository's **Releases** page. Download `Cryptic-Verse-Setup-1.0.0.exe` directly (not the GitHub 'Source code' ZIP).
4. Publish that exact EXE link as the **Download for Windows** button on the Cryptic Verse website.
5. Tell players to download it and double-click it. On first launch they can sign in with their existing Cryptic Verse account.

Alternatively, on Windows with Node.js installed, run `npm install`, then `npm run build:windows`. The EXE appears in `dist/`.

## Features and constraints

- Own desktop Store, Library, Downloads and Updates tabs; no Store browser window.
- Uses existing Supabase published games, free-game library and secure-download RPC.
- Downloads approved ZIP game builds automatically, extracts them to launcher-managed folders, discovers one playable `.exe`, and offers Play and Uninstall buttons.
- Checks installed game versions against `cv_library_release_versions` RPC (run `CV_LIBRARY_UPDATES.sql` from your existing site upgrade first); click Update to replace a version.
- Does **not** automatically install or run games at download time. It never silently executes developer builds.
- Does **not** support Cloudflare R2 `r2:` builds yet. Those require a new secure server-side download-ticket endpoint.
- Only supports approved **free** Windows games in standard ZIP packages that contain exactly one playable `.exe`. Paid checkout is not implemented.
- Desktop installers and distributed game executables should be security reviewed and code-signed before a public launch. SmartScreen may warn for unsigned binaries.
- The installer gives a normal Windows desktop shortcut; there is no ZIP extraction step for end users.

## Known limitations before public release

This is an initial implementation, not a production-audited download system. Test against your live database on Windows. The store RPC, `library` table RLS, `cv11_secure_download` permissions, `fv-game-builds` bucket, package formats and any R2 integration must all be verified. The installer is not built or Windows-tested in this environment; GitHub Actions must compile it. Currently downloads are limited to 2 GB and game ZIPs are untrusted software; vet developer submissions.
