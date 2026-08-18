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
node test/smoke.mjs                 # A (7) + B (4) + C (7): skills, discovery, real daemon + tools bridge
cd .agents/skills/canvas-design-harness/server && node test/smoke.js   # Repo A self-test 17/17
```

Part C spawns a REAL daemon on a random test port with a temp designs folder
and exercises the full wrapper surface: workspace registration, file listing,
tool registration (real `defineTool` schema compilation), createFile, batch
(atomic page+frame+component), SSE update events, getDocument, validate.

## Publish

npm-publishable as `dsh-canvas-design-harness`; `files` ships `plugin.js`,
`host/`, `cordis.patch.yml`, `.agents/skills`, and the README, so an installed
bundle carries the whole skill tree and the daemon.

## Client half (DSH web GUI: 方案 A tabs)

Implemented in `client/`:

- `client/logic.js` — pure tab-experience logic, **node-tested in Part D**:
  tab ids/order, `designsDirFor` (cwd → designs dir), SSE frame parsing,
  `node:selected` validation, click-to-ask draft text.
- `client/design-view.js` — the browser half (dynamic-package source):
  the `🗂️ 设计大厅` tab + per-file `🎨 <file>.html ✕` dynamic tabs on the
  `conversation.view` ring, the gallery grid, the embedded canvas iframe
  (`/open?file=`), and the postMessage click-to-ask bridge into the composer
  draft. See `client/README.md` for the host RPC contract
  (`harness.handle`: designsDirForSession / listDesigns / openUrl / setDraft /
  subscribe) and verification status.

**Verification split**: everything below the React layer is verified offline
(32/32 wrapper smoke + Repo A 24/24 server self-test). The actual tab
rendering against the live GUI requires the DSH web environment — mount the
browser half and walk AC-01..AC-07 from the PRD manually.

## Sync from upstream (Repo A — single source)

The ENGINE (SKILL.md, reference/, server/, specs/) is owned by Repo A (the
Codex skill) and copied here VERBATIM — there is only one implementation.
Re-sync and re-test both sides with:

```sh
scripts/sync-from-upstream.sh [upstream-skill-dir]
```
