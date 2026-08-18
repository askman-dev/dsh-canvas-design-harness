# dsh-canvas-design-harness

One skill tree, two plugin specs:

- **Codex / Claude Code spec** — the skill lives at `.agents/skills/canvas-design-harness/`
  (SKILL.md + `reference/` + `server/` + `specs/`). Any agent that scans
  `.agents/skills` picks it up with zero setup.
- **DeepSeek Harness plugin spec** — the same repo is a DSH plugin *bundle*:
  `package.json` declares `dsh.bundle.patch`, `cordis.patch.yml` inserts one
  host-side row, and `plugin.js` registers every `.agents/skills/*` entry into
  `ctx.skills` (runtime, rank 250). Editing a SKILL.md hot-reloads it.

## Layout

```
dsh-canvas-design-harness/
├── .agents/skills/canvas-design-harness/   # verbatim skill (Codex spec)
│   ├── SKILL.md
│   ├── reference/     # canvas-frames.css / canvas-frames.js
│   ├── server/        # zero-dependency HTTP-MCP service (canvas-design-harness-server)
│   └── specs/         # design_harness.yaml contracts
├── package.json       # DSH bundle manifest (dsh.bundle.patch)
├── cordis.patch.yml   # DSH bundle patch layer (inserts the plugin row)
├── plugin.js          # DSH wrapper: registers .agents/skills/* via ctx.skills
└── test/smoke.mjs     # offline DSH-side smoke test
```

## Install as a DSH plugin

```sh
dsh plugin --profile web add /path/to/dsh-canvas-design-harness
```

Then restart the profile. The skill appears in the catalog under the `skill`
tool as `canvas-design-harness` (and can be invoked with `/canvas-design-harness`).

## Use from Codex / Claude Code

Clone the repo and point your agent at it, or copy `.agents/skills/canvas-design-harness`
into your project's `.agents/skills/`. The skill itself has no dependency on DSH.

## Test

```sh
node test/smoke.mjs                 # DSH side: registry + filesystem discovery
cd .agents/skills/canvas-design-harness/server && npm run smoke   # server 17/17
```

## Publish

The package is npm-publishable as `dsh-canvas-design-harness`; the `files`
field ships `plugin.js`, `cordis.patch.yml`, `.agents/skills` and the README,
so an installed bundle carries the whole skill tree.

## Sync from upstream

The skill content is a verbatim copy of the upstream Codex skill. Re-sync with:

```sh
rm -rf .agents/skills/canvas-design-harness
cp -R <upstream-skill-dir> .agents/skills/canvas-design-harness
node test/smoke.mjs
```
