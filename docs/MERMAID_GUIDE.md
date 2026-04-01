# Mermaid Diagram User Guide

## Overview

ClawUI now supports native mermaid.js diagram rendering in markdown code blocks.

## Getting Started

### Basic Usage

Wrap mermaid syntax in markdown code blocks with `mermaid` language identifier:

```mermaid
flowchart LR
    Start --> End
```

### Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Process}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
```

### Sequence Diagram

```mermaid
sequenceDiagram
    participant Alice
    participant Bob
    Alice->>John: Hello John, how are you?
    loop Health Check
        John->>John: Fight against hypochondria
    end
    Note right of John: Rational thoughts!
```

### Gantt Chart

```mermaid
gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Research       :a1, 2024-04-01, 30d
    Development    :a2, after a1, 40d
    section Phase 2
    Testing        :a3, after a2, 20d
```

### State Diagram

```mermaid
stateDiagram-v2
    [*] --> Still
    Still --> [*]
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
```

## Supported Diagram Types

| Type | Markdown Syntax | Example |
|------|----------------|--------|
| Flowchart | `flowchart TD` or `flowchart LR` | [See above] |
| Sequence | `sequenceDiagram` | [See above] |
| Gantt | `gantt` | [See above] |
| State | `stateDiagram` or `stateDiagram-v2` | [See above] |
| ER (Entity-Relationship) | `erDiagram` | `erDiagram\n  CUSTOMER ||--o{ ORDER : places` |
| Mindmap | `mindmap` | `mindmap\n(root((Mermaid)))` |
| Pie | `pie` | `pie title Tasks\n"Done" : 70` |
| Journey | `journey` | `journey\ntitle My journey\nsection Go\n` |
| Git | `gitGraph` | `gitGraph\ncommit; commit` |

## Customization

### Dark Theme

Mermaid automatically uses ClawUI's dark theme via CSS variables (`--claw-panel-bg`, `--claw-text`, `--claw-border`).

### Light Theme Support

Light theme inherits automatically via mermaid's default styles.

## Troubleshooting

### Diagram Not Rendering

**Symptom:** Mermaid syntax shows as code block, no diagram appears.

**Solutions:**
1. Check correct language identifier: `\`\`\`mermaid` (not `\`\`\`md`)
2. Verify mermaid syntax is valid: https://mermaid.live/editor
3. Check dev console for JavaScript errors
4. Refresh dev server: Ctrl+R / Cmd+R

### Dark Theme Not Matching

**Symptom:** Diagram colors don't match ClawUI dark theme.

**Solution:** Mermaid uses `theme: "dark"` with CSS variable overrides. Check browser console to ensure CSS variables are loaded.

### Mobile Overflow

**Symptom:** Diagram causes horizontal scrollbar on mobile.

**Solution:** CSS includes `overflow: auto` and `min-width` constraints. Large diagrams may overflow (intended behavior). Try simplifying diagram for mobile.

### Performance Issues

**Symptom:** Page slow when rendering many diagrams.

**Solution:**
- Mermaid is debounced (100ms batch)
- Concurrent renders limited to max 3
- SVG caching enabled
- If persisting issues, report in GitHub issue: https://github.com/Kt-L/clawUI/issues

## Accessibility

Mermaid diagrams include:
- `aria-label` attributes
- Fallback text for screen readers
- Reduced motion preference support

## Resources

- Mermaid documentation: https://mermaid.js.org/
- Mermaid live editor: https://mermaid.live/
- ClawUI issues: https://github.com/Kt-L/clawUI/issues
