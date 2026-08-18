---
name: canvas-design-harness
description: Use when reproducing card-conversation screens as Figma-style frames inside conversation visualizations, or when building reusable screen-reproduction demos that share frame styles and scripts. One HTML can contain multiple Figma-like pages, each with its own infinite canvas of frames. Canonical style and script live in reference/; an optional HTTP-MCP service treats each design draft HTML as the document, reading and mutating it directly with validation and atomic writes.
---

# Canvas Design Harness

Figma-like screen reproduction kit. One HTML contains multiple "pages"; each
page owns an infinite canvas holding several "frames", one per screen state,
with a Figma-style label system (page tabs, frame name + dimensions). The
canvas also hosts FigJam-style "flow frames" (sticky notes and connectors)
for state flows and annotations, so a demo combines Figma frames and FigJam
boards on the same canvas. Designs can be reviewed directly in the
conversation instead of opening a design tool.

## Files

- `reference/canvas-frames.css` - product tokens and all screen components:
  phone frame, iOS status bar, app bar, header card, panels, fields, primary
  button, timeline blocks, process tile, choice buttons, launch sheet, and the
  Figma-style labels, page tabs, the infinite-canvas stage (viewport, dot
  grid, zoom bar), and FigJam-style flow frames (sticky notes + connectors).
- `reference/canvas-frames.js` - Figma-like multi-page canvas: page tabs,
  per-page pan and pinch/scroll zoom, frame selection/focus, and generic
  launch-sheet internal-state switching.
- `server/` - zero-dependency Node service: singleton port reuse, workspace
  registry, home page and viewer, SSE updates, and an HTTP-MCP (JSON-RPC)
  interface that reads and mutates design-draft HTML files directly through a
  strict parser/serializer (no external dependency).
- `specs/design_harness.yaml` - the skill's spec contracts (singleton
  service, HTTP-MCP, HTML document, open-source naming).
- `specs/external_capabilities.yaml` - the external client contract
  (process, HTTP, SSE, postMessage, MCP) that host wrappers implement
  against, e.g. the DSH plugin dsh-canvas-design-harness. The server's
  HTTP/SSE surface and the canvas's postMessage bridge follow it.

Design drafts are not part of the framework: they live in `docs/designs/`
(tracked in git), one HTML file per design. The skill itself contains only
framework definitions and scripts.

## How to use

1. Embed the CSS inside a `<style>` block and the JS inside a `<script>` block
   in each visualization fragment. The conversation renderer requires the
   fragment to be self-contained (CSP only allows inline styles/scripts); these
   reference files are the canonical source every demo copies from.
2. Fragment root id must be `canvas-frames-demo`.
3. Frame markup pattern:

```html
<div class="cf-toolbar">
  <span class="cf-toolbar-title">标题</span>
  <div class="cf-pagetabs">
    <button class="cf-pagetab">现状还原</button>
    <button class="cf-pagetab">新方案</button>
  </div>
</div>
<div class="cf-page is-active" data-page="1">
  <div class="cf-stage">
    <div class="cf-canvas-viewport">
      <div class="cf-canvas-inner">
        <div class="cf-canvas">
          <div class="cf-fig">
            <div class="cf-fig-label">
              <span class="cf-fr-badge"></span><b>Frame 1</b>
              <span>名称</span><span class="cf-dims">393 × 852</span>
              <span class="cf-tag">状态</span>
            </div>
            <div class="cf-frame-wrap"><div class="cf-frame"> ... </div></div>
          </div>
          ...
        </div>
      </div>
    </div>
    <div class="cf-zoombar">
      <button type="button" data-zoom="out">−</button>
      <span class="cf-zoom-value">100%</span>
      <button type="button" data-zoom="in">+</button>
      <button type="button" data-zoom="fit">适应</button>
    </div>
  </div>
</div>
<div class="cf-page" data-page="2"> ... </div>
```

4. Icons are small inline SVGs with class `cf-ico`, using `currentColor`.

## Infinite canvas

Each page has its own Figma-like infinite canvas:

- Pan: drag with one pointer (mouse or finger), trackpad scroll, or arrow-key
  alternatives are not needed; wheel scrolls the canvas.
- Zoom: two-finger pinch on touch, Ctrl/Cmd + wheel on desktop, or the zoom
  bar buttons. Click the percentage to return to 100%.
- `适应` fits all frames into the stage; clicking a frame centers it.
- Page tabs switch whole pages; each page remembers its own pan/zoom state.
- Page tabs write a `#page-N` hash (`history.replaceState`, no extra history
  entries); a browser refresh restores that page, and manually editing the
  hash switches pages.
