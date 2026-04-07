# ClawFace Implementation Roadmap

This roadmap translates the product brief and milestone plan into an implementation sequence.

It is organized around:
- **phases** for ordering work
- **vertical slices** for delivering end-to-end value

The intent is to avoid both of these failure modes:
- doing endless architecture cleanup without shipping a better product
- shipping more feature surface into unstable architecture

Each vertical slice should ideally cut across:
- renderer UI
- app state
- gateway/domain integration
- desktop/platform behavior
- UX quality and polish

---

# Guiding principle

ClawFace should be built by delivering useful product slices while steadily improving the architecture underneath.

That means:
- no giant rewrite before value appears
- no major feature expansion on top of overloaded core files
- every phase should make the app both **better to use** and **safer to extend**

---

# Phase 0 — Alignment and inventory

## Goal
Establish product and architecture direction before implementation work starts in earnest.

## Outcomes
- a shared understanding of what ClawFace is trying to become
- a map of current architectural problem areas
- agreement on Milestone 1 scope
- identification of the first concrete refactor targets

## Deliverables
- `ARCHITECTURE.md`
- `PRODUCT-BRIEF.md`
- `MILESTONE-1.md`
- this roadmap

## Status
This phase is effectively underway / mostly complete.

---

# Phase 1 — Core chat shell stabilization

## Goal
Make the app’s core chat/session shell reliable enough to serve as a serious daily-use base.

This phase should focus on the surfaces that the user touches constantly:
- connection state
- session switching
- thread rendering
- basic chat interactions

## Why first
Because everything else depends on the user trusting the core shell.

## Vertical slices

### Slice 1.1 — Connection and session shell reliability
#### User value
The app reliably connects to OpenClaw, shows the user what state it is in, and handles session navigation without feeling fragile.

#### Scope
- make connection state explicit and understandable
- improve reconnect handling and disconnected states
- stabilize selected-session behavior
- reduce session-switch weirdness
- define clearer app-state ownership for connection + selected session

#### Architecture work tied to the slice
- introduce or formalize `connectionStore`
- introduce or formalize `sessionStore`
- reduce ad hoc state spread between top-level shell and deep UI

#### Done when
- switching sessions is predictable
- reconnect states are understandable
- top-level shell behavior is less brittle than today

---

### Slice 1.2 — Thread rendering and streaming cleanup
#### User value
Messages stream clearly and the main thread feels responsive, readable, and stable.

#### Scope
- improve thread rendering behavior
- stabilize streaming updates
- clean up message transition handling
- reduce visual glitches in thread updates
- preserve or improve auto-scroll behavior

#### Architecture work tied to the slice
- begin splitting `ChatView.tsx`
- extract `ChatThread` / `MessageList` / `MessageRow`
- isolate `useAutoScroll` and similar thread-specific hooks

#### Done when
- thread updates feel less fragile
- streaming UX is reliable
- the core message-rendering logic is no longer buried in one giant file

---

### Slice 1.3 — Composer baseline cleanup
#### User value
Sending messages feels immediate and dependable.

#### Scope
- stabilize composer behavior
- clean up slash-command handling boundaries
- improve input state transitions
- ensure the composer behaves consistently across session switches and reconnects

#### Architecture work tied to the slice
- extract `Composer`
- isolate `useSlashCommands`
- reduce composer logic embedded in the giant chat surface

#### Done when
- input behavior is predictable
- send/stream interactions feel solid
- composer logic is more isolated and testable

---

# Phase 2 — Desktop-native media and attachment workflows

## Goal
Make ClawFace obviously better than a web tab for media-heavy interaction.

This phase should establish one of the app’s strongest differentiators:
- drag and drop
- paste image
- local file handling
- attachment preview
- clean routing of local media into OpenClaw workflows

## Why now
This is a key signature strength for the product, and it also forces the platform layer to become real.

## Vertical slices

### Slice 2.1 — Drag and drop attachments
#### User value
The user can drag screenshots, images, and files into the chat naturally.

#### Scope
- drag-over/drop target behavior
- visual drop affordances
- attachment ingestion path
- consistent behavior for dropped files across desktop contexts

