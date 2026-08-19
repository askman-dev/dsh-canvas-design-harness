# dsh-canvas-design-harness

Repo B of the two-repo split. Repo A is the engine
(`canvas-design-harness` skill: SKILL.md + reference/ + server/ + specs/),
this repo is the **DSH wrapper**: it makes Repo A's external capabilities
native to DeepSeek Harness while the skill keeps working standalone in
Codex / Claude Code / a bare terminal.

One skill tree, two plugin specs:

- **Codex / Claude Code spec** — the skill lives at `.agents/skills/canvas-design-harness/`.
  Any agent that scans `.agents/skills` picks it up with zero setup; the
  bundled server runs standalone (`node server/src/index.js <folder>`).
- **DeepSeek Harness plugin spec** — this repo is a DSH plugin *bundle*:
  `package.json` declares `dsh.bundle.patch`; `cordis.patch.yml` inserts two
  host-side rows; `plugin.js` registers skills AND the daemon lifecycle
  service; `host/tools-entry.js` registers the MCP tools bridge.

## What the wrapper adds on top of the skill

| Capability | Mechanism | Spec (Repo A) |
|---|---|---|
| Skills in the catalog from any workspace | `ctx.skills.register` (rank 250, hot reload) | — |
| Daemon lifecycle: probe → attach → spawn singleton on 127.0.0.1:9321 | `createCanvasHarness()` → `ctx.canvasHarness` (provided service) | `design_harness_external_process` |
| Workspace registration + file listing | `harness.ensureWorkspace(root)` / `listFiles(root)` | `design_harness_external_http` / `_file_identity` |
| Native model tools (`canvas_harness_*`) | `host/tools.js` + `ctx.tools.register` via `defineTool` | `design_harness_external_mcp` |
| Live change events | `harness.events(fileId, cb)` (SSE) | `design_harness_external_events` |
| (roadmap) GUI gallery + dynamic file tabs | client half, `conversation.view` slot | `design_harness_external_viewer_bridge` |

The model-facing tool surface is stable: every `canvas_harness_*` tool takes a
workspace `root` and a design `name` — never a server fileId (file ids churn
across rescans, spec `design_harness_external_file_identity`); the bridge
resolves (root, name) → fileId internally.

## Layout

```
dsh-canvas-design-harness/
├── .agents/skills/canvas-design-harness/   # verbatim skill (Repo A content)
│   ├── SKILL.md
│   ├── reference/     # canvas-frames.css / canvas-frames.js
│   ├── server/        # zero-dependency HTTP-MCP service (canvas-design-harness-server)
│   └── specs/         # design_harness.yaml + external_capabilities.yaml (the protocol)
├── package.json       # DSH bundle manifest (dsh.bundle.patch)
├── cordis.patch.yml   # inserts row 1 (plugin.js) + row 2 (host/tools-entry.js)
├── plugin.js          # skills registration + ctx.canvasHarness daemon service
├── host/
│   ├── tools.js       # pure tools-bridge logic (no @deepseek-ai imports, testable)
│   └── tools-entry.js # harness-facing entry wiring @deepseek-ai/dsh-tools defineTool
└── test/smoke.mjs     # offline smoke: A skills, B filesystem discovery, C daemon+tools
```

## Install as a DSH plugin

```sh
dsh plugin --profile web add /path/to/dsh-canvas-design-harness
```

Then restart the profile. On boot the wrapper registers the skill in the
catalog (`skill` tool / `/canvas-design-harness`), provides
`ctx.canvasHarness`, and adds the `canvas_harness_*` tools to the model.

## Use from Codex / Claude Code (Repo A standalone)

The skill has no dependency on DSH. Point your agent at
`.agents/skills/canvas-design-harness`, or run the server directly:

```sh
cd .agents/skills/canvas-design-harness/server
node src/index.js <your-designs-folder>      # http://127.0.0.1:9321
```

## Test

```sh
node test/smoke.mjs                 # Parts A–F: skills, discovery, daemon + tools, tab logic, /canvas routes E2E, webServer boot race
cd .agents/skills/canvas-design-harness/server && node test/smoke.js   # Repo A self-test 17/17
```