- The canvas is a stable, full-area viewport: it fills the browser viewport
  height (`calc(100dvh - 130px)`, min 480px) and never shrinks with zoom, so
  the pointer hit area stays large. Content scales inside it; `适应` fits all
  frames centered in the viewport.
- Zoom sensitivity is tuned in `reference/canvas-frames.js`: pinch zoom maps
  the finger-distance ratio through a fourth root (quarter speed; a 2x finger
  spread becomes ~1.19x zoom), and the Ctrl/Cmd + wheel step is 1.037 per
  notch. Adjust those two values when the feel changes.

The zoom bar is the only always-visible control. Do not add search, reset, or
other controls unless asked.

## HTTP-MCP service

For structured edits, use the Node service instead of hand-editing HTML:

```sh
cd server && npm start -- <folder> [--port 9321]
```

The CLI probes the port first: if a harness instance is already running it
registers the folder as another workspace and exits (singleton reuse). The
home page (`GET /`) groups workspaces and lists their HTML files; `GET
/open?file=<id>` opens the rendered viewer, which reloads on SSE updates.

All reads and writes go through `POST /mcp` (JSON-RPC 2.0):

- `tools/list`, `tools/call`. Tool names mirror the Figma object model so the
  agent can reuse its Figma knowledge: `document.createFile`,
  `document.createPage`, `page.createFrame`, `frame.addComponent`,
  `node.setText`, `node.setProps`, `node.setState`, `node.remove`,
  `node.connect`, `node.getNode`, `node.getScreenshot`,
  `document.getDocument`, `document.validate`, `document.selectPage`,
  `document.selectFrame`, `workspace.list`, `workspace.listFiles`, and
  `batch {fileId, operations:[...]}`. Old snake_case names remain as aliases.
- `resources/list`, `resources/read` return the parsed node tree.

MCP calls are stateless, exactly like Figma's `use_figma` (its `currentPage`
resets between calls). `document.selectPage` / `document.selectFrame` are
batch-only operations: inside a `batch` the selection mirrors
`figma.currentPage` (a script starts on the first page and may switch
mid-script), and later operations in that batch can omit `pageId` /
`frameId`. Across separate calls, ids must be explicit. `batch` runs its
operations on one parse/serialize/write cycle and is atomic as a whole,
mirroring a multi-statement Figma script without executing JS.

`document.createFile` creates an empty document with no default page; pages
are created explicitly. A user journey lives on ONE page: create the page
once, then call `page.createFrame` repeatedly — each frame is one step of the
flow on the same canvas (Figma style). Inside a batch the newest frame becomes
the current frame, so `frame.addComponent` populates it without repeating
`frameId`; the component vocabulary includes `panel` (titled source block)
and `process` (collapsed step bar) for conversation pages.

## Fidelity rule

Component renderers must reproduce the reference markup exactly (inline SVG
icons, correct `cf-*` classes, `.cf-ls-state` wrappers) so generated designs
match the real product effect instead of an approximation. Button variants:
`primary` (full-width submit), `toggle` (pill, optional `active`), `choice`
(centered outlined choice). When a real screen needs a block the vocabulary
does not cover (e.g. a memory-anchor card), add a component type with real
copy and structure rather than approximating with plain text.

The HTML file is the document: pages contain frames, frames contain typed
components, and every page/frame/section/component has a stable `data-cf-id`
and explicit `data-cf-type`; props are `data-*` attributes on the node root.
Every write is read -> parse (validate) -> mutate -> serialize -> atomic
replace, so a failed command never changes the file and the document stays
readable with minimal diffs. Inspect first (`get_document`), mutate in small
steps, then re-read to verify.

## Open-source naming rule

This skill is meant to be open-sourced: no file name or new identifier may
use the product brand keyword. Shared assets are `canvas-frames.css` /
`canvas-frames.js`, the demo root id is `canvas-frames-demo`, and the server
package name is `canvas-design-harness-server`.

## FigJam-style flow frames

Flow annotations live on the canvas as a frame type, not as a strip above the
stage. Put them inside `.cf-canvas` next to phone frames with their own
`.cf-fig-label`, and connect sticky nodes with `.cf-jam-arrow` connectors:

```html
<div class="cf-fig">
  <div class="cf-fig-label"><span class="cf-fr-badge"></span><b>Frame 5</b>
    <span>启动系统状态流</span><span class="cf-tag">FigJam</span></div>
  <div class="cf-jam">
    <div class="cf-jam-title">启动系统统一状态</div>
    <div class="cf-jam-steps">
      <div class="cf-jam-sticky"><b>source_list</b><span>选择来源</span></div>
      <span class="cf-jam-arrow">→(inline SVG arrow)</span>
      <div class="cf-jam-sticky"><b>source_input</b><span>填写内容</span></div>
      ...
    </div>
    <div class="cf-jam-cards">
      <div class="cf-jam-card"><b>数学题</b>来源：…<br>提交：开始分析</div>
      ...
    </div>
  </div>
</div>
```

