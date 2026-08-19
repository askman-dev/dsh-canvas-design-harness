/**
 * test/smoke.mjs — offline smoke test for the dual-spec repo.
 *
 * Part A: mounts the real @deepseek-ai/dsh-skill SkillRegistry + this repo's
 *         plugin.js and asserts the skills under .agents/skills/ are visible.
 * Part B: mounts the real @deepseek-ai/dsh-skill-filesystem provider with
 *         cwd = this repo and asserts native discovery from .agents/skills/
 *         (the Codex layout, rank 200 project-agents).
 * Part C: mounts the real @deepseek-ai/dsh-tools ToolRuntime + the wrapper's
 *         daemon service (createCanvasHarness) + tools bridge
 *         (registerCanvasTools) against a REAL spawned daemon on a test port
 *         with a temp designs folder: create / batch / read / validate / SSE.
 * Part D: client half pure logic (方案 A tabs) — tab ids, designsDirFor, SSE
 *         frame parsing, node:selected validation, draft text.
 * Part E: browser-half host routes (/canvas/*) — designs listing by session
 *         workspace and by explicit root, viewer 302, SSE proxy, 404 —
 *         against a REAL daemon through a real http server.
 * Part F: the webServer boot race — plugin.js applies before the webServer
 *         service exists (real harness boot order); the /canvas routes must
 *         register once webServer is provided (cordis inject-wait).
 *
 * Usage: node test/smoke.mjs
 */
import { Context } from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/cordis/lib/index.js";
import SkillRegistry from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-skill/lib/index.js";
import { apply as fsApply, inject as fsInject, name as fsName } from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "canvas-design-harness";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// ---- Part A: runtime registration via plugin.js ----
const ctxA = new Context();
await ctxA.plugin(SkillRegistry);
const plugin = (await import(`file://${REPO_ROOT}/plugin.js`)).default;
await ctxA.plugin(plugin);

const listA = await ctxA.skills.list();
const namesA = listA.map((s) => s.name);
check("A: plugin registers skills", namesA.includes(EXPECTED), `got: ${namesA.join(", ") || "(none)"}`);
const foundA = listA.find((s) => s.name === EXPECTED);
if (foundA) {
  check("A: provider is runtime", foundA.provider === "runtime", foundA.provider);
  check("A: source is runtime", foundA.source === "runtime", foundA.source);
  check("A: model+user invocable", foundA.invocation.modelInvocable && foundA.invocation.userInvocable);
  check(
    "A: resourceBase points into .agents/skills",
    foundA.resourceBase?.kind === "directory" && foundA.resourceBase.path.endsWith(`.agents${"/"}skills${"/"}${EXPECTED}`),
    JSON.stringify(foundA.resourceBase),
  );
}
const fullA = await ctxA.skills.get(EXPECTED);
check("A: get() loads body", !!fullA, fullA ? `head: ${JSON.stringify(fullA.content.slice(0, 40))}` : "undefined");
if (fullA) check("A: frontmatter stripped", !fullA.content.startsWith("---"));

// ---- Part B: filesystem provider native discovery (Codex spec side) ----
const ctxB = new Context();
await ctxB.plugin(SkillRegistry);
const fsProvider = (ctx2, config) => fsApply(ctx2, config);
fsProvider.inject = fsInject;
await ctxB.plugin(fsProvider, { watch: false });
const snapshotB = await ctxB.skills.snapshot({ cwd: REPO_ROOT });
const foundB = snapshotB.skills.find((s) => s.name === EXPECTED);
check("B: filesystem provider discovers .agents/skills", !!foundB, foundB ? `${foundB.source} / ${foundB.provider}` : "(missing)");
if (foundB) {
  check("B: source is project-agents", foundB.source === "project-agents", foundB.source);
  check("B: complete observation", snapshotB.complete === true, String(snapshotB.complete));
}
const fullB = foundB ? await ctxB.skills.get(EXPECTED, { cwd: REPO_ROOT }) : undefined;
check("B: get() via filesystem loads body", !!fullB);

await ctxA.dispose?.();
await ctxB.dispose?.();

