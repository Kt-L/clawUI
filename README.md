<p align="center">
  <h1 align="center">ClawFace</h1>
  <p align="center">
    A desktop-native OpenClaw client built to make sessions, tools, media, and future OpenClaw-native capabilities feel like first-class parts of the experience.
  </p>
</p>

ClawFace is a fork-forward continuation of an abandoned OpenClaw desktop/web client experiment.
It is now being repositioned as a **desktop-first frontend product for OpenClaw**, not a generic chatbot shell and not a replacement for OpenClaw’s backend management/configuration surfaces.

## Project direction

ClawFace exists to be the best way to *use* OpenClaw day to day on a desktop machine.

The product direction is:
- **OpenClaw-native**, not provider-native
- **desktop-first**, not web-first team collaboration
- **conversational at the center**, but with room for tools, sessions, tasks, media, and devices as first-class experiences
- **frontend-focused**, while OpenClaw itself remains the backend management and capability plane

### What ClawFace is not

ClawFace is **not** intended to become:
- a generic multi-provider chatbot shell
- a team collaboration workspace
- a prettier copy of OpenClaw’s backend config/admin UI
- just another settings panel with a chat window attached

## Current product thesis

> ClawFace should make OpenClaw feel like a real personal AI workstation, not just a backend with a chat window.

## Why this project exists

OpenClaw already has powerful capabilities across:
- sessions
- tools
- media analysis
- browser/canvas flows
- nodes/devices
- background work and orchestration
- local/self-hosted workflows

But those capabilities are currently spread across multiple surfaces.
ClawFace is intended to unify the everyday *desktop experience* of OpenClaw without trying to replace every backend/admin surface.

## High-level goals

Near-term priorities for ClawFace are:
- strong desktop chat UX
- stable session navigation and switching
- excellent drag-and-drop / paste workflows for images and files
- visible tool activity and better legibility around actionful work
- enough architectural cleanup to support future OpenClaw-native expansion

Longer-term opportunities include:
- approvals
- background tasks and subagents
- node/device surfaces
- richer browser/canvas/computer-use UX
- stronger artifact/media handling

## Current status

This codebase is **worth continuing**, but it is not treated as finished or production-ready architecture.

The current strategy is:
- salvage the valuable protocol/UI groundwork
- refactor the overloaded architecture
- expand deliberately in OpenClaw-native directions

In plain English:
- do **not** rewrite from scratch immediately
- do **not** keep piling features into giant central files
- proceed through staged refactoring and vertical product slices

## Working in this repo

If you are a coding agent or are onboarding quickly, start with:

- [`AGENTS.md`](./AGENTS.md) — bootstrap guide for repo orientation, doc reading order, architecture hotspots, and working conventions

## Planning docs

The repo now includes project-planning docs to guide the modernization effort:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — architecture inventory and refactor plan
- [`PRODUCT-BRIEF.md`](./PRODUCT-BRIEF.md) — product vision, principles, and differentiators
- [`MILESTONE-1.md`](./MILESTONE-1.md) — first serious milestone definition
- [`IMPLEMENTATION-ROADMAP.md`](./IMPLEMENTATION-ROADMAP.md) — phased roadmap with vertical slices

If you are working on the app, start with those docs before making major architectural changes.

## Milestone 1 summary

Milestone 1 is focused on shipping the first version of ClawFace that is genuinely worth using every day as an OpenClaw desktop frontend.

Milestone 1 focuses on:
- connection reliability
- session shell stability
- thread rendering and streaming cleanup
- composer cleanup
- drag/drop and paste workflows for media/files
- attachment previews and rendering polish
- basic tool activity visibility
- initial architecture cleanup around chat, state, and platform/media boundaries

## Technology stack

Current stack includes:
- React
- TypeScript
- Vite
- Electron

This remains a reasonable baseline for the product.

## Development status and expectations

This repo is under active repositioning and architectural cleanup.

Expect:
- moving boundaries
- refactors before major new features
- some legacy complexity from the abandoned predecessor
- planning docs that may be more accurate than older implementation assumptions

## Practical development guidance

When working in this repo:
- do not treat current giant components as the final architecture
- prefer extracting clear boundaries over adding more logic to overloaded files
- align product changes with the roadmap’s vertical slices
- keep OpenClaw-native capability exposure central to the product direction

## Original project note

This repo began as a more generic “modern chat client for OpenClaw Gateway” effort under a different project identity.
That framing is no longer sufficient for where the project is headed.

The new direction is intentional: ClawFace should become a true desktop frontend for OpenClaw’s richer ecosystem of sessions, tools, media, and future operator surfaces.

## License

[MIT](LICENSE)
