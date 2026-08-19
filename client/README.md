# client/ — DSH web GUI half (方案 A: gallery)

This directory is the **browser half** of the wrapper. The DSH web shell
mounts it as a **client module**: `scripts/build-client.mjs` wraps
`design-view.js` into `bundle.js`, a classic script that registers a factory
via `window.__ModuleLoader__.load({ id, factory })`. The factory body requires
only platform static-table specifiers (`react`, ...) and exports the cordis
client plugin face (`inject` / `apply`).

## Files

- `logic.js` — **pure, node-tested** logic (Part D of test/smoke.mjs):
  tab ids, tab order, `designsDirFor` (cwd → designs dir), SSE frame parsing,
  node:selected message validation, click-to-ask draft text.
- `design-view.js` — the browser-half **source** (see header comment).
  Small helpers are inlined from `logic.js` because the browser half cannot
  import; keep them in sync (Part D tests the canonical copy in `logic.js`).
- `bundle.js` — **generated** client module (do not edit; `npm run
  build:client`).

## Host contract (same-origin HTTP routes on `ctx.webServer`, see plugin.js)

| route | args → result | backed by |
|---|---|---|
| `GET /canvas/designs` | `?sessionId=&root=` → `{ ok, root, base, files }` | workspace registry + `client/logic.js` `designsDirFor` + `ctx.canvasHarness.listFiles` |
| `GET /canvas/open` | `?file=` → 302 to the daemon viewer | `ctx.canvasHarness.openUrl(fileId)` |
| `GET /canvas/events` | `?file=` → SSE proxy (open/updated) | `ctx.canvasHarness.events(fileId, cb)` |

`DesignFile` follows Repo A's metadata contract: `{ id, name, relPath,
pageCount, frameCount, updatedAt, workspaceId }`.

## Verification status

- **Offline-verified** (test/smoke.mjs): tab id/order math, designs-dir
  mapping, SSE frame parsing, node:selected validation, draft text — against
  the REAL daemon protocol (Repo A 24/24 + wrapper A–E; Part E drives the
  `/canvas/*` host routes over a real http server + real daemon).
- **Requires the DSH web GUI** (not runnable in this repo's offline test):
  the actual tab rendering and slot registration against the live
  `conversation.view` ring. Install the bundle, restart the profile, then walk
  AC-01..AC-07 from the PRD.

## Mounting

The browser half ships inside this npm package as a **DSH client module**:

- `package.json` declares `dsh.client` (`platform: "web"`, inject:
  `@deepseek-ai/dsh-client-locale` / `-runtime` / `-ui-conversation`) and
  `exports["./client"]` → `client/bundle.js`. The Node half of
  `@deepseek-ai/dsh-client-modules` scans enabled Loader entries for `dsh.client`
  packages, hashes the built bundle into `window.__DSH_BOOT__`, and serves it
  at `/plugins/<id>/client.js`.
- `client/bundle.js` is a classic script registering a factory via
  `window.__ModuleLoader__.load({ id, factory })`. The factory body
  (`client/design-view.js`) requires only the platform static table
  (`react`, ...) and exports the cordis client plugin face
  (`inject: ["slots", "sessions", "locale"]`, `apply`), which registers the
  `设计大厅` entry on the `conversation.view` slot ring.
- Rebuild after editing the source: `npm run build:client` (wraps
  `client/design-view.js` into `client/bundle.js`).

The browser half talks to the host half over **same-origin HTTP routes**
registered by `plugin.js` on `ctx.webServer` (lazily acquired, so the plugin
still loads in bare cordis contexts):

| route | purpose | backed by |
|---|---|---|
| `GET /canvas/designs?sessionId=&root=` | design file list + daemon base | `ctx.canvasHarness.listFiles(designsDirFor(workspace.path))` |
| `GET /canvas/open?file=` | 302 to the daemon viewer | `ctx.canvasHarness.openUrl(fileId)` |
| `GET /canvas/events?file=` | SSE proxy of daemon update events | `ctx.canvasHarness.events(fileId, cb)` |

The click-to-ask bridge (`node:selected` postMessage) sets the composer draft
client-side via the conversation standard kit:
`ctx.sessions.provideInfo(sessionId).props.inputActions.setDraft(text)`.
