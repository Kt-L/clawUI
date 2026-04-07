# AGENTS.md — ClawFace bootstrap guide

This file is for future agents working in the ClawFace repo.

Read this first before making architectural or product changes.

---

# 1. Project overview

ClawFace is a **desktop-native frontend for OpenClaw**.

It is **not** intended to be:
- a generic multi-provider chatbot shell
- a web-first team collaboration app
- a replacement for OpenClaw’s backend management/configuration UI

The current direction is:
- OpenClaw-native product
- desktop-first interaction model
- conversational center with first-class sessions, tools, media, and future OpenClaw-native surfaces
- deliberate architectural cleanup before major feature expansion

## Product thesis

> ClawFace should make OpenClaw feel like a real personal AI workstation, not just a backend with a chat window.

---

# 2. Repo status

This repo is a continuation of an abandoned project.

Important implication:
- there is valuable protocol/UI groundwork worth keeping
- but the current architecture is **not** considered final or healthy enough for unrestricted feature growth

Current strategy:
- salvage the valuable foundation
- refactor overloaded architecture
- expand in deliberate vertical slices

Do **not** assume the current giant components are the desired long-term design.

---

# 3. Where the important docs live

Planning and architecture docs have been moved into:

```text
docs/
```

Read these before making major changes:

- `docs/PRODUCT-BRIEF.md` — product direction and non-goals
- `docs/ARCHITECTURE.md` — architecture inventory and refactor guidance
- `docs/MILESTONE-1.md` — current milestone definition
- `docs/IMPLEMENTATION-ROADMAP.md` — phased roadmap and vertical slices
- `docs/PHASE-1-TICKETS.md` — concrete ticket breakdown for the first implementation phase
- `docs/DESKTOP.md` — desktop-specific notes
- `docs/DEVELOPMENT_CONSTRAINTS.md` — additional working constraints, if present/relevant

## Reading order for new agents

If you are bootstrapping into the repo, the recommended order is:

1. `README.md`
2. `docs/PRODUCT-BRIEF.md`
3. `docs/ARCHITECTURE.md`
4. `docs/MILESTONE-1.md`
5. `docs/IMPLEMENTATION-ROADMAP.md`
6. `docs/PHASE-1-TICKETS.md`

---

# 4. Repo layout

## Root

Important root files:

- `README.md` — current project framing
- `AGENTS.md` — this bootstrap guide
- `requirements.md` — historical or supplemental project requirements
- `package.json` — scripts and dependencies
- `vite.config.ts` — Vite config
- `vite-fs-plugin.ts` — Vite-side file system plugin
- `tailwind.config.ts` / `postcss.config.cjs` — styling/build config
- `tsconfig.json` — TypeScript config

## Renderer app

Main renderer code lives under:

```text
src/
```

Notable areas:
- `src/app.tsx` — app/root shell composition
- `src/main.tsx` — renderer entrypoint
- `src/components/` — UI surfaces
- `src/lib/` — gateway/client/util logic
- `src/hooks/` — custom hooks, where present
- `src/styles.css` — app styling

## Desktop/Electron layer

Desktop runtime code lives under:

```text
electron/
```

Key files:
- `electron/main.cjs` — main process
- `electron/preload.cjs` — renderer bridge

## Scripts

Utility scripts live under:

```text
scripts/
```

---

# 5. Current architecture reality

There are several overloaded/high-risk files in the current codebase.

## High-priority architecture hotspots

### `src/components/ChatView.tsx`
This is currently the largest architectural concern.
It appears to mix:
- thread rendering
- composer behavior
- attachment/media logic
- streaming handling
- tool rendering
- session transition behavior
- desktop-specific logic

Treat this as a refactor target, not as a sacred center of the system.

### `src/components/SettingsModal.tsx`
Large, likely over-centralized settings surface.
Less urgent than ChatView, but still a cleanup target.

### `electron/main.cjs`
Carries too many responsibilities in one place.
Should eventually be split by concerns.

---

# 6. Current implementation strategy

The repo is now being developed through:
- **phases**
- **vertical slices**

That means future work should ideally deliver both:
- product value
- architectural improvement

Avoid:
- giant abstract cleanup passes with no user-facing value
- random feature additions that ignore the roadmap

## Current near-term focus

Milestone 1 is centered on:
- connection reliability
- session shell stability
- thread rendering and streaming cleanup
- composer cleanup
- drag/drop and paste for media/files
- attachment preview and media handling
- basic tool activity visibility
- initial architecture cleanup

---

# 7. How future agents should work in this repo

## Do this
- read the docs in `docs/` before proposing major changes
- align work with the milestone and roadmap
- prefer smaller, clearer component and state boundaries
- treat OpenClaw-native capability exposure as core to the product
- preserve useful behavior while reducing architectural centralization

## Do not do this
- do not turn the app into a generic multi-provider shell
- do not optimize for web-first team collaboration workflows
- do not bloat the app into a duplicate backend admin/config surface
- do not keep adding major logic directly to giant central components if an extraction is reasonable
- do not propose a rewrite from scratch casually; the current strategy is salvage + refactor

---

# 8. Product north star reminders

When making decisions, prefer choices that reinforce these truths:

- OpenClaw is the backend capability plane
- ClawFace is the desktop frontend product layer
- tools should become visible and legible
- sessions are real working contexts, not just tabs
- drag/drop and media workflows should be excellent
- desktop-native affordances should matter
- the app should feel like a personal AI workstation, not a chatbot clone

---

# 9. If you are starting implementation work

Use `docs/PHASE-1-TICKETS.md` to identify the current ticket-level work.

If you are unsure where to start, the best discovery/implementation entry points are currently:
- connection-state ownership audit
- session-selection flow audit
- `ChatView.tsx` responsibility map

These were intentionally chosen because they reduce the chance of doing dumb refactors blind.

---

# 10. Documentation maintenance note

If you materially change:
- architecture boundaries
- product direction
- milestone scope
- roadmap sequencing

then update the corresponding docs in `docs/` so future agents are not bootstrapping off stale assumptions.

This repo is currently in an active planning-to-execution transition, so documentation drift is a real risk.
