# ClawFace Product Brief

## Working title

ClawFace

## One-line product definition

ClawFace is a standalone desktop client for OpenClaw that treats OpenClaw’s tools, sessions, devices, tasks, and runtime capabilities as first-class parts of the user experience — not as hidden backend details or an afterthought bolted onto a chat shell.

---

# 1. Product intent

ClawFace should not become:
- a generic multi-provider chatbot shell
- a web-first team collaboration product
- a prettier configuration panel for OpenClaw
- a thin wrapper over the existing Control UI

OpenClaw already has:
- a backend management plane
- a chat surface
- configuration and operational controls

ClawFace exists as the **frontend product layer** on top of that backend.

Its job is to make OpenClaw feel like a coherent, powerful, desktop-native personal AI environment.

## Core framing

ClawFace should feel like:

> a personal AI cockpit with a conversational center

not:

> a chatbot with a settings drawer

---

# 2. Vision

ClawFace is the best way to *use* OpenClaw day to day on a desktop machine.

It should combine:
- the immediacy and comfort of a modern chat interface
- the power of OpenClaw’s extensive tooling
- strong visibility into what the system is doing
- desktop-native affordances like drag/drop, file access, image handling, and local workflows

The app should make OpenClaw’s strengths obvious:
- multi-session operation
- tool use and tool output
- long-running tasks
- subagents and orchestration
- device/node control
- browser/canvas/media actions
- memory and reminders
- rich local and self-hosted workflows

The product should help OpenClaw feel less like:
- a collection of backend powers hidden behind CLI and web admin surfaces

and more like:
- an integrated personal AI operating surface

---

# 3. Target user

## Primary user
A technically sophisticated single-user OpenClaw operator who:
- runs OpenClaw locally or on self-hosted infrastructure
- wants desktop-native day-to-day interaction
- cares about local-first workflows and operational visibility
- wants more than just prompt/response chat
- is willing to use a richer interface if it earns its complexity

## Typical profile
- developer
- platform engineer
- technical artist
- creative technologist
- self-hosting enthusiast
- AI power user

## Secondary user
An advanced OpenClaw user who starts with chat but gradually wants stronger access to:
- tools
- sessions
- files
- tasks
- devices
- operational state

---

# 4. Problem statement

OpenClaw is already powerful, but its power is spread across several surfaces:
- CLI
- control UI
- dashboard/configuration
- chat surfaces
- companion apps
- nodes/devices

That is great for flexibility, but it creates fragmentation.

A user can do powerful things, but the system can still feel like:
- a gateway with many capabilities
- not yet a single excellent desktop product

## The problem ClawFace solves

ClawFace should unify the *experience* of OpenClaw without trying to replace its backend control plane.

It should make it easier to:
- converse naturally
- drag and drop files/images into analysis flows
- see tool usage clearly
- understand session and task state
- operate OpenClaw’s broader capability set without dropping into multiple surfaces all the time

---

# 5. Product principles

## 5.1 OpenClaw-native, not provider-native
ClawFace should be designed around OpenClaw’s capabilities, not around abstracting many LLM providers behind a generic assistant UI.

Provider and model selection matter, but they are not the product center.

## 5.2 Conversational core, operational edges
The main interaction model can remain chat-centric, but the product must also expose:
- tools
- tasks
- sessions
- devices
- capabilities

as first-class surfaces.

## 5.3 Desktop-native by design
This is a desktop application.
That should mean:
- drag and drop works beautifully
- local files are easy to use
- images are effortless to inspect and analyze
- local-first workflows feel natural
- the app takes advantage of native affordances where useful

## 5.4 Visibility over fake simplicity
The app should reduce friction, but not by hiding the fact that OpenClaw is doing real work.

Users should be able to see:
- what tool is running
- what session is active
- when a background task exists
- when approval is needed
- what device/node is involved

## 5.5 Personal, not enterprise-by-default
ClawFace is not a Slack/Jira/Notion collaboration layer first.
It is a personal AI control surface first.

## 5.6 Frontend product, not backend admin replacement
OpenClaw’s existing config/admin surfaces can remain the backend management plane.
ClawFace should focus on the user-facing working experience.

---

# 6. What makes ClawFace different

ClawFace should not compete on:
- generic "chat with many models"
- superficial assistant theming
- team workspaces and enterprise admin abstractions

It should differentiate through OpenClaw-native capability exposure.

## Key differentiators

