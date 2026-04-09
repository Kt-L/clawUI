# Phase 1: Rollback Commands - Mermaid Integration

## Purpose
This document provides commands to rollback any changes made during the mermaid integration phases.

---

## Quick Rollback (All Phases Combined)

### Option 1: Git Reset (Recommended)
```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Create backup branch before rollback (optional but recommended)
git branch backup-before-rollback-$USER

# Reset to initial commit (preserves uncommitted changes to stash)
git add .
git stash save "Saved changes before rollback on $(date +%Y-%m-%d)"

# Reset to initial state
git reset --hard HEAD

# Clean up any untracked files
git clean -fd

# Apply stash if needed
git stash pop
```

### Option 2: Specific File Restoration
```bash
# Restore specific files to initial state
git checkout HEAD -- src/lib/markdown.ts src/main.tsx package.json src/styles.css

# Delete created files
rm -f src/components/MermaidProvider.tsx

# Remove Mermaid dependency from package.json (if modified)
npm uninstall mermaid 2>/dev/null
```

---

## Phase-by-Phase Rollback Commands

### Phase 2: Dependency Management Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Remove Mermaid package
npm uninstall mermaid

# Restore package.json to initial state
git checkout HEAD -- package.json

# Reinstall original dependencies
npm ci

# Verify package.json has no mermaid entry
grep -q "mermaid" package.json && echo "ERROR: Mermaid still present" || echo "OK: Mermaid removed"
```

---

### Phase 3: Component Creation Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Remove created MermaidProvider.tsx
rm -f src/components/MermaidProvider.tsx

# Restore components directory to initial state
git checkout HEAD -- src/components/

# Verify file removal
ls src/components/MermaidProvider.tsx 2>/dev/null && echo "ERROR: File still exists" || echo "OK: File removed"
```

---

### Phase 4: Markdown Integration Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Restore markdown.ts to initial state
git checkout HEAD -- src/lib/markdown.ts

# Verify restoration
git diff HEAD src/lib/markdown.ts

# Should show no changes
```

---

### Phase 5: CSS Integration Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Restore styles.css to initial state
git checkout HEAD -- src/styles.css

# Verify restoration
git diff HEAD src/styles.css

# Should show no changes
```

---

### Phase 6: Testing Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Remove test files if created
rm -f src/__tests__/mermaid.test.tsx
rm -f src/__tests__/markdown-mermaid.test.ts

# Restore test configuration if modified
git checkout HEAD -- tsconfig.json vite.config.ts

# Clean test cache (if using Vitest)
rm -rf node_modules/.vite

# Verify removal
find src/__tests__ -name "*mermaid*" 2>/dev/null || echo "OK: Test files removed"
```

---

### Phase 7: CI/CD Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Restore CI/CD configuration files
git checkout HEAD -- .github/workflows/*.yml 2>/dev/null
git checkout HEAD -- .github/*.yml 2>/dev/null

# Restore linting configuration
git checkout HEAD -- .eslintrc.cjs .prettierrc 2>/dev/null

# Restore build configuration
git checkout HEAD -- vite.config.ts

# Verify restoration
git status
```

---

### Phase 8: Documentation Rollback

```bash
# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Keep phase documentation files for reference (recommended)
# OR remove all phase documentation:
# rm -f docs/phase-*.md

# Restore README.md if modified
git checkout HEAD -- README.md

# Keep docs/phase-1-checkpoint.md as a reference snapshot
```

---

## Verification Commands

### Verify Clean State
```bash
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Check for any uncommitted changes
git status

# Should show: "nothing to commit, working tree clean"

# Check for untracked files
git clean -n -d

# Should show: (no output or only docs/phase files if not removed)

# Verify package.json doesn't contain mermaid
grep "mermaid" package.json && echo "ERROR: mermaid dependency present" || echo "OK: no mermaid dependency"

# Verify markdown.ts has no mermaid imports
grep "import mermaid" src/lib/markdown.ts && echo "ERROR: mermaid import found" || echo "OK: no mermaid import"

# Verify main.tsx has no mermaid CSS import
grep "mermaid.css" src/main.tsx && echo "ERROR: mermaid.css import found" || echo "OK: no mermaid.css import"

# Verify styles.css has no mermaid classes
grep "\.mermaid" src/styles.css && echo "ERROR: mermaid CSS found" || echo "OK: no mermaid CSS"

# Verify MermaidProvider.tsx doesn't exist
ls src/components/MermaidProvider.tsx 2>/dev/null && echo "ERROR: MermaidProvider exists" || echo "OK: MermaidProvider removed"
```