#### Architecture work tied to the slice
- define renderer-side `platform/files` abstraction
- isolate drag/drop handling from the main chat component
- establish attachment lifecycle state ownership

#### Done when
- drag/drop works reliably
- the user can see what they dropped before sending
- the chat UI is not doing raw file wrangling inline

---

### Slice 2.2 — Paste image and clipboard workflow
#### User value
Pasting screenshots and images into the conversation is effortless.

#### Scope
- clipboard image ingestion
- image preview before send
- clean handling of image attachments in the compose flow

#### Architecture work tied to the slice
- define desktop/media adapter surface
- centralize image normalization and metadata extraction logic

#### Done when
- paste-image is smooth
- local image handling is cleaner and more maintainable

---

### Slice 2.3 — Attachment preview and rendering pipeline
#### User value
Attachments feel like first-class objects, not raw blobs.

#### Scope
- attachment preview UI
- image/file metadata display where useful
- better rendering of sent/received attachments in thread
- improved media click/open/lightbox behavior

#### Architecture work tied to the slice
- extract `AttachmentTray` and/or media preview components
- move desktop image resolution logic out of generic thread rendering
- establish `platform/images` abstraction

#### Done when
- attachment UX feels polished
- image rendering is less tangled with chat rendering logic

---

# Phase 3 — Tool visibility and OpenClaw actionfulness

## Goal
Make OpenClaw’s use of tools visible and understandable in the product.

This is where ClawFace starts feeling distinctly OpenClaw-native rather than like a generic assistant shell.

## Why here
Once chat/session/media basics are stable, the next biggest differentiation is that the assistant actually does things.

## Vertical slices

### Slice 3.1 — Basic tool activity timeline
#### User value
The user can tell when tools are running and what kind of work is happening.

#### Scope
- basic tool event surfacing near the active thread
- distinct visual treatment for tool activity vs plain text
- support for running/completed/failed states

#### Architecture work tied to the slice
- introduce normalized tool event/domain model
- define `toolStore` or equivalent state domain
- extract `ToolTimeline` / `ToolActivityPanel`

#### Done when
- tool usage is visible and legible
- the user is not forced to infer all action from final responses

---

### Slice 3.2 — Tool output and failure clarity
#### User value
The user can understand what happened when a tool succeeds or fails.

#### Scope
- improved rendering for tool output summaries
- visible failure state and error presentation
- clearer distinction between tool progress and tool result

#### Architecture work tied to the slice
- improve tool state normalization
- reduce raw tool payload leakage into renderer components

#### Done when
- tool-heavy threads are understandable
- failures are visible rather than buried

---

### Slice 3.3 — Tool-aware thread UX polish
#### User value
Threads feel coherent even when tool activity is substantial.

#### Scope
- improve spacing, grouping, and visual hierarchy for mixed tool/text conversations
- reduce clutter in tool-heavy threads
- improve scanability

#### Architecture work tied to the slice
- separate message rendering from tool rendering more clearly
- refine component boundaries around thread display

#### Done when
- the app still feels calm when the assistant is doing real work

---

# Phase 4 — Runtime controls and shell polish

## Goal
Polish the product into a serious daily driver and clean up the operational edges of the desktop shell.

This phase is about making the app feel cohesive rather than merely feature-complete.

## Vertical slices

### Slice 4.1 — Model/runtime control cleanup
#### User value
The user can control the interaction context without falling into settings hell.

#### Scope
- clarify model visibility/selection patterns
- improve thinking-level controls
- reduce awkward UI around runtime controls
- keep controls close to the work, not buried

#### Architecture work tied to the slice
- separate local runtime control state from generic UI state
- reduce prop sprawl around controls

#### Done when
- model/thinking controls feel intentional, not bolted on

---

### Slice 4.2 — Error, reconnect, and recovery polish
#### User value
The app feels resilient instead of brittle.

#### Scope
- improve error states
- improve reconnect messaging
- improve session continuity after backend hiccups
- reduce cases where the user feels lost after failure

#### Architecture work tied to the slice
- formalize app-level failure/recovery state
- reduce imperative recovery hacks where possible