### 6.1 Tools are first-class
Not just hidden in message traces.
Users should be able to clearly see:
- tool starts/stops
- outputs
- progress
- failures
- context around why a tool ran

### 6.2 Sessions are real working contexts
OpenClaw has a richer session model than most assistant products.
ClawFace should treat sessions as meaningful work contexts, not just chat tabs.

### 6.3 Tasks and orchestration matter
OpenClaw supports:
- subagents
- background tasks
- cross-session messaging
- scheduling/reminders

These should eventually become visible, understandable, and manageable.

### 6.4 Devices and nodes matter
OpenClaw supports:
- mobile nodes
- camera/screen capture
- browser control
- notifications
- location/device surfaces

ClawFace should eventually expose these as part of the desktop product experience.

### 6.5 Files and media should feel effortless
Drag and drop should be a core joy point.
The app should make it easy to:
- drop screenshots
- paste images
- attach files
- inspect media
- route those inputs into analysis workflows cleanly

### 6.6 Local/self-hosted workflows are a feature
Unlike hosted AI shells, OpenClaw is built for self-hosted, local, high-power workflows.
ClawFace should embrace that rather than hide it.

---

# 7. Core jobs to be done

## 7.1 Talk to OpenClaw naturally
Users need a fluent, pleasant, modern chat experience for normal interaction.

## 7.2 Drop in artifacts for analysis
Users need to drag and drop:
- screenshots
- images
- files
- documents

and have the app make analysis feel immediate.

## 7.3 Understand what OpenClaw is doing
Users need visibility into:
- tool activity
- task state
- streaming responses
- long-running operations
- approvals or blocked actions

## 7.4 Navigate multiple contexts
Users need to move between:
- sessions
- topics
- task contexts
- working threads

without losing track of what is happening.

## 7.5 Operate richer OpenClaw capabilities
Users need access to features beyond plain chat, such as:
- browser interactions
- camera/image analysis
- node/device actions
- memory-aware workflows
- reminders/tasks
- cross-session orchestration

## 7.6 Stay in desktop flow
Users should not constantly need to jump to:
- CLI
- Control UI
- browser tabs
- backend admin screens

unless they want the lower-level surfaces.

---

# 8. Core product surfaces

These should guide both design and architecture.

## 8.1 Chat thread
The conversational center of the app.

Responsibilities:
- user messages
- assistant replies
- streaming
- attachments
- rich message rendering
- drag/drop/paste entry

## 8.2 Composer and input tray
Responsibilities:
- text entry
- drag/drop
- paste image/file support
- slash commands or action shortcuts
- lightweight model/runtime controls near composition

## 8.3 Session sidebar
Responsibilities:
- session browsing
- search/filter
- context switching
- recent/active context visibility

## 8.4 Tool activity / tool inspector
Responsibilities:
- show active and recent tool operations
- show outputs and failures
- connect tool activity to the thread context

This is likely one of the most important product differentiators.

## 8.5 Task / background work surface
Eventually should expose:
- long-running tasks
- subagents
- scheduled/cron jobs
- waiting/background states

## 8.6 Approval surface
When actions require user approval, this should be obvious and actionable.

## 8.7 Device / node surface
Eventually should expose:
- paired devices/nodes
- device-specific actions
- camera/screen/location-like capabilities
- capability availability and current state

## 8.8 Settings / runtime controls
Needed, but not the star.

The app should include runtime/user controls where needed, but should not become primarily a settings-heavy admin shell.

---

# 9. Opportunities suggested by OpenClaw itself

Based on the OpenClaw codebase and docs, there are several particularly strong integration opportunities.

## 9.1 Session-native UX
OpenClaw treats sessions as fundamental.
ClawFace should likely make sessions more visible and more operable than generic chat apps do.

Opportunity:
- stronger session browser
- session metadata and state
- session switching that feels like moving between active working minds/contexts

## 9.2 Tool-first UX
OpenClaw has first-class tools for:
- browser
- canvas
- nodes
- cron
- sessions
- message/tooling actions
- media analysis
- PDF/image workflows

Opportunity:
- dedicated tool timeline
- tool output drawer/inspector
- active tool state next to thread
- better differentiation between plain text and actionful work

## 9.3 Nodes and device capabilities
OpenClaw supports paired nodes and rich device capability surfaces.

Opportunity:
- show paired devices
- surface device actions in human-friendly ways
- tie camera/screen capture workflows directly into conversation and tasks

## 9.4 Background work and orchestration
OpenClaw supports:
- sessions spawn
- background tasks
- cron/reminders
- cross-session messaging

