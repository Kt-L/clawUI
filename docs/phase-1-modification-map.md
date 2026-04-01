# Phase 1: File Structure Analysis - Mermaid Integration

## Analysis Summary

**Date:** 2026-04-01
**Status:** ✅ COMPLETE
**Repository:** Kt-L/clawUI (feature/mermaid-rendering branch)

---

## Current Project Structure

### Entry Points
- **`src/main.tsx`** - Application entry point, React rendering root
- **`src/app.tsx`** - Main application component (6623+ lines)

### Key Directories
```
clawUI/
├── src/
│   ├── components/       # React components
│   │   ├── ChatView.tsx (102KB)
│   │   ├── FileManager.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── SessionSidebar.tsx
│   │   └── NewSessionModal.tsx
│   ├── lib/             # Core libraries
│   │   ├── markdown.ts   # Markdown rendering with KaTeX
│   │   ├── gateway.ts
│   │   ├── types.ts
│   │   └── ...
│   ├── hooks/
│   ├── styles.css       # Global styles (CSS-in-JS approach)
│   └── index.tsx
├── docs/                # Documentation
└── package.json
```

---

## Files Requiring Modifications

### 1. `src/lib/markdown.ts` ⚠️ CRITICAL

**Current State:**
- Line count: ~320+ lines
- Purpose: Markdown rendering with KaTeX support
- Key functions:
  - `renderMarkdown(text: string): string`
  - Uses Marked parser with marked-katex-extension
  - DOMPurify for sanitization

**Modifications Needed:**
```typescript
// Add imports
import mermaid from 'mermaid';

// Initialize Mermaid (add at module level or within renderMarkdown)
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose', // Required for markdown-parsed SVGs
});

// Add Mermaid diagram detection & rendering
// Pattern: ```mermaid ... ``` fences
```

