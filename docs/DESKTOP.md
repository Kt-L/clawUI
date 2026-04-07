# macOS Desktop Build (Unsigned)

This project now supports packaging as an unsigned macOS desktop app via Electron.

## Build in GitHub Actions

1. Open **Actions** and run workflow `macos-desktop` manually, or push a tag like `desktop-v0.1.0`.
2. Download artifact `macos-desktop-artifacts`.
3. Use the generated `.dmg` or `.zip` from `desktop-dist`.

## Local commands

```bash
npm run desktop:pack
```

Creates an unpacked desktop app for the current OS in `desktop-dist`.

```bash
npm run desktop:dist:mac -- --universal
```

Builds unsigned macOS `.dmg` and `.zip` bundles (run on macOS).

## First launch on macOS

Unsigned app bundles are blocked by Gatekeeper by default:

1. Right-click app and choose **Open**.
2. Confirm the security prompt once.
