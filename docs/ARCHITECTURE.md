# ClawFace Architecture Inventory and Refactor Plan

This document is a first-pass architecture inventory for ClawFace as it exists today, plus a recommended modernization path for turning it into a strong OpenClaw-native desktop client.

It is not a perfect reverse-engineering of every file. It is a practical map of the current shape, key risks, and the most valuable next moves.

---

# Executive summary

ClawFace is worth continuing, but not as a "just keep shipping features" codebase.

It already contains meaningful product and integration value:
- Electron desktop shell
- React/Vite renderer
- OpenClaw gateway protocol awareness
- a richer-than-basic chat UI
- support for tools, sessions, files, and desktop-specific behavior

However, the current structure is too centralized in a few large UI and runtime surfaces.

## Recommendation

Adopt ClawFace as a **salvageable foundation** and proceed with a **staged architectural reset** before major feature expansion.

That means:
- keep the working shell and protocol knowledge
- refactor boundaries aggressively
- make OpenClaw-native concepts first-class
- stop adding large features directly into central UI files

---

# 1. Current top-level structure

## Renderer / app layer

Primary renderer code lives under:

```text
src/
```

Observed key areas:
- `src/app.tsx` — likely main renderer composition root
- `src/components/ChatView.tsx` — central chat/thread UI surface
- `src/components/SessionSidebar.tsx` — session browsing/search/deletion UI
- `src/components/SettingsModal.tsx` — massive settings/configuration UI
- `src/lib/gateway.ts` — gateway client / transport logic
- `src/lib/types.ts` — app/gateway-related types
- various utility libraries and hooks

## Desktop layer

Electron code lives under:

```text
electron/
```

Observed key files:
- `electron/main.cjs` — app boot, BrowserWindow, IPC, local image protocol, ClawFS protocol, gateway URL coordination
- `electron/preload.cjs` — desktop bridge exposed to renderer

## Build/runtime stack

The repo appears to use:
- React
- TypeScript
- Vite
- Electron

This is a reasonable baseline for a standalone OpenClaw desktop app.

---

# 2. Current responsibility map

## 2.1 Renderer app root

### `src/app.tsx`
Current role likely includes:
- application composition root
- session selection / overall app shell
- top-level connection wiring
- passing many stateful props into child components

## Architectural note
This is a normal place for composition, but it should not become a second giant gravity well.

It should evolve toward:
- shell composition
- provider/store mounting
- route/pane orchestration
- high-level app state boundaries

---

## 2.2 Chat surface

### `src/components/ChatView.tsx`
Current role appears to include:
- thread rendering
- composer behavior
- attachment/image handling
- streaming UI
- tool activity rendering
- scroll handling
- slash commands
- session transition behavior
- lightbox/image expansion
- desktop/web branching logic
- model/thinking controls

## Architectural note
This is the single largest structural concern in the repo.

ChatView is doing too much.
It currently behaves like:
- thread view
- controller
- animation state machine
- platform/media adapter
- command interface
- presentation layer

This should be decomposed first.

---

## 2.3 Session surface

### `src/components/SessionSidebar.tsx`
Current role includes:
- session list rendering
- local search
- async gateway search
- session preview matching/highlighting
- deletion UI
- collapse/hover behavior
- card animation/tilt behavior
- lazy pagination/onReachEnd behavior

## Architectural note
This component is more structured than ChatView, but still mixes:
- search behavior
- async orchestration
- rendering
- animation affordances

It is a candidate for moderate cleanup rather than emergency surgery.

Good future split:
- `SessionSearchBox`
- `SessionList`
- `SessionListItem`
- `useSessionSearch`
- `useSidebarHoverCollapse`

---

## 2.4 Settings surface

### `src/components/SettingsModal.tsx`
Current role includes:
- gateway configuration
- file server URL configuration
- UI settings themes/schemes
- keyboard shortcuts
- model shortcut schemes
- agent session shortcut schemes
- notification sound settings
- typography/layout settings
- color system settings
- markdown readability settings

## Architectural note
This component is huge, but in a somewhat more forgivable way: it is mostly a settings editor.

Still, it should be split into sections/components, because right now it is effectively multiple applications inside one modal.

Suggested split:
- `GatewaySettingsSection`
- `UiSchemesSection`
- `ShortcutSettingsSection`
- `ModelShortcutSection`
- `AgentShortcutSection`
- `TypographySettingsSection`
- `ColorSettingsSection`
- `MarkdownSettingsSection`
- `ReplyDoneSoundSection`

This is less urgent than ChatView, but still high value.

---

## 2.5 Gateway client layer

### `src/lib/gateway.ts`
This appears to be one of the most valuable modules in the repo.

Likely responsibilities:
- gateway connection lifecycle
- handshake/auth/hello
- reconnect handling
- event transport
- request/response framing
- session communication helpers