Sticky nodes use FigJam-like warm backgrounds; card notes use cool blue. The
whole flow frame pans and zooms with the canvas like any other frame.

## Launch-sheet internal states

To show that source selection and content filling live inside the same launch
panel (no navigation), wrap a `.cf-ls` sheet with `[data-ls-state]` panels and
`[data-ls-go]` controls. `.cf-sheet.cf-ls` is a compact, content-sized bottom
sheet (the new-design launch panel); the plain `.cf-sheet` stays full-height
for current-state reproductions:

```html
<div class="cf-ls" style="--cf-accent:#5B72CF;--cf-primary:#5B72CF">
  <div class="cf-ls-state is-active" data-ls-state="list"> ...rows with data-ls-go="input"... </div>
  <div class="cf-ls-state" data-ls-state="input">
    <button class="cf-ls-back" data-ls-go="list">← 选择内容来源</button>
    <div class="cf-ls-title2">输入要记住的单词</div>
    <textarea class="cf-ls-field" data-ls-draft placeholder="每行一个英文单词"></textarea>
    <button class="cf-ls-submit" data-ls-submit data-ls-go="launching">开始记忆</button>
  </div>
  <div class="cf-ls-state" data-ls-state="launching" data-ls-timeout="1000" data-ls-after="closed">
    <div class="cf-ls-launching"><span class="cf-spinner"></span>正在进入任务页…</div>
  </div>
  <div class="cf-ls-state" data-ls-state="closed">
    <div class="cf-ls-closed">已关闭启动面板，回到「我的」</div>
  </div>
</div>
```

Rules implemented generically:

- `[data-ls-go]` switches to the named state (back button, source rows, close).
- The textarea keeps its value across state switches (draft preserved).
- `[data-ls-submit]` disables when the draft is empty, and goes to the state
  named by its own `data-ls-go` when enabled.
- `data-ls-timeout` + `data-ls-after` auto-advance a transient state (e.g.
  launching -> closed).
- `[data-ls-toggle]` collapses/expands a section inside the same state (e.g.
  the card intro); the button's selector targets a `.cf-ls-intro` in the same
  `[data-ls-state]` and gets `.is-active` when the section is open.
- `[data-ls-expand]` swaps a source row for an inline input panel in place
  (`.cf-ls-expand` host with `.cf-ls-expand-row` and
  `.cf-ls-expand-panel`): one click enters the input state, the source list
  stays visible, and the panel's back control collapses back with the draft
  preserved.
- Entry-mode variants are plain frame copies: e.g. the "灵感" frame starts
  with the intro open and the "我的" frame starts with
  `.cf-ls-intro.is-collapsed`; everything else is identical.
- In the new-design launch panel (`.cf-sheet.cf-ls`) the category tag is
  hidden and the card title uses the same 18px size as "从哪里开始".

## Pitfalls

- **Encoding**: the bare fragment has no `<!doctype html>` or
  `<meta charset="utf-8">`, so opening it directly in a browser can render
  Chinese as mojibake (browsers may fall back to windows-1252). Fragments are
  only safe inside the in-conversation renderer, which injects its own UTF-8
  document. Anything meant to be opened directly (e.g. files in `drafts/`)
  must be wrapped in a complete HTML document with
  `<meta charset="utf-8">` as the first meta tag.
- **Keep demo sources in the repo**: product and design sources live in the
  tracked `docs/designs/` directory. The skill's `drafts/` directory is only
  for framework demos or fragments. Do not write visualization sources to
  `~/.codex/visualizations/` or other shared Codex cache directories; they are
  off-limits. The in-conversation content reference can point directly at the
  tracked design source.
- **Canvas geometry**: when computing content-space positions from
  `getBoundingClientRect()`, always subtract the viewport rect's `left`/`top`
  before converting through the current transform; otherwise frames land
  offset when the stage is not at the window origin.
- Keep the embedded CSS/JS copy semantically identical to `reference/`; the
  conversation renderer cannot load sibling files (CSP allows inline only).

## Fidelity workflow

- Screens are reproduced from the product tokens plus OCR and pixel sampling
  of the reference screenshots; iterate per frame by editing the fragment.
- Colors are fixed light-theme to match the product design screenshots.
- Keep layout text and positions faithful to the screenshot; flag any
  screenshot artifact (annotation markers, color drift from compression)
  separately instead of baking it into the product design.