// ---- Part C: wrapper daemon service + tools bridge against a real daemon ----
const pluginModule = await import(`file://${REPO_ROOT}/plugin.js`);
const { createCanvasHarness } = pluginModule;
const { registerCanvasTools } = await import(`file://${REPO_ROOT}/host/tools.js`);
const { defineTool } = await import(`file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-tools/lib/index.js`);

const designsDir = mkdtempSync(join(tmpdir(), "ch-smoke-designs-"));
writeFileSync(join(designsDir, "seed.html"), "<!doctype html><meta charset=\"utf-8\"><title>seed</title>", "utf8");
const port = 9400 + Math.floor(Math.random() * 200);

const harness = createCanvasHarness({
  skillDir: join(REPO_ROOT, ".agents", "skills", EXPECTED),
  port,
});

// C1: daemon spawn + workspace registration + file listing
const workspace = await harness.ensureWorkspace(designsDir);
check("C: ensureWorkspace spawns daemon and registers workspace", !!workspace.id, `id=${workspace.id} port=${port}`);
const files = await harness.listFiles(designsDir);
check("C: listFiles finds seed.html", files.some((f) => f.name === "seed.html"), files.map((f) => f.name).join(", "));

// C2: tools bridge mounted on a tools registry (real defineTool compilation).
// The full ToolRuntime needs ctx.systemPrompt (harness-only); here a minimal
// registry stub records the compiled definitions — the schema-compilation
// path exercised is the real @deepseek-ai/dsh-tools one.
const ctxC = new Context();
const registeredDefs = [];
ctxC.provide("tools", {
  register: (def) => {
    registeredDefs.push(def);
  },
  schemas: () => registeredDefs.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })),
});
ctxC.provide("canvasHarness", harness);
const registered = registerCanvasTools(ctxC, { harness, defineTool });
check("C: tools bridge registers tools", registered >= 7, `${registered} tools`);
const schemaNames = ctxC.tools.schemas().map((s) => s.name);
check(
  "C: curated tool schemas visible on ctx.tools",
  ["canvas_harness_create_design", "canvas_harness_batch", "canvas_harness_get_document", "canvas_harness_mcp_call"].every((n) => schemaNames.includes(n)),
  schemaNames.join(", "),
);
await ctxC.dispose?.();

// C3: end-to-end through the harness MCP bridge (the tool execute path)
const created = await harness.mcpCall("document.createFile", { workspaceId: workspace.id, name: "flow.html" });
check("C: createFile via MCP bridge", !!created?.fileId, JSON.stringify(created));
const batch = await harness.mcpCall("batch", {
  fileId: created.fileId,
  operations: [
    { tool: "document.createPage", arguments: { name: "登录" } },
    { tool: "page.createFrame", arguments: { name: "Frame 1", size: { w: 393, h: 852 } } },
    { tool: "frame.addComponent", arguments: { type: "button", props: { label: "立即登录" } } },
  ],
});
check("C: batch applies page+frame+component", !!batch, JSON.stringify(batch).slice(0, 120));

// C4: SSE — subscribe to the created file, then run a VALID write, expect an event
let sawEvent = false;
const unsub = harness.events(created.fileId, (ev) => {
  if (ev.event === "updated") sawEvent = true;
});
await new Promise((r) => setTimeout(r, 500));
await harness.mcpCall("batch", {
  fileId: created.fileId,
  operations: [{ tool: "node.setProps", arguments: { nodeId: batch.results[2].componentId ?? batch.results[2].nodeId, props: { label: "登录" } } }],
});
await new Promise((r) => setTimeout(r, 500));
unsub();
check("C: SSE updated event received after a write", sawEvent);

const doc = await harness.mcpCall("document.getDocument", { fileId: created.fileId });
check(
  "C: getDocument returns parsed tree",
  !!doc?.document?.pages?.length,
  JSON.stringify(doc).slice(0, 100),
);
const valid = await harness.mcpCall("document.validate", { fileId: created.fileId });
check("C: validate reports a document", !!valid && Array.isArray(valid.problems ?? valid.errors ?? []), JSON.stringify(valid).slice(0, 80));

