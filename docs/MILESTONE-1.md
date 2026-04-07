# ClawFace Milestone 1

## Working milestone title

**Milestone 1 — The desktop-native OpenClaw chat client worth using every day**

---

# 1. Purpose of Milestone 1

Milestone 1 is not "finish ClawFace."
It is the first version that should feel genuinely useful, coherent, and better than falling back to a browser tab or a raw admin surface.

This milestone should produce:
- a stable desktop chat experience for OpenClaw
- excellent local/desktop media handling
- clear session navigation
- clear visibility into tool activity
- a cleaner architecture base for future OpenClaw-native expansion

## One-sentence milestone goal

> Deliver a desktop-native OpenClaw client with strong chat UX, reliable session handling, drag/drop media workflows, visible tool activity, and enough architectural cleanup to support future OpenClaw-first features.

---

# 2. Why Milestone 1 exists

ClawFace should not try to expose everything OpenClaw can do in the first serious version.
That would create a bloated, unstable product and lock in bad architecture.

Milestone 1 exists to establish the right foundation and the right everyday experience.

It should answer:
- Can I use this as my main desktop frontend for OpenClaw?
- Does it already feel better than the generic alternatives?
- Is the architecture healthy enough to keep expanding?

If the answer to those is yes, then Milestone 1 succeeded.

---

# 3. Primary user for Milestone 1

A technically sophisticated OpenClaw user who:
- already runs OpenClaw locally or on self-hosted infrastructure
- wants a desktop-native daily driver
- values local-first workflows
- wants smooth handling of screenshots, images, and files
- wants richer interaction than a browser chat window
- cares about seeing what OpenClaw is doing, not just final text

This milestone is for a single-user operator, not a multi-user team.

---

# 4. Product promise for Milestone 1

When Milestone 1 is done, a user should be able to:
- open ClawFace
- connect to their OpenClaw backend reliably
- browse and switch sessions comfortably
- drag in screenshots/files for analysis without friction
- send prompts and watch responses stream naturally
- understand when tools are being used
- recover from disconnects and rough edges without the app feeling fragile

It should feel like a serious daily-use OpenClaw client, not a prototype demo.

---

# 5. In-scope user flows

These are the core flows Milestone 1 must support well.

## 5.1 Connect to OpenClaw and stay connected
### User story
As a user, I want the desktop app to connect to my OpenClaw backend reliably and make connection state obvious.

### Needs
- clear connection status
- reasonable reconnect behavior
- useful failure states when gateway is unavailable
- low confusion around which backend it is talking to

---

## 5.2 Browse, search, and switch sessions
### User story
As a user, I want to move between sessions smoothly and understand which working context I am in.

### Needs
- session sidebar
- search/filter behavior
- selected session clarity
- smooth session switching
- enough metadata/preview to make switching sensible

---

## 5.3 Chat naturally with strong streaming UX
### User story
As a user, I want normal conversational use to feel polished and fast.

### Needs
- responsive composer
- reliable send flow
- streaming message updates
- comfortable thread rendering
- reasonable handling of long messages and tool-heavy replies

---

## 5.4 Drag and drop / paste images and files
### User story
As a user, I want to drag screenshots, images, and files directly into the conversation and have that feel effortless.

### Needs
- drag/drop target behavior
- paste image support
- attachment preview before send
- sensible handling of local desktop files
- low-friction path from dropped file to analyzed result

This is one of the most important signature flows for Milestone 1.

---

## 5.5 Understand tool activity
### User story
As a user, I want to see when OpenClaw is doing something with tools, not just wait for the final answer.

### Needs
- visible tool activity associated with the current thread
- useful distinction between text generation and tool execution
- basic tool output/progress visibility
- sensible handling of tool-heavy responses

This does not need to be a full-blown operator console yet, but it must be better than hidden trace noise.

---

## 5.6 Basic runtime controls
### User story
As a user, I want to control the current interaction context without leaving the app.

### Needs
- model selection or visibility where appropriate
- thinking-level controls
- session-level interaction controls where already relevant
- frontend settings for local UX concerns

This should support the conversation, not dominate it.

---

# 6. Must-have product outcomes

These are the non-negotiables for Milestone 1.

## 6.1 Stable session-centric chat client
The app must be a dependable session-oriented OpenClaw chat frontend.

## 6.2 Excellent desktop media/file workflow
Dropping or pasting images/files must feel like a core strength.

## 6.3 Visible tool activity
The app must make tool use legible enough that OpenClaw feels actionful, not opaque.

## 6.4 Better-than-prototype interaction quality
The app should feel stable and coherent enough for everyday use.

## 6.5 Reduced architectural risk
Some cleanup must happen during this milestone so the product does not get trapped by current centralization.

Milestone 1 is not just feature delivery. It is also architecture rescue.

---

# 7. Explicitly in scope

## Product/UI
- chat thread
- session sidebar
- composer/input tray
- attachment drag/drop/paste flow
- attachment preview
- streaming response UX
- visible tool activity in thread or adjacent surface
- connection status / reconnect feedback
- basic runtime controls (model/thinking/etc.)
- desktop image/file support that feels intentional

## Architecture
- split or significantly reduce `ChatView.tsx` centralization
- isolate renderer-side platform/media logic
- improve app-state ownership for core flows
- reduce direct leakage of gateway/platform concerns into UI components

