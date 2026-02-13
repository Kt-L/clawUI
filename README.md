# ClawUI

> Experimental project. Expect rapid iteration and occasional rough edges.

![ClawUI Preview](./UIpreview.png)
![ClawUI Preview](./UIpreview2.png)

ClawUI is a modern Web/Desktop client for **OpenClaw Gateway**, built with React + Vite + Electron.

## Highlights

- Gateway-native chat client with token/password auth and automatic reconnect.
- Session workflow: search, create, delete, incremental loading, and history pagination.
- Multi-agent session support, including creating new sessions bound to a selected agent.
- Rich message rendering: Markdown, code blocks, tables, and KaTeX math.
- Tool activity timeline with collapsible args/output details.
- Slash command UX with autocomplete and keyboard navigation.
- Image-first attachment pipeline with payload-size estimation and auto-compression.
- Local/remote image resolving bridge for desktop runtime (`claw-local-image://` + fallback fetch).
- Deep UI customization (typography, layout, colors, markdown readability, motion).
- Settings schemes, model shortcut schemes, and agent session shortcut schemes.
- Reply-done sound notifications (built-in tones or custom audio file).

## Built-in Slash Commands

ClawUI has local handling for:

- `/status`
- `/models`
- `/compact`
- `/model provider/model`
- `/think off|minimal|low|medium|high|xhigh`
- `/verbose ...`
- `/reasoning ...`
- `/usage ...`
- `/abort`
- `/new [label]`
- `/reset`

Other slash inputs are sent as normal chat text.

## Keyboard Shortcuts

- `Cmd/Ctrl + D`: Toggle session sidebar.
- `Cmd/Ctrl + E`: Create a new session.
- Up to 5 custom model shortcuts (model + thinking combo).
- Up to 5 custom agent-session shortcuts (create new session with bound agent).

All shortcut schemes are configurable in `Settings`.

## Requirements

- Node.js `22.22.0`
- npm `10.9.4`
- A running OpenClaw Gateway (default: `ws://127.0.0.1:18789`)

## Quick Start (Web)

```bash
npm install
npm run dev
```

Open the Vite URL, then set Gateway URL/token/password in `Settings`.

## Desktop Build

Build web assets:

```bash
npm run build
```

Package desktop app (unpacked):

```bash
npm run desktop:pack
```

Build unsigned macOS artifacts:

```bash
npm run desktop:dist:mac
```

Detailed desktop notes: `DESKTOP.md`.

## Useful Scripts

- `npm run dev` - start Vite dev server.
- `npm run build` - build web assets.
- `npm run preview` - preview production build locally.
- `npm run desktop:pack` - package Electron app (unpacked).
- `npm run desktop:dist:mac` - package unsigned macOS app.
- `npm run check:runtime` - validate Node/npm runtime versions.
- `npm run check:env` - runtime checks + Rollup Linux binary check.
- `npm run verify:ci` - CI-style local verification.

## Environment Variables (Optional)

- `PORT`: Vite dev server port (default `5178`).
- `CLAWUI_IMAGE_PROXY_PORT`: local-image proxy port used by desktop fallback fetch (default `3000`).
- `OPENCLAW_WORKSPACE_DIR` or `CLAW_WORKSPACE_DIR`: override workspace path exposed to desktop runtime.

## Image Handling Notes

- Web runtime cannot directly read local file paths.
- Desktop runtime can resolve local images through Electron IPC and `claw-local-image://`.
- For remote gateway paths, ClawUI attempts gateway-compatible read methods and HTTP proxy fallback.
- Large image payloads are auto-compressed before `chat.send`; oversized payloads are rejected with a clear UI error.

## Project Structure

- `src/` - React app, components, and client logic.
- `src/lib/` - Gateway client, parsing, markdown renderer, UI settings, utilities.
- `electron/` - desktop main/preload bridge and local image protocol handling.
- `scripts/` - runtime and environment checks.
- `dist/` - built web assets.
- `desktop-dist/` - packaged desktop artifacts.

## License

[MIT](LICENSE)
