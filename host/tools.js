// host/tools.js — DSH tools bridge for the canvas-design-harness daemon.
//
// Turns the bundled HTTP-MCP server (Repo A, spec design_harness_external_mcp)
// into native model tools. The MODEL-FACING surface is stable: every tool
// takes a workspace `root` and a design file `name`, never a server fileId —
// file ids churn across rescans (spec design_harness_external_file_identity),
// so this wrapper resolves (root, name) -> fileId internally via
// workspace.listFiles before each MCP call.
//
// This module is deliberately PURE: it imports nothing from @deepseek-ai/*
// and takes defineTool as a dependency, so the bridge logic loads and tests
// in a bare context (test/smoke.mjs). The harness-facing entry that wires
// the real defineTool is host/tools-entry.js (the patch row target).

function text(value) {
  return [{ type: "text", text: String(value) }];
}
function renderJson(space = 2) {
  return (_args, value) => text(JSON.stringify(value, null, space));
}
// dsh-tools value schemas require explicit additionalProperties.
const OBJECT_SCHEMA = { type: "object", additionalProperties: true };
const ARRAY_SCHEMA = { type: "array", items: { type: "object", additionalProperties: true } };

// Resolve (root, name) -> { workspace, file }; throws when the design is unknown.
async function resolveFile(harness, root, name) {
  const workspace = await harness.ensureWorkspace(root);
  const file = (workspace.files ?? []).find((f) => f.name === name);
  if (!file) throw new Error(`canvas design "${name}" not found under ${workspace.root}`);
  return { workspace, file };
}

export function registerCanvasTools(ctx, deps = {}) {
  const harness = deps.harness ?? ctx.canvasHarness;
  const defineTool = deps.defineTool;
  if (!harness || typeof defineTool !== "function") return 0; // degrade silently

  const tools = [
    defineTool({
      name: "canvas_harness_ensure_workspace",
      description:
        "Start or attach the canvas-design-harness daemon for a design folder and register it as a workspace. Returns the workspace summary (root, file list).",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder (usually <project>/docs/designs)." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => harness.ensureWorkspace(args.root),
    }),
    defineTool({
      name: "canvas_harness_list_designs",
      description: "List the design HTML files registered for a design folder.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
      },
      output: { schema: ARRAY_SCHEMA, render: renderJson() },
      execute: async (args) => harness.listFiles(args.root),
    }),
    defineTool({
      name: "canvas_harness_create_design",
      description: "Create a new empty design document (one HTML file) in a design folder.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
        name: { type: "string", description: "File name, e.g. profile-cards.html." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => {
        const workspace = await harness.ensureWorkspace(args.root);
        return harness.mcpCall("document.createFile", { workspaceId: workspace.id, name: args.name });
      },
    }),
    defineTool({
      name: "canvas_harness_get_document",
      description: "Read the parsed node tree of one design document.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
        name: { type: "string", description: "Design file name." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => {
        const { file } = await resolveFile(harness, args.root, args.name);
        return harness.mcpCall("document.getDocument", { fileId: file.id });
      },
    }),
    defineTool({
      name: "canvas_harness_batch",
      description:
        "Run several Figma-object-model operations on one design document in a single parse/serialize/write cycle, atomic as a whole. Operations use canonical names (page.createFrame, frame.addComponent, node.setText, ...); selection (document.selectPage/selectFrame) applies to the rest of the batch.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
        name: { type: "string", description: "Design file name." },
        operations: { type: "array", items: { type: "object", additionalProperties: true }, description: "List of { tool, arguments } operations (canonical tool names)." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => {
        const { file } = await resolveFile(harness, args.root, args.name);
        return harness.mcpCall("batch", { fileId: file.id, operations: args.operations });
      },
    }),
    defineTool({
      name: "canvas_harness_validate",
      description: "Validate one design document's structure and report problems.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
        name: { type: "string", description: "Design file name." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => {
        const { file } = await resolveFile(harness, args.root, args.name);
        return harness.mcpCall("document.validate", { fileId: file.id });
      },
    }),
    defineTool({
      name: "canvas_harness_screenshot",
      description: "Render one design document (or a single node) to an SVG image without a browser.",
      parameters: {
        root: { type: "string", description: "Absolute path of the design folder." },
        name: { type: "string", description: "Design file name." },
        nodeId: { type: "string", description: "Optional node id to render; omitted renders the whole document." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => {
        const { file } = await resolveFile(harness, args.root, args.name);
        return harness.mcpCall("node.getScreenshot", { fileId: file.id, ...(args.nodeId ? { nodeId: args.nodeId } : {}) });
      },
    }),
    defineTool({
      name: "canvas_harness_mcp_call",
      description:
        "Raw escape hatch: call any canvas-design-harness MCP tool by canonical name with server-side parameters (fileId/pageId/frameId). Prefer the dedicated canvas_harness_* tools; use this for tools without a dedicated wrapper.",
      parameters: {
        method: { type: "string", description: "Canonical MCP tool name, e.g. page.createFrame." },
        params: { type: "object", additionalProperties: true, description: "Server-side tool parameters (may include fileId/pageId/frameId)." },
      },
      output: { schema: OBJECT_SCHEMA, render: renderJson() },
      execute: async (args) => harness.mcpCall(args.method, args.params ?? {}),
    }),
  ];

  for (const tool of tools) ctx.tools.register(tool);
  return tools.length;
}