Parts C/E spawn REAL daemons on random test ports with temp designs folders
and exercise the full wrapper surface: workspace registration, file listing,
tool registration (real `defineTool` schema compilation), createFile, batch
(atomic page+frame+component), SSE update events, getDocument, validate —
plus the `/canvas/*` host routes over a real http server (Part E) and the
webServer boot race where plugin.js applies before the web stack is ready
(Part F).

## Acceptance against the live GUI

After changing host code (`plugin.js`) or the browser half, verify the running
profile actually loads the plugin — don't eyeball it:

```sh
npm run build:client        # 1. regenerate client/bundle.js from client/design-view.js
node test/smoke.mjs         # 2. offline suite (A–F)
node scripts/verify-web.mjs # 3. LIVE checks: client entry in __DSH_BOOT__, bundle served,
                            #    and — the one that catches the webServer boot race —
                            #    GET /canvas/designs must return JSON, not the SPA index
```

`verify-web.mjs` needs the GUI to be up. Restart the profile from a **normal
terminal** (not from inside the harness's sandboxed shell — a sandboxed
relaunch cannot write `~/.dsh/profiles/web/cordis.yml` and fails with EPERM):

```sh
python3 scripts/restart-web.py    # kills the process on :3080, relaunches dsh --profile web detached, waits for readiness
```

## Publish

npm-publishable as `dsh-canvas-design-harness`; `files` ships `plugin.js`,
`host/`, `client/`, `scripts/`, `cordis.patch.yml`, `.agents/skills`, and the
README, so an installed bundle carries the whole skill tree and the daemon.

## Client half (DSH web GUI: 方案 A tabs)

Implemented in `client/`:

- `client/logic.js` — pure tab-experience logic, **node-tested in Part D**:
  tab ids/order, `designsDirFor` (cwd → designs dir), SSE frame parsing,
  `node:selected` validation, click-to-ask draft text.
- `client/design-view.js` — the browser half **source** (see
  `client/README.md`): the `设计大厅` / `Design Gallery` tab on the
  `conversation.view` ring (order 20, right of chat/trajectory), the gallery
  grid, the embedded canvas viewer iframe, and the postMessage click-to-ask
  bridge into the composer draft. All user-facing strings go through the DSH
  locale service (zh/en dictionaries, `t(key, params)` interpolation — the
  same pattern as `@deepseek-ai/dsh-client-ui-trajectory`), so the plugin is
  bilingual. `scripts/build-client.mjs` wraps it into `client/bundle.js`, the
  client module the DSH web shell actually loads (`dsh.client` web entry +
  `exports["./client"]`, see `package.json`).
- `plugin.js` — the host half of the tab: registers same-origin `/canvas/*`
  routes on the harness web server. Registration waits for the `webServer`
  service through cordis's inject-wait (`ctx.inject(["webServer"], ...)`),
  because the web stack boots asynchronously and plugin.js can apply before
  it — without the wait, `/canvas/*` falls through to the SPA fallback and
  the tab shows the generic load error (this was the real-world bug behind
  "无法加载设计稿列表"). Routes: `GET /canvas/designs` (session workspace →
  designs dir → daemon file list, errors carry a stable `code` for the client
  to localize), `GET /canvas/open` (302 to the daemon viewer), `GET
  /canvas/events` (SSE proxy of daemon update events).

**Verification**: everything below the React layer is verified offline —
smoke Parts A–F (Part E drives the `/canvas/*` routes against a real daemon
over a real http server; Part F proves the webServer race fix) + Repo A 24/24
server self-test. The tab's live rendering needs the DSH web GUI: restart the
profile, run `scripts/verify-web.mjs`, and the tab appears on the conversation
view ring (walk AC-01..AC-07 from the PRD).

## Sync from upstream (Repo A — single source)

The ENGINE (SKILL.md, reference/, server/, specs/) is owned by Repo A (the
Codex skill) and copied here VERBATIM — there is only one implementation.
Re-sync and re-test both sides with:

```sh
scripts/sync-from-upstream.sh [upstream-skill-dir]
```