#### Done when
- backend interruptions no longer make the app feel sketchy

---

### Slice 4.3 — Settings decomposition and cleanup
#### User value
Settings are easier to understand without dominating the product.

#### Scope
- split `SettingsModal.tsx` into meaningful sections
- focus settings on frontend/product concerns
- avoid turning the app into a duplicate backend admin UI

#### Architecture work tied to the slice
- componentize settings sections
- isolate settings state by domain

#### Done when
- settings are more maintainable
- the app feels less like a giant preferences surface

---

# Phase 5 — OpenClaw-native expansion surfaces

## Goal
Begin exposing the richer OpenClaw ecosystem beyond the core chat shell.

This phase should happen only after the Milestone 1 foundation is credible.

## Why later
These features are valuable, but dangerous to add too early because they amplify architectural weaknesses.

## Vertical slices

### Slice 5.1 — Approval surface
#### User value
The user can clearly see and act on approval-requiring operations.

#### Scope
- approval requests
- actionable approval UI
- contextual visibility of blocked actions

---

### Slice 5.2 — Background tasks and subagents
#### User value
The user can understand that OpenClaw is doing work beyond the currently visible reply.

#### Scope
- task state overview
- subagent visibility
- long-running work surfaces

---

### Slice 5.3 — Node/device visibility
#### User value
The user can see and eventually interact with OpenClaw’s paired nodes/devices from the desktop client.

#### Scope
- paired device visibility
- capability summaries
- groundwork for later device-action UX

---

### Slice 5.4 — Browser/canvas/actionful specialist surfaces
#### User value
The user gets richer experiences for especially visual/actionful OpenClaw workflows.

#### Scope
- browser-oriented surfaces
- canvas-oriented surfaces
- action timeline integrations

---

# Cross-cutting architecture tracks

These should progress alongside the vertical slices.

## Track A — Chat surface decomposition
Primary target:
- `ChatView.tsx`

Goal:
- split responsibility without pausing product progress

## Track B — Platform/media abstraction
Primary goal:
- isolate Electron/desktop file and image logic from presentation components

## Track C — App-state formalization
Primary goal:
- define and enforce state ownership for connection, session, thread, tool, and UI domains

## Track D — Gateway/domain normalization
Primary goal:
- normalize raw gateway events into app/domain events the renderer can consume cleanly

## Track E — Electron main-process cleanup
Primary goal:
- gradually decompose `electron/main.cjs` as the product expands beyond basic shell behavior

---

# Suggested execution order inside Milestone 1

Milestone 1 should mostly include:
- Phase 1
- Phase 2
- enough of Phase 3 to make tool visibility real
- selected Phase 4 polish work

That means the likely Milestone 1 execution order is:

## M1 Step 1
- Slice 1.1 — Connection and session shell reliability
- Slice 1.2 — Thread rendering and streaming cleanup

## M1 Step 2
- Slice 1.3 — Composer baseline cleanup
- Slice 2.1 — Drag and drop attachments

## M1 Step 3
- Slice 2.2 — Paste image and clipboard workflow
- Slice 2.3 — Attachment preview and rendering pipeline

## M1 Step 4
- Slice 3.1 — Basic tool activity timeline
- Slice 3.2 — Tool output and failure clarity

## M1 Step 5
- Slice 4.1 — Model/runtime control cleanup
- Slice 4.2 — Error, reconnect, and recovery polish
- Slice 4.3 — Settings decomposition and cleanup (only as much as M1 needs)

---

# How to use this roadmap

## For planning
Use the phases to decide sequence.

## For execution
Use the vertical slices to define actual implementation tickets.

## For scope control
If a task does not clearly fit one of the current phase goals or slices, it is probably not the next thing to do.

---

# Final roadmap summary

The right way to build ClawFace is:
- stabilize the core shell
- make desktop media workflows excellent
- surface OpenClaw’s actionfulness clearly
- polish runtime interactions
- then expand into richer OpenClaw-native surfaces

That preserves product momentum while steadily replacing the current prototype-style architecture with something that can actually last.