**Changes:**
- [ ] Add Mermaid import
- [ ] Add Mermaid configuration (per Google's recommended security settings)
- [ ] Implement mermaid diagram parsing within marked lexer
- [ ] Add pre-render for code blocks detected as mermaid (use mermaid.render)
- [ ] Update DOMPurify allowed tags/attrs to include Mermaid SVG tags
- [ ] Add error handling for invalid Mermaid syntax

**Complexity:** HIGH - Core rendering path modification

---

### 2. `src/main.tsx` ⚠️ REQUIRED

**Current State:**
- Imports KaTeX CSS: `import "katex/dist/katex.min.css";`
- Mounts `<App />` to `#root`

**Modifications Needed:**
```typescript
// Add Mermaid CSS import
import "mermaid/dist/mermaid.css";
```

**Changes:**
- [ ] Add Mermaid CSS import
- [ ] Verify import order (after existing KaTeX import)

**Complexity:** LOW - Single line addition

---

### 3. `package.json` ⚠️ REQUIRED

**Current State:**
- Existing dependencies include:
  - `katex`
  - `marked`
  - `marked-katex-extension`
  - `dompurify`

**Modifications Needed:**
```json
{
  "dependencies": {
    "mermaid": "^11.0.0"  // Add latest stable version
  }
}
```

**Changes:**
- [ ] Add `mermaid` to dependencies
- [ ] Run `npm install` / `npm ci` to install

**Complexity:** LOW - Standard dependency addition

---

### 4. `src/styles.css` ⚠️ OPTIONAL but RECOMMENDED

**Current State:**
- Comprehensive custom CSS (~3000+ lines)
- Contains markdown-specific styles:
  - `.markdown .md-code`
  - `.markdown pre`
  - `.markdown code`
  - `.markdown .katex` (already present for KaTeX)

**Modifications Needed:**
```css
/* Add Mermaid diagram container styles */
.markdown .mermaid {
  background: var(--claw-neutral-50, #f4f4f5);
  border-radius: var(--claw-radius-md, 12px);
  padding: 12px 16px;
  margin: 0.95rem 0;
  border: 1px solid var(--claw-border, #e5e7eb);
  overflow-x: auto;
  text-align: center;
}

/* Mermaid SVG container */
.markdown .mermaid > svg {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}
```

**Changes:**
- [ ] Add Mermaid-specific CSS classes
- [ ] Follow existing design system variables
- [ ] Ensure responsive behavior
- [ ] Add dark mode considerations (if applicable)

**Complexity:** LOW - CSS addition following existing patterns

---

## Files to Create (New Files)

### 1. `src/components/MermaidProvider.tsx` ⚠️ OPTIONAL

**Purpose:** React context provider for centralized Mermaid configuration

**Proposed Implementation:**
```typescript
import { createContext, useContext, useEffect, ReactNode } from "react";
import mermaid from "mermaid";

type MermaidProviderProps = {
  children: ReactNode;
  theme?: "default" | "forest" | "dark" | "neutral" | "base";
  startOnLoad?: boolean;
};

export function MermaidProvider({
  children,
  theme = "default",
  startOnLoad = false,
}: MermaidProviderProps) {
  useEffect(() => {
    mermaid.initialize({
      startOnLoad,
      theme,
      securityLevel: "loose", // Required for markdown-parsed SVGs
      logLevel: "error",
    });
  }, [theme, startOnLoad]);

  return <>{children}</>;
}

export const useMermaid = () => {
  // Return mermaid API if needed by components
  return mermaid;
};
```

**Usage in app.tsx:**
```tsx
<MermaidProvider theme="default">
  <App />
</MermaidProvider>
```

**Complexity:** MEDIUM - Context provider pattern

**Note:** If creating a provider exceeds phase scope, Mermaid can be initialized directly in `markdown.ts` instead.

---

## Files NOT Requiring Changes (Verified)

### ✅ No Changes Needed:
- `src/app.tsx` - No direct rendering logic for diagrams
- `src/components/ChatView.tsx` - Uses `renderMarkdown()` internally
- `src/components/FileManager.tsx` - File management only
- `src/components/SessionSidebar.tsx` - Session navigation only
- `src/components/SettingsModal.tsx` - UI settings only
- `src/components/NewSessionModal.tsx` - Modal only
- `src/lib/gateway.ts` - WebSocket client only
- `src/lib/types.ts` - TypeScript definitions (may need one type for Mermaid error messages)
- `src/lib/ui-settings.ts` - Settings management (optional: add Mermaid theme setting later)
- `src/hooks/` - All hooks
- `vite.config.ts` - Build configuration (no code splitting changes needed)
- `tsconfig.json` - TypeScript configuration (no module resolution changes needed)

---

## Integration Flow After Phase 1

### Data Flow:
```
User Input (Mermaid code block)
    ↓
renderMarkdown() in markdown.ts
    ↓
1. Detect ```mermaid ... ``` fence
2. Pass code to mermaid.render()
3. Receive SVG string
4. Inject SVG into HTML
5. DOMPurify sanitization (Mermaid SVG tags allowed)
    ↓
dangerouslySetInnerHTML in ChatView.tsx
    ↓
Rendered Mermaid diagram
```

### Security Considerations:
- **sanitizeAllowedTags:** Must include Mermaid SVG structure tags
- **sanitizeAllowedAttrs:** Must include Mermaid-specific attributes
- **mermaid.securityLevel:** Set to `"loose"` (per Google guidance) to allow inline SVGs from parsed markdown

### Performance Considerations:
- **Caching:** Mermaid SVGs should be cached (consider expanding existing `markdownHtmlCache` pattern)
- **Async Rendering:** Mermaid.render() is async; must await before DOMPurify.sanitize()
- **Bundle Size:** Mermaid is ~500KB minified; may impact initial load

---

## Phase Summary

### Files to Modify: 3
1. `src/lib/markdown.ts` (HIGH complexity)
2. `src/main.tsx` (LOW complexity)
3. `package.json` (LOW complexity)
4. `src/styles.css` (LOW complexity but recommended)

### Files to Create: 0-1 (optional provider-based approach)
1. `src/components/MermaidProvider.tsx` (MEDIUM complexity, optional)

### Integration Approach:
- **Primary:** Direct Mermaid initialization in `markdown.ts`
- **Alternative:** React Context Provider (more flexible, adds minimal overhead)

### Risk Assessment:
- **Breaking Changes:** LOW - New feature only
- **Regression Risk:** LOW - Changes isolated to markdown rendering
- **Performance Impact:** LOW → MEDIUM (depends on caching strategy)

---

## Next Steps (Phase 2)

1. ✅ Complete Phase 1: File structure analysis
2. ⏭️ Phase 2: Dependency management (add Mermaid package)
3. ⏭️ Phase 3: Component creation (or initialization in markdown.ts)
4. ⏭️ Phase 4: Markdown integration (core rendering logic)
5. ⏭️ Phase 5: CSS integration (diagram styling)
6. ⏭️ Phase 6: Testing suite (verify rendering, security, caching)
7. ⏭️ Phase 7: CI/CD setup (linting, testing)
8. ⏬ Phase 8: Documentation (usage guide)

---

**Analyzed by:** Subagent `mermaid-phase-1-analysis`
**Completed:** 2026-04-01
**Status:** READY FOR PHASE 2