// C5: protocol conformance of the NEW Repo A capabilities through the wrapper
const filesAfter = await harness.listFiles(designsDir);
const flowMeta = filesAfter.find((f) => f.name === "flow.html");
check("C: metadata present on created design", !!flowMeta && flowMeta.pageCount >= 1 && flowMeta.frameCount >= 1 && typeof flowMeta.updatedAt === "number", JSON.stringify(flowMeta));
const rescan = await harness.listFiles(designsDir);
const sameId = rescan.find((f) => f.name === "flow.html")?.id === flowMeta?.id;
check("C: file id stable across re-scans", !!sameId, flowMeta?.id);

let sseJson = null;
const unsub2 = harness.events(created.fileId, (ev) => {
  if (ev.event === "updated") sseJson = ev.data;
});
await new Promise((r) => setTimeout(r, 300));
await harness.mcpCall("batch", {
  fileId: created.fileId,
  operations: [{ tool: "node.setProps", arguments: { nodeId: batch.results[2].componentId ?? batch.results[2].nodeId, props: { label: "开始" } } }],
});
await new Promise((r) => setTimeout(r, 400));
unsub2();
let parsedEvent = null;
try {
  parsedEvent = JSON.parse(sseJson ?? "null");
} catch {
  /* keep null */
}
check("C: SSE frame is JSON {workspaceId, fileId, action, updatedAt}", !!parsedEvent && parsedEvent.action === "update" && parsedEvent.fileId === created.fileId, String(sseJson));

harness.dispose();
rmSync(designsDir, { recursive: true, force: true });

// ---- Part D: client half pure logic (方案 A tabs) ----
const logic = await import(`file://${REPO_ROOT}/client/logic.js`);
check("D: designsDirFor appends docs/designs", logic.designsDirFor("/repo/proj") === "/repo/proj/docs/designs");
check("D: designsDirFor passes through designs dirs", logic.designsDirFor("/repo/proj/docs/designs") === "/repo/proj/docs/designs");
check("D: designsDirFor honors override", logic.designsDirFor("/x", "/y/designs") === "/y/designs");
check("D: fileTabId stable", logic.fileTabId("file_abc") === "design:file:file_abc");
check("D: tab order after gallery", logic.fileTabOrder(0) > logic.GALLERY_TAB_ORDER);
const frame = logic.parseSseFrame(JSON.stringify({ workspaceId: "ws1", fileId: "f1", action: "update", updatedAt: 123 }));
check("D: parseSseFrame extracts fields", frame.ok && frame.fileId === "f1" && frame.action === "update" && frame.updatedAt === 123);
check("D: parseSseFrame rejects garbage", logic.parseSseFrame("not-json").ok === false);
check("D: nodeSelectedMessageOk validates envelope", logic.nodeSelectedMessageOk({ source: "canvas-design-harness", type: "node:selected", payload: { nodeId: "n1" } }));
check("D: nodeSelectedMessageOk rejects impostors", !logic.nodeSelectedMessageOk({ source: "evil", type: "node:selected", payload: { nodeId: "n1" } }));
check("D: draftForNodeSelected builds click-to-ask text", logic.draftForNodeSelected({ nodeId: "n1", nodeLabel: "登录", nodeType: "button" }) === "请修改设计稿中的(button)节点「登录」 (ID: n1)：");
check("D: designTabLabel strips .html", logic.designTabLabel("login-flow.html") === "login-flow");

// ---- Part E: browser-half host routes (/canvas/*) against a real daemon ----
const { registerCanvasRoutes } = pluginModule;
const routesDir = mkdtempSync(join(tmpdir(), "ch-smoke-routes-"));
mkdirSync(join(routesDir, "docs", "designs"), { recursive: true });
writeFileSync(join(routesDir, "docs", "designs", "seed.html"), '<!doctype html><meta charset="utf-8"><title>seed</title>', "utf8");
const routesPort = 9600 + Math.floor(Math.random() * 200);
const routesHarness = createCanvasHarness({ skillDir: join(REPO_ROOT, ".agents", "skills", EXPECTED), port: routesPort });

