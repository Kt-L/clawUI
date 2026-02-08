# Development Constraints

This project must run in a pinned Linux environment. Follow these rules:

1. Use pinned runtime:
- Node.js `22.22.0` from `.nvmrc`
- npm `10.9.4` from `package.json#packageManager`

2. Never copy `node_modules/` between machines.
- Install deps per machine with `npm ci`

3. `package-lock.json` ownership:
- It may be updated only in the pinned Linux environment
- Commits that change `package-lock.json` are blocked outside that environment

4. Required checks before merge:
- `npm run check:env`
- `npm run build`

5. One-time hook setup after clone:
- `npm run hooks:install`

## Standard flow

```bash
nvm use
npm ci
npm run dev -- --host 127.0.0.1 --port 3000
```

## Dependency update flow (only in pinned Linux env)

```bash
nvm use
npm install <pkg>
npm run check:env
npm run build
git add package.json package-lock.json
git commit -m "chore: update dependency"
```
