# ClawUI

> **⚠️ Disclaimer: Vibe Coding Project**
>
> This project is a pure "Vibe coding" experiment. It was developed rapidly with a focus on flow and experimentation. As such, it may contain bugs, incomplete features, or unoptimized code. It is intended for reference and educational purposes only. Use at your own risk!

![ClawUI Preview](./UIpreview.png)

ClawUI is a modern, open-source desktop interface designed for **OpenClaw**. Built with performance and user experience in mind, it leverages the power of **React**, **Vite**, and **Electron** to deliver a responsive and seamless chat interaction platform.

## Features

- 🖥️ **Cross-Platform Desktop App**: Runs smoothly on macOS, Windows, and Linux.
- ⚡ **Fast & Responsive**: Powered by Vite and React for instant interactions.
- 🔒 **Secure Device Authentication**: Built-in support for device identity and secure token management.
- 💬 **Rich Chat Interface**: Includes session management, history, and markdown support.
- 📊 **Token Usage Tracking**: Real-time monitoring of input/output token usage.
- 🎨 **Modern UI/UX**: Clean design with Tailwind CSS styling.

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v22 or later recommended)
- **npm** (v10 or later)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/clawui.git
   cd clawui
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Development

To start the development server with hot-reload:

```bash
npm run dev
```

To verify the runtime environment:

```bash
npm run check:env
```

## Building for Production

To build the web assets:

```bash
npm run build
```

To package the desktop application (macOS example):

```bash
npm run desktop:dist:mac
```

## Project Structure

- `src/`: React source code (components, hooks, utilities).
- `electron/`: Electron main process and preload scripts.
- `scripts/`: Build and verification scripts.
- `dist/`: Compiled web assets.
- `desktop-dist/`: Packaged Electron application binaries.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 GPT-5.3-codex