## Architectural note
This should become the nucleus of a clearer **domain transport layer**.

But it should not remain the raw thing every renderer component reasons about directly.

The next evolution should be:
- raw gateway client stays here
- normalized domain event adapter sits above it
- UI/store consume normalized events, not raw protocol payloads

---

## 2.6 Desktop bridge

### `electron/preload.cjs`
Current role:
- exposes `desktopInfo` into renderer
- desktop-only image/file operations
- gateway URL coordination
- file server URL coordination
- beep / native-ish helpers

## Architectural note
This is a good place for the boundary to exist.

But the renderer should consume a more explicit abstraction than scattered direct bridge usage.

Recommended future shape:
- keep preload minimal
- define typed renderer-side adapter(s) for desktop capabilities
- avoid leaking Electron concerns throughout UI files

---

## 2.7 Electron main process

### `electron/main.cjs`
Current role includes:
- window lifecycle
- protocol registration
- local image handling
- remote/local image fallback logic
- ClawFS virtual filesystem protocol
- IPC handlers
- gateway URL / fs server URL coordination
- blank-screen recovery/reload behavior

## Architectural note
This file contains a lot of real utility, but it is also carrying too many concerns in one place.

It currently behaves like:
- app bootstrapper
- image proxy/cache layer
- filesystem API server
- runtime config coordinator
- resilience manager

That is workable for now, but it should be decomposed over time.

Suggested future split:
- `electron/main.cjs` → startup/bootstrap only
- `electron/ipc/images.cjs`
- `electron/ipc/fs.cjs`
- `electron/ipc/runtime-config.cjs`
- `electron/window/create-window.cjs`
- `electron/protocols/local-image.cjs`
- `electron/protocols/claw-fs.cjs`

This would make the desktop layer much easier to reason about.

---

# 3. Current architecture problems

## 3.1 Over-centralization
The codebase has several large "gravity well" files:
- `ChatView.tsx`
- `SettingsModal.tsx`
- `electron/main.cjs`

These are where complexity goes to hide.

## 3.2 Mixed concerns
Several layers currently bleed into each other:
- protocol concerns leaking into UI
- platform/media concerns leaking into rendering
- animation/UI concerns mixed with core behavior
- desktop runtime behavior mixed with app behavior

## 3.3 Weak domain modeling
OpenClaw-native concepts are not yet strongly modeled as first-class application entities.

The app still appears too close to being:
- a sophisticated chat renderer

instead of:
- an OpenClaw operator/client shell

## 3.4 Manual state sprawl
The renderer appears to rely heavily on:
- `useState`
- refs
- timers
- effect choreography
- local imperative UI state

This is survivable for prototypes, but risky as a long-term product base.

---

# 4. Recommended target architecture

The app should evolve toward four explicit layers.

## 4.1 Transport / Gateway layer
### Owns
- websocket/gateway transport
- reconnect/auth
- raw event subscription
- request/response helpers

### Should expose
- typed client methods
- raw event stream or normalized event handoff

### Should not own
- React state
- UI behavior
- animation state

---

## 4.2 Domain / application layer
### Owns
- sessions
- messages
- tool activity
- approvals
- task state
- selected session
- connection state
- model/thinking preferences
- session search/filter state

### Recommended form
A dedicated app store or coordinated set of stores.

This could be:
- Zustand
- Redux Toolkit
- Jotai
- another disciplined state system

The exact library matters less than having clear ownership.

---

## 4.3 Platform layer
### Owns
- Electron bridge usage
- local file reads
- image resolution/fallbacks
- desktop-only helpers
- filesystem protocol access

### Goal
UI should talk to platform services/hooks, not directly juggle file-scheme weirdness.

---

## 4.4 Presentation layer
### Owns
- rendering
- local interaction state
- layout/panes
- menus and controls
- message display
- tool inspectors
- settings UI

### Goal
Smaller components with less knowledge of transport/platform details.

---

# 5. Product architecture direction

ClawFace should become:

> an OpenClaw-native operator/client interface

not merely:

> a chat app with extra controls

## First-class product surfaces should likely become
- chat thread
- session list
- tool inspector / tool timeline
- approvals
- tasks/background activity
- node/device surfaces
- model/runtime controls
- file/artifact/media surfaces

This is important because OpenClaw is not just an LLM conversation backend.

---

# 6. Refactor priority list

## Priority 1 — Decompose `ChatView.tsx`
### Goal
Reduce the single largest concentration of renderer complexity.

### Suggested extraction targets
- `ChatThread`
- `MessageList`
- `MessageRow`
- `Composer`
- `AttachmentTray`
- `ToolTimeline`
- `LightboxViewer`
- `SessionHeader`
- `ModelControls`
- `ThinkingControls`

