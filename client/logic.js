// client/logic.js — PURE browser-half logic for the DSH canvas wrapper.
//
// No imports, no DOM, no React: every function here is plain data in/out so
// the tab-experience logic is unit-testable in node (test/smoke.mjs Part D)
// while the browser half (design-view.js) consumes it. All helpers follow
// Repo A's external-capability specs (specs/external_capabilities.yaml).

export const GALLERY_TAB_ID = "design:gallery";
export const GALLERY_TAB_ORDER = 20;
export const FILE_TAB_ORDER_BASE = 21;

/**
 * Map a session cwd to the design folder served to the daemon.
 * - explicit override wins;
 * - a cwd that already ends in /designs or /docs/designs is used as-is;
 * - otherwise the skill convention <project>/docs/designs is appended.
 */
export function designsDirFor(cwd, override) {
  if (override) return String(override).replace(/\/+$/, "");
  const clean = String(cwd ?? "").replace(/\/+$/, "");
  if (/\/designs$/.test(clean) || /\/docs\/designs$/.test(clean)) return clean;
  return `${clean}/docs/designs`;
}

/** Stable conversation.view tab id for one design file. */
export function fileTabId(fileId) {
  return `design:file:${fileId}`;
}

/** Tab order for dynamically opened file tabs (after the gallery). */
export function fileTabOrder(index) {
  return FILE_TAB_ORDER_BASE + index;
}

/** Parse one SSE `data:` frame (spec design_harness_external_events). */
export function parseSseFrame(data) {
  try {
    const parsed = JSON.parse(data);
    return {
      ok: true,
      workspaceId: parsed.workspaceId ?? null,
      fileId: parsed.fileId ?? null,
      action: parsed.action ?? "update",
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return { ok: false };
  }
}

/** Validate an inbound window message from the canvas viewer iframe. */
export function nodeSelectedMessageOk(message) {
  return (
    !!message &&
    message.source === "canvas-design-harness" &&
    message.type === "node:selected" &&
    !!message.payload &&
    typeof message.payload === "object" &&
    (typeof message.payload.nodeId === "string" || message.payload.nodeId === null)
  );
}

/** Build the input-box draft for a node:selected payload (click-to-ask). */
export function draftForNodeSelected(payload) {
  const label = payload.nodeLabel ? `「${payload.nodeLabel}」` : "";
  const id = payload.nodeId ? ` (ID: ${payload.nodeId})` : "";
  const kind = payload.nodeType && payload.nodeType !== "frame" ? `(${payload.nodeType})` : "";
  return `请修改设计稿中的${kind}节点${label}${id}：`;
}

/** Human label for a design file tab. */
export function designTabLabel(name) {
  const base = String(name ?? "design").replace(/\.html$/i, "");
  return base;
}
