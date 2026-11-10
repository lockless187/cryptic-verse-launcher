Cryptic Verse Seasonal Launcher 1.1.0

Upload/replace index.html, styles.css, renderer.js, main.js, package.json and assets/ (with the 5 webp files) at the ROOT of cryptic-verse-launcher on GitHub. Keep preload.js and .github/workflows/windows-installer.yml unchanged.

Build via GitHub Actions > Build Windows Installer > Run workflow.

Seasonal pictures are copied directly from the user-supplied Cryptic Verse website index.html, and switch using America/Regina local dates.

IMPORTANT: The new theme does NOT resolve Smart App Control. The installer and Electron binaries need trusted code signing; see Microsoft Artifact Signing documentation. Do not disable security protection to sideload an unsigned build.

This is a code package, not a signed installer. Test on Windows before distribution.