### Final Verification Script
```bash
#!/bin/bash
# Run this to verify complete rollback

cd /home/cresh/.openclaw/workspace-cresh/clawUI

echo "=== Rollback Verification ==="
echo ""

# 1. Check git status
echo "1. Git Status:"
git status --short
echo ""

# 2. Check dependencies
echo "2. Dependency Check:"
if grep -q "mermaid" package.json; then
  echo "   ❌ FAIL: mermaid dependency still present"
  exit 1
else
  echo "   ✅ PASS: No mermaid dependency"
fi

# 3. Check mermaid imports
echo "3. Import Check:"
if grep -q "import mermaid" src/lib/markdown.ts 2>/dev/null || \
   grep -q "mermaid.css" src/main.tsx 2>/dev/null; then
  echo "   ❌ FAIL: mermaid imports found"
  exit 1
else
  echo "   ✅ PASS: No mermaid imports"
fi

# 4. Check created files
echo "4. File Check:"
if [ -f "src/components/MermaidProvider.tsx" ]; then
  echo "   ❌ FAIL: MermaidProvider.tsx still exists"
  exit 1
else
  echo "   ✅ PASS: MermaidProvider.tsx removed"
fi

# 5. Check styles
echo "5. CSS Check:"
if grep -q "\.mermaid" src/styles.css 2>/dev/null; then
  echo "   ❌ FAIL: Mermaid CSS classes found"
  exit 1
else
  echo "   ✅ PASS: No mermaid CSS classes"
fi

# 6. Build verification
echo "6. Build Test:"
if npm run build --silent 2>&1; then
  echo "   ✅ PASS: Build succeeds without mermaid"
else
  echo "   ❌ FAIL: Build failed (unexpected)"
  exit 1
fi

echo ""
echo "=== All Checks Passed ==="
echo "Rollback successful: Mermaid integration completely removed"
```

---

## Emergency Rollback

If any error occurs that corrupts the build or causes runtime issues:

```bash
# Stop any running processes
pkill -f "vite|npm|node"

# Navigate to project root
cd /home/cresh/.openclaw/workspace-cresh/clawUI

# Git reset to stable state (use first commit hash)
git add .
git stash save "Emergency stash before reset on $(date +%Y-%m-%d)"

# Get the first commit hash from the branch
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)

# Hard reset to initial commit
git reset --hard $FIRST_COMMIT

# Clean up
git clean -fd

# Reinstall fresh dependencies
rm -rf node_modules package-lock.json
npm install

# Verify build
npm run build
```

---

## Rollback Execution Checklist

### Before Rollback:
- [ ] Stop development server (Ctrl+C)
- [ ] Commit any work-in-progress changes (create separate branch)
- [ ] Create snapshot of current state (backup branch)

### During Rollback:
- [ ] Run verification commands after each step
- [ ] Check for errors in terminal output
- [ ] Verify build still works: `npm run build`

### After Rollback:
- [ ] Run final verification script
- [ ] Test application loads without errors
- [ ] Verify existing features still work
- [ ] Update progress documentation (docs/README.md)

---

## Rollback Notes

### Preserved After Rollback:
- ✅ Phase documentation files (`docs/phase-*.md`) kept for reference
- ✅ Package-lock.json automatically regenerated during clean install
- ✅ Node modules restored via `npm install` or `npm ci`

### Removed During Rollback:
- ❌ Mermaid package (`mermaid`)
- ❌ MermaidProvider component (`src/components/MermaidProvider.tsx`)
- ❌ Mermaid imports in files
- ❌ Mermaid CSS imports
- ❌ Mermaid styles in `styles.css`
- ❌ Mermaid test files (if created)

### Manual Cleanup (If Needed):
```bash
# Check for any remaining mermaid references
grep -r "mermaid" --include="*.tsx" --include="*.ts" --include="*.css" src/ && echo "Found remaining references"

# Remove any mermaid-specific cache directories
rm -rf node_modules/.vite node_modules/.cache
```

---

**Last Updated:** 2026-04-01
**Phase:** 1
**Status:** Ready for rollback execution if needed