Opportunity:
- create a sense that the assistant can keep working beyond the current visible thread
- expose waiting, running, finished, and failed work in a desktop-native way

## 9.5 Memory and continuity
OpenClaw has a memory model and persistent context conventions.

Opportunity:
- make memory use more legible
- help users understand what is being remembered or referenced
- potentially expose continuity without making it feel creepy

## 9.6 Browser/canvas/computer-use flows
OpenClaw supports browser automation and canvas surfaces.

Opportunity:
- richer inspection of browser steps and outcomes
- desktop-native views around computer-use workflows
- artifact/history display for these actions

## 9.7 Media-heavy interaction
OpenClaw already supports image analysis and broader media handling.

Opportunity:
- frictionless screenshot drop/paste flow
- image inspection and comparison surfaces
- better attachment UX than generic chat apps

---

# 10. Explicit non-goals

ClawFace should **not** aim to be:

## 10.1 A generic multi-provider shell
This is not about becoming another “bring your API key and pick from 50 providers” desktop app.

Provider support matters only insofar as OpenClaw already supports it.
The product center is OpenClaw, not provider abstraction.

## 10.2 A team collaboration workspace first
Not Slack/Discord/Notion/Jira-with-AI.
Multi-user/team features are not the product core.

## 10.3 A replacement for OpenClaw backend configuration surfaces
OpenClaw already has backend management/config surfaces.
ClawFace should integrate with those, not try to replicate every admin function in a second UI.

## 10.4 A hidden-magic black box
The product should feel polished, but not misleadingly simple.
OpenClaw is powerful because it actually does things.
That should remain legible.

## 10.5 A web-first app in desktop clothing
If the product is a desktop app, it should earn that choice through:
- drag/drop
- file/media handling
- local integration
- desktop ergonomics

---

# 11. UX quality bar

The app should feel:
- calm
- capable
- legible
- desktop-native
- conversational without being toy-like
- more transparent than ChatGPT where OpenClaw’s actionfulness matters

It should avoid feeling like:
- a generic clone
- an ops dashboard with a chat box glued on
- a preference panel posing as a product

---

# 12. First milestone priorities

## Milestone 1: Become the best desktop way to chat with OpenClaw
Focus on:
- stable session handling
- excellent drag/drop and paste flows for images/files
- reliable streaming
- visible tool activity
- clear runtime controls where useful
- good desktop polish

This should produce a genuinely good everyday client even before bigger feature surfaces mature.

## Milestone 2: Expose OpenClaw’s actionfulness more clearly
Focus on:
- tool inspector/timeline
- approvals
- richer attachment/media handling
- clearer long-running operation state

## Milestone 3: Surface orchestration and devices
Focus on:
- tasks/subagents
- nodes/devices
- richer OpenClaw-native work surfaces beyond the thread

---

# 13. Product implications for architecture

This brief implies several architectural requirements:

## 13.1 The app cannot remain a giant chat component
The product is too rich for that.

## 13.2 Domain modeling matters
The system needs first-class models for:
- sessions
- messages
- tools
- tasks
- approvals
- nodes/devices
- attachments/artifacts

## 13.3 Desktop/platform logic must be isolated
Drag/drop, files, images, clipboard, and local access should be excellent — which means the platform layer must be real, not sprinkled across UI components.

## 13.4 Tool and task visibility must be designed in, not bolted on
That means architecture and UX should assume actionful work is central.

---

# 14. Product thesis

If OpenClaw is the backend brain and capability engine, then ClawFace should become the desktop face that finally makes those capabilities feel coherent, visible, and pleasant to use.

## Short thesis statement

> ClawFace should make OpenClaw feel like a real personal AI workstation, not just a backend with a chat window.

---

# 15. Immediate next product steps

## 1. Validate this brief against the current ClawFace UI
Which current surfaces align, and which feel like leftovers from a more generic assistant client?

## 2. Turn product principles into architecture requirements
Map:
- drag/drop
- tool visibility
- session-native UX
- task visibility
- device/node integration

to concrete refactor priorities.

## 3. Define Milestone 1 in more detail
A likely next planning doc should specify:
- essential user flows
- required capabilities
- what counts as “done” for the first serious release line

---

# Final summary

ClawFace exists to be the best desktop frontend for OpenClaw — one that embraces OpenClaw’s real capabilities instead of flattening them into a generic chatbot product.

The app should center conversation, but it should also make tools, sessions, media, tasks, and devices feel like natural, visible parts of the same experience.
