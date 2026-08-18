// host/tools-entry.js — harness-facing entry for the canvas tools bridge.
//
// This is the patch-row target (cordis.patch.yml -> id
// dsh-canvas-design-harness-tools). It wires the real @deepseek-ai/dsh-tools
// defineTool into the pure bridge logic in ./tools.js. The bare import
// resolves in the harness through the profile module tree / fallback dir;
// offline tests import ./tools.js directly and pass defineTool explicitly.
import { defineTool } from "@deepseek-ai/dsh-tools";
import { registerCanvasTools } from "./tools.js";

export const name = "dsh-canvas-design-harness-tools";
export const inject = ["tools"];

export function apply(ctx) {
  registerCanvasTools(ctx, { defineTool });
}

export default { name, inject, apply };
