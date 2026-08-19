# Canvas Design Harness for DeepSeek Harness

English | [简体中文](./README.zh.md)

> 🎨 **Interactive Figma-style canvas design plugin & dual-spec Skill for DeepSeek Harness.**
> Create, inspect, and iterate on multi-frame UI designs directly inside DeepSeek Harness Web GUI, while remaining 100% standalone for Codex, Claude Code, and terminal workflows.

---

## 📸 Visual Overview

<details open>
  <summary><b>🖼️ 1. Design Gallery (Grid Overview)</b> — Browse all workspace design documents</summary>
  <br/>
  <a href="./docs/assets/gallery-grid.png">
    <img src="./docs/assets/gallery-grid.png" alt="Design Gallery Grid" width="100%" style="border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);" />
  </a>
</details>

<details>
  <summary><b>🎨 2. Multi-Frame Canvas (Grok Mobile App)</b> — Infinite canvas with responsive device frames</summary>
  <br/>
  <a href="./docs/assets/canvas-viewer-grok.png">
    <img src="./docs/assets/canvas-viewer-grok.png" alt="Multi-Frame Canvas View" width="100%" style="border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);" />
  </a>
</details>

<details>
  <summary><b>📊 3. Living Specs (AI Apps Comparison)</b> — Multi-page design specs version-controlled in Git</summary>
  <br/>
  <a href="./docs/assets/canvas-viewer-comparison.png">
    <img src="./docs/assets/canvas-viewer-comparison.png" alt="Living Specs Canvas View" width="100%" style="border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);" />
  </a>
</details>

---

## 🌟 Key Highlights

### 1. Integrated "Design Gallery" in DeepSeek Harness UI
- Seamlessly mounts into the `conversation.view` tab ring (alongside Chat and Trajectory).
- Instant visual gallery of all design documents located in `docs/designs/`.
- Embedded full-height interactive viewer with zoom, pan, and real-time hot-reloading.

### 2. HTML as Universal Living Specifications
- **Human-Friendly**: Clean, readable HTML files (`docs/designs/*.html`). Double-click to open in any standard web browser without heavy proprietary design software.
- **AI-Friendly**: Standard semantic DOM structure. LLMs can inspect, generate, and perform atomic mutations on frames and components with 100% precision.
- **Git-Native Specs**: Design files live right in your repository as code. Commit, branch, diff, and review living design specifications alongside your application code.

### 3. Figma-Like Interactive Canvas Experience
- Multi-page document architecture with infinite pan/zoom canvas.
- Built-in device frame presets (Mobile, Desktop, Modals, Flow diagrams).
- Zero-dependency built-in HTTP-MCP daemon (`127.0.0.1:9321`) handles live synchronization and SVG exports.

### 4. Dual-Spec Package
- **DeepSeek Harness Plugin**: Declares `dsh.bundle.patch` & `dsh.client` for complete host-and-client GUI integration.
- **Codex / Claude Code Skill**: Self-contained skill engine at `.agents/skills/canvas-design-harness/`, ready to run standalone.

---

## 🚀 Quick Start

### 1. Install as a DeepSeek Harness Plugin

```sh
# Add plugin to the web profile
dsh plugin --profile web add /path/to/dsh-canvas-design-harness

# Restart the web profile from a regular terminal
python3 scripts/restart-web.py
```

Refresh your browser (`http://127.0.0.1:3080`), and you will see the **Design Gallery** (`设计大厅`) tab in the top navigation ring.

### 2. Conversational Design Generation

1. **Describe your UI in chat**:
   > *"Design a user login and registration interface for me with mobile screens"*
2. **Automatic Generation**: The Agent invokes `canvas_harness_*` tools to generate and render design files under `docs/designs/`.
3. **Inspect in Design Gallery**: Open the **Design Gallery** tab to view your interactive canvas.

---

## 🏗️ Repository Layout

```
dsh-canvas-design-harness/
├── .agents/skills/canvas-design-harness/   # Canonical skill engine (synced from upstream)
│   ├── SKILL.md       # Skill definition & guidelines
│   ├── reference/     # Canonical styles & scripts (canvas-frames.css / canvas-frames.js)
│   ├── server/        # Zero-dependency HTTP-MCP daemon (port 9321)
│   └── specs/         # Protocol specifications
├── client/            # DSH Web GUI client module
│   ├── design-view.js # React frontend source (DSH locale & Design System)
│   ├── bundle.js      # Built classic-script bundle (__ModuleLoader__)
│   └── logic.js       # Pure logic & testing helpers
├── host/              # Host tools bridge
│   ├── tools.js       # Model tool bridge definitions (canvas_harness_*)
│   └── tools-entry.js # Cordis tool registration entry
├── scripts/           # Build, verification & maintenance scripts
│   ├── build-client.mjs  # Bundle packaging script
│   ├── restart-web.py    # Sandbox-safe profile restarter
│   ├── verify-web.mjs    # Live GUI acceptance test script
│   └── sync-from-upstream.sh # Upstream skill synchronization
├── docs/assets/       # Visual preview screenshots
├── plugin.js          # DSH plugin entry (skills, daemon lifecycle, /canvas/* routes)
├── package.json       # Manifest declaring dsh.bundle.patch & dsh.client
├── cordis.patch.yml   # Cordis profile patch configuration
└── test/smoke.mjs     # 42-check offline integration test suite (Parts A–F)
```

---

## 🛠️ Model Tools Bridge

The plugin exposes the following structured tools to the AI model (addressed by `root` + `name`):

| Tool | Purpose | MCP Method |
|---|---|---|
| `canvas_harness_ensure_workspace` | Probe/spawn daemon & register workspace | `POST /workspaces` |
| `canvas_harness_list_designs` | List all `.html` designs in workspace | `workspace.listFiles` |
| `canvas_harness_create_design` | Create a new design HTML document | `document.createFile` |
| `canvas_harness_get_document` | Read and parse the document node tree | `document.getDocument` |
| `canvas_harness_batch` | Atomically apply batch operations on frames/components | `batch` |
| `canvas_harness_validate` | Validate document structure and frames | `document.validate` |
| `canvas_harness_screenshot` | Render frames to SVG without a browser | `node.getScreenshot` |
| `canvas_harness_mcp_call` | Raw MCP JSON-RPC escape hatch | `tools/call` |

---

## 💻 Development & Acceptance

Run the three-step acceptance suite after making any changes:

```sh
# 1. Rebuild the client bundle
npm run build:client

# 2. Run the 42-check offline test suite (Skills, Discovery, Daemon, E2E Routes, Boot Race)
node test/smoke.mjs

# 3. Verify against the live running Web GUI
node scripts/verify-web.mjs
```

### Standalone Skill (Codex / Claude Code)

The skill can also run independently without DeepSeek Harness:

```sh
cd .agents/skills/canvas-design-harness/server
node src/index.js <your-designs-folder>      # Defaults to http://127.0.0.1:9321
```

---

## 📄 License

[MIT License](LICENSE)
