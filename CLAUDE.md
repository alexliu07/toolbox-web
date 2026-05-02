# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start frontend (Vite) + backend (Express) concurrently
- `npm run devhost` — same but with `--host` for LAN access
- `npm run server` — start only the backend
- `npm run build` — Vite production build (outputs to `dist/`)
- `npm run preview` — preview production build locally

No test framework is configured. No linter is configured.

## Architecture

Desktop-style toolbox app where each tool opens as a floating window. Vue 3 + Vite frontend, Express backend on port 8081.

### Frontend (`src/`)

- **`App.vue`** — main shell: clock widget, tool launcher grid, window layer, auth gate, wallpaper system
- **`AppWindow.vue`** — reusable floating window (draggable, resizable 8-direction, maximize/restore, z-ordering, taskbar)
- **Composables** in `src/composables/`:
  - `useAuth.js` — singleton auth state, `authFetch()` wrapper, server-backed localStorage polyfill (replaces `window.localStorage` on login)
  - `useWindowManager.js` — `openWindow()`, `closeWindow()`, `bringToFront()`, `minimizeWindow()`, z-index management, `singletonKey` dedup
  - `iframeStorage.js` — `v-iframe-storage` directive that injects server-backed storage into iframes

### Backend (`server/`)

- **`server/index.js`** — Express entry, auto-discovers routes from `server/routes/*.js`, mounts each at `/api/{filename}`
- **`server/db.js`** — SQLite via `sql.js` (WASM, no native bindings), file at `server/database/main.db`, auto-saves every 30s
- **`server/middleware/auth.js`** — `requireAuth` (401 on failure) and `optionalAuth` (attaches `req.user` if token present); token from `Authorization: Bearer` header or `?token=` query param; 7-day expiry

### Dev Proxy

Vite proxies `/api` → `http://localhost:8081` in development. In production, serve `dist/` with a reverse proxy forwarding `/api/` to the backend.

## Adding a New Tool

Only two files needed — no registration code required:

1. **`src/components/YourTool.meta.js`** — metadata object:
   ```js
   export default {
     id: 'your-tool',       // unique key, matches config.json and singletonKey
     name: 'Tool Name',     // launcher grid display name
     icon: '🔧',            // emoji for launcher + taskbar
     gradient: 'linear-gradient(135deg,#color1,#color2)',
     windowTitle: 'Window Title',
     windowIcon: '🔧',
     width: 800,            // default window size
     height: 600,
     order: 5,              // sort order in launcher (lower = earlier)
   }
   ```

2. **`src/components/YourTool.vue`** — Vue 3 `<script setup>` component. Inject shared services from parent:
   ```js
   const authFetch = inject('authFetch')    // fetch with auth header
   const openWindow = inject('openWindow')  // open sub-windows
   const closeWindow = inject('closeWindow')
   const bringToFront = inject('bringToFront')
   const windows = inject('windows')        // reactive window list
   ```

`App.vue` auto-discovers via `import.meta.glob('./components/*.meta.js')` + `import.meta.glob('./components/!(*Window|Auth*|*.meta).vue')`. Tools can be enabled/disabled at runtime via `public/config.json` (keyed by tool `id`).

## Adding a Backend Route

Create `server/routes/yourname.js` — it auto-mounts at `/api/yourname`. Must `export default` an Express Router:
```js
import express from 'express'
const router = express.Router()
router.get('/endpoint', async (req, res) => { ... })
export default router
```

Use `requireAuth` or `optionalAuth` middleware from `../middleware/auth.js` for authenticated endpoints.

## Conventions

- **ESM everywhere** — both root and server packages use `"type": "module"`
- **UI text is in Chinese (Simplified)** — code comments are a mix of Chinese and English
- **No TypeScript** — plain JavaScript with Vue 3 Composition API (`<script setup>`)
- **`markRaw()`** — always wrap component refs passed to `openWindow()` with `markRaw(defineAsyncComponent(...))` to avoid Vue reactive overhead
- **Server-backed localStorage** — on login, `window.localStorage` is replaced with a Proxy that syncs to `/api/localstorage`; tool state (high scores, history, etc.) persists across devices automatically
- **Node requirement**: `^20.19.0 || >=22.12.0`
- **Server data** is stored in `server/database/`, `server/wallpapers/` — all gitignored except `.gitkeep` placeholders

## Deployment

GitHub Actions builds on push to `main`/`master`: `npm ci && npm run build`, packages `dist/` + `server/` as artifact. Production: extract, `cd server && npm install --production`, serve `dist/` with any static server, reverse proxy `/api/` to `http://127.0.0.1:8081`.