## Reliability
- basic failure and reconnect handling
- less brittle state transitions
- fewer giant gravity-well components controlling everything

---

# 8. Explicitly out of scope for Milestone 1

To keep the milestone sane, the following should be deferred unless they fall out naturally from the work.

## Product features deferred
- full node/device control center
- full approvals center
- full task/subagent dashboard
- memory inspector / memory management surface
- dedicated browser/canvas specialist panes
- multi-user/team workflows
- enterprise collaboration features
- replacing every backend configuration/admin surface in OpenClaw
- generic multi-provider shell abstractions

## Why these are out
They are valid future directions, but not necessary for proving ClawFace as a strong daily-use desktop frontend.

---

# 9. Milestone 1 quality bar

Milestone 1 should feel:
- faster than the web admin surface for day-to-day chat use
- more comfortable for media-heavy interaction
- clearer about tool usage
- strong enough to become the default desktop entrypoint for the user

It should not feel like:
- a prototype held together by suspense
- an Electron wrapper around chaos
- a settings app with a chat widget in the middle

---

# 10. Architecture implications

Milestone 1 should drive concrete architectural changes.

## 10.1 `ChatView.tsx` cannot remain the center of the universe
This file is too overloaded for future product growth.

### Milestone 1 expectation
It should be decomposed into smaller pieces for:
- thread rendering
- composer/input
- attachments
- tool activity
- header/controls
- image/media handling

---

## 10.2 Renderer-side platform handling must be isolated
Desktop file/image logic should move into explicit platform abstractions.

### Milestone 1 expectation
Create a renderer-side platform/media layer or equivalent hooks/services.

---

## 10.3 Core state boundaries must improve
The app needs clearer ownership for:
- connection state
- selected session
- thread state
- tool activity state
- UI-local state

### Milestone 1 expectation
At least a first-pass explicit store/domain boundary for the above.

---

## 10.4 Tool activity must have a stronger model
If tool visibility is a product differentiator, the app needs a cleaner internal representation of tool events and tool state.

### Milestone 1 expectation
Begin normalizing tool activity in a way the UI can consume cleanly.

---

# 11. Recommended milestone deliverables

## 11.1 Product deliverables
- usable desktop client for day-to-day chat with OpenClaw
- stable session switching
- high-quality drag/drop and paste UX for files/images
- visible tool activity surface
- better attachment rendering and handling
- basic runtime controls that support the conversation

## 11.2 Engineering deliverables
- decomposed `ChatView`
- initial platform/media adapter layer
- clearer app-state boundaries
- reduced coupling between gateway details and rendering layer
- improved robustness around reconnect and state recovery

## 11.3 Documentation deliverables
- updated architecture notes where necessary
- basic product/UX notes for the milestone scope
- developer notes for the new boundaries introduced in M1

---

# 12. Success criteria

Milestone 1 is successful if:

## Product success
- the user prefers ClawFace over the existing web/control UI for routine desktop interaction
- drag/drop and paste flows feel excellent
- session switching feels natural
- tool activity is understandable without spelunking raw traces
- the app feels stable enough for regular use

## Technical success
- central renderer complexity is materially reduced
- platform/media logic is less entangled with UI rendering
- core state ownership is clearer than it is today
- the codebase is easier to expand without fear

## Strategic success
- the app is positioned to grow into richer OpenClaw-native surfaces later
- the project no longer risks becoming a generic chat shell by inertia

---

# 13. Risks to manage

## 13.1 Scope creep
The biggest risk is trying to build the whole OpenClaw operator console in Milestone 1.

### Mitigation
Stay focused on daily-use desktop chat excellence plus the first major OpenClaw-native differentiators.

## 13.2 Architecture work without product payoff
The second risk is spending a lot of time cleaning code without improving the product meaningfully.

### Mitigation
Tie refactors directly to milestone flows:
- session switching
- drag/drop
- tool visibility
- streaming UX

## 13.3 Feature work on top of bad structure
The third risk is skipping cleanup and pushing more capabilities into overloaded files.

### Mitigation
Require architecture progress as part of milestone completion.

---

# 14. Suggested implementation phases inside Milestone 1

## Phase A — foundation cleanup for the milestone
- map current chat/session/tool state ownership
- split `ChatView`
- introduce platform/media abstraction layer
- reduce the worst UI/platform coupling

## Phase B — core interaction flows
- stabilize connection behavior
- improve session switching/search UX
- improve thread rendering and streaming behavior
- improve composer and attachment handling

## Phase C — tool visibility and polish
- improve tool activity surfacing
- clean up tool-heavy response rendering
- improve attachment previews and image flows
- refine UX rough edges

## Phase D — hardening
- basic error-state pass
- reconnect/recovery pass
- desktop quality pass
- milestone readiness check against success criteria

---

# 15. What comes after Milestone 1

If Milestone 1 succeeds, the likely next frontier is Milestone 2 focused on deeper OpenClaw-native surfaces such as:
- approvals
- tasks/subagents
- nodes/devices
- richer tool inspectors
- memory/context surfaces

Milestone 1 should make those possible without forcing another major rewrite first.

---

# Final milestone summary

Milestone 1 is about delivering the first version of ClawFace that genuinely deserves to be the default desktop frontend for OpenClaw.

It should do a few things very well:
- conversation
- sessions
- media/file input
- streaming
- tool visibility
- desktop-native flow

And it should leave the codebase in a better state than it started.

That is the bar.
