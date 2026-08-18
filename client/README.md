# client/ — DSH web GUI half (方案 A: gallery + dynamic file tabs)

This directory is the **browser half** of the wrapper. The DSH web GUI mounts
dynamic packages whose browser-half source runs as an async function body with
the symbol surface `(React, console, styles, host, ...)` — no imports, no
fetch/setTimeout (trapped; network goes through the host half).

## Files

- `logic.js` — **pure, node-tested** logic (Part D of test/smoke.mjs):
  tab ids, tab order, `designsDirFor` (cwd → designs dir), SSE frame parsing,
  node:selected message validation, click-to-ask draft text.
- `design-view.js` — the browser-half source itself (see header comment).
  Small helpers are inlined from `logic.js` because the browser half cannot
  import; keep them in sync (Part D tests the canonical copy in `logic.js`).

## Host RPC contract (host half must provide via harness.handle)

| method | args → result | backed by |
|---|---|---|
| `designsDirForSession` | `{ sessionId, cwd? }` → designs dir string | session cwd + `client/logic.js` `designsDirFor` |
| `listDesigns` | `{ root }` → `DesignFile[]` | `ctx.canvasHarness.listFiles(root)` |
| `openUrl` | `{ fileId }` → viewer URL | `ctx.canvasHarness.openUrl(fileId)` |
| `setDraft` | `{ sessionId, text }` → void | sessions input API |
| `subscribe` | `{ fileId }` → unsubscribe (SSE) | `ctx.canvasHarness.events(fileId, cb)` |

`DesignFile` follows Repo A's metadata contract: `{ id, name, relPath,
pageCount, frameCount, updatedAt, workspaceId }`.

## Verification status

- **Offline-verified** (test/smoke.mjs): tab id/order math, designs-dir
  mapping, SSE frame parsing, node:selected validation, draft text — against
  the REAL daemon protocol (Repo A 24/24 + wrapper A/B/C).
- **Requires the DSH web GUI** (not runnable in this repo's offline test):
  the actual tab rendering, slot registration against the live
  `conversation.view` ring, and the iframe/postMessage wiring. Mount the
  browser half through the DSH dynamic-package loader and verify AC-01..AC-07
  from the PRD manually.

## Mounting

The browser half ships inside this npm package; the DSH web composition loads
it through the client modules / dynamic runner using the package's client
entry. Exact loader wiring depends on the DSH web build environment.