let routesRoute = null;
const fakeWebServer = {
  register: (route) => {
    routesRoute = route;
    return () => {
      routesRoute = null;
    };
  },
};
const fakeWorkspaceRegistry = { list: () => [{ id: "ws-e", path: routesDir, title: "e", sessionIds: ["session-e1"] }] };
const ctxE = {
  logger: console,
  get: (n) => (n === "webServer" ? fakeWebServer : n === "workspaceRegistry" ? fakeWorkspaceRegistry : undefined),
};
const disposeRoutes = registerCanvasRoutes(ctxE, routesHarness);
check("E: /canvas route registered", !!routesRoute);

const serverE = http.createServer((req, res) => routesRoute.handler(req, res));
await new Promise((r) => serverE.listen(0, "127.0.0.1", r));
const baseE = `http://127.0.0.1:${serverE.address().port}`;

const r1 = await fetch(`${baseE}/canvas/designs?sessionId=session-e1`).then((r) => r.json());
check("E: designs by sessionId resolves workspace→designsDir", r1.ok && r1.files?.some((f) => f.name === "seed.html"), JSON.stringify(r1.files?.map((f) => f.name)));

const r2 = await fetch(`${baseE}/canvas/designs?root=${encodeURIComponent(join(routesDir, "docs", "designs"))}`).then((r) => r.json());
check("E: designs by explicit root", r2.ok && r2.files?.length === 1 && !!r2.base, r2.base);

const r3 = await fetch(`${baseE}/canvas/open?file=${encodeURIComponent(r2.files[0].id)}`, { redirect: "manual" });
check("E: open redirects to the daemon viewer", r3.status === 302 && String(r3.headers.get("location")).includes("/open?file="), String(r3.headers.get("location")));

// E4: SSE proxy — subscribe to a created file, then mutate to trigger updated
const createdE = await routesHarness.mcpCall("document.createFile", { workspaceId: r2.files[0].workspaceId, name: "flow.html" });
let sseE = "";
const acE = new AbortController();
const evtE = await fetch(`${baseE}/canvas/events?file=${encodeURIComponent(createdE.fileId)}`, { signal: acE.signal });
const readerE = evtE.body.getReader();
const decoderE = new TextDecoder();
let openedE = false;
let updatedE = false;
let triggeredE = false;
const deadlineE = Date.now() + 8000;
while (Date.now() < deadlineE) {
  let chunk;
  try {
    chunk = await readerE.read();
  } catch {
    break;
  }
  if (chunk.done) break;
  sseE += decoderE.decode(chunk.value, { stream: true });
  if (!openedE && sseE.includes("event: open")) openedE = true;
  if (!triggeredE) {
    triggeredE = true;
    await routesHarness.mcpCall("document.createPage", { fileId: createdE.fileId, name: "P1" }).catch(() => {});
  }
  if (!updatedE && sseE.includes("event: updated")) {
    updatedE = true;
    break;
  }
}
await readerE.cancel().catch(() => {});
acE.abort();
check("E: SSE proxy streams open + updated", openedE && updatedE, JSON.stringify(sseE.slice(-120)));

const r4 = await fetch(`${baseE}/canvas/nope`);
check("E: unknown /canvas path is 404", r4.status === 404, String(r4.status));

disposeRoutes?.();
serverE.close();
routesHarness.dispose();
rmSync(routesDir, { recursive: true, force: true });

// ---- Part F: webServer boot race — routes register when webServer appears ----
const ctxF = new Context();
await ctxF.plugin(SkillRegistry);
let routeF = null;
const wsF = {
  register: (route) => {
    routeF = route;
    return () => {
      routeF = null;
    };
  },
};
await ctxF.plugin(plugin); // webServer NOT provided yet (real harness boot order)
check("F: routes not registered before webServer", routeF === null, String(routeF !== null));
ctxF.provide("webServer", wsF);
await new Promise((r) => setTimeout(r, 100));
check("F: routes registered after webServer provided", routeF !== null && routeF.path === "/canvas", routeF?.path);
await ctxF.dispose?.();

console.log(failures === 0 ? "\nsmoke: OK" : `\nsmoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