### Suggested hooks
- `useAutoScroll`
- `useSessionTransitions`
- `useSlashCommands`
- `useAttachmentHandling`
- `useDesktopImageResolution`

---

## Priority 2 — Extract desktop/media handling from the renderer
### Goal
Stop file/image/runtime complexity from polluting chat rendering.

### Suggested renderer-side modules
- `src/platform/desktop.ts`
- `src/platform/images.ts`
- `src/platform/files.ts`

### Suggested responsibility
- one entrypoint for desktop capabilities
- one media resolver abstraction
- one file operation abstraction

---

## Priority 3 — Normalize gateway events
### Goal
Introduce a stable application-facing event model.

### Example target event types
- `connectionChanged`
- `sessionListUpdated`
- `sessionSelected`
- `messageStarted`
- `messageDelta`
- `messageCompleted`
- `toolStarted`
- `toolUpdated`
- `toolCompleted`
- `approvalRequested`
- `taskUpdated`

The UI should consume these, not raw gateway payloads.

---

## Priority 4 — Introduce clear app state ownership
### Goal
Reduce uncontrolled state sprawl.

### Suggested state domains
- `connectionStore`
- `sessionStore`
- `threadStore`
- `toolStore`
- `uiStore`
- `settingsStore`

Even if implemented as one store at first, the domains should be explicit.

---

## Priority 5 — Decompose settings UI
### Goal
Make settings maintainable and easier to extend.

### Suggested structure
```text
src/components/settings/
  SettingsModal.tsx
  GatewaySettingsSection.tsx
  UiSchemesSection.tsx
  ShortcutSettingsSection.tsx
  TypographySection.tsx
  ColorSystemSection.tsx
  MarkdownSection.tsx
  SoundSection.tsx
```

This is not the first refactor to do, but it is a high-value cleanup.

---

## Priority 6 — Decompose Electron main process concerns
### Goal
Reduce main-process risk and make the desktop shell easier to extend.

### Suggested structure
```text
electron/
  main.cjs
  window/
    create-window.cjs
  protocols/
    local-image.cjs
    claw-fs.cjs
  ipc/
    desktop-info.cjs
    image-ipc.cjs
    fs-ipc.cjs
    runtime-config.cjs
```

---

# 7. Proposed target directory evolution

This is not a required exact structure, but it is a useful direction.

```text
src/
  app/
    AppShell.tsx
    providers/
    layout/
  components/
    chat/
    sessions/
    settings/
    tools/
    media/
    common/
  domain/
    sessions/
    messages/
    tools/
    approvals/
    tasks/
  gateway/
    client.ts
    events.ts
    adapters.ts
  platform/
    desktop.ts
    files.ts
    images.ts
  stores/
    connection-store.ts
    session-store.ts
    thread-store.ts
    tool-store.ts
    ui-store.ts
  lib/
    format.ts
    utils.ts
```

And for Electron:

```text
electron/
  main.cjs
  preload.cjs
  window/
  protocols/
  ipc/
```

---

# 8. Suggested phased implementation plan

## Phase 0 — Inventory and boundaries (now)
### Deliverables
- this document
- identify top refactor files
- define target layers and naming

## Phase 1 — Chat decomposition
### Deliverables
- split `ChatView`
- extract media/platform hooks
- reduce giant-prop passing where possible

## Phase 2 — App state + domain normalization
### Deliverables
- define store boundaries
- normalize gateway events
- centralize session/thread/tool state

## Phase 3 — Desktop/runtime cleanup
### Deliverables
- split Electron main-process concerns
- clarify preload/renderer contracts
- consolidate desktop/platform adapters

## Phase 4 — Product expansion
### Deliverables
- approvals UX
- richer tool inspector
- task/subagent surface
- node/device integration surfaces

This order matters. Do not jump straight to large new feature work while the central UI remains overloaded.

---

# 9. Most useful immediate next moves

If we were acting on this review right away, the highest-leverage next tasks would be:

## 1. Create a dedicated refactor branch
Do not blend this cleanup with feature work.

## 2. Split `ChatView.tsx`
This is the single best leverage point.

## 3. Add an explicit renderer-side platform adapter
Start moving file/image/desktop logic out of UI rendering.

## 4. Introduce a small app-state boundary
Even a first pass for sessions + selected thread + connection state would help.

## 5. Write a product brief for "OpenClaw-native client"
This will stop the app from drifting into generic chatbot-clone behavior.

---

# 10. Final recommendation

ClawFace should be treated as:
- **valuable prototype code**
- **useful protocol/UI groundwork**
- **not yet the right long-term architecture**

The best path is:

> salvage, refactor, then expand

not:
- rewrite from scratch
- nor pile features on top of the current shape indefinitely

That keeps momentum while avoiding a slow drift into an unmaintainable desktop monolith.
