// DSH plugin wrapper for this repository (Repo B).
//
// The repo speaks two specs over one skill tree:
//   - Codex/Claude spec: .agents/skills/<name>/SKILL.md (+ reference/, server/,
//     specs/ and any other siblings).
//   - DSH plugin spec: this file + package.json (dsh.bundle.patch) +
//     cordis.patch.yml, installed with `dsh plugin --profile <p> add <repo>`.
//
// This wrapper has three responsibilities:
//   1. SKILLS — registers every skill under .agents/skills/ into the harness's
//      ctx.skills registry (host/global layer, rank 250) so the skills are
//      available from any workspace; the filesystem provider additionally
//      discovers the same tree natively when a session's cwd is this repo.
//      Editing a SKILL.md hot-reloads its registration.
//   2. DAEMON — exposes `ctx.canvasHarness`, a dependency-free lifecycle
//      client for the bundled canvas-design-harness server (spec
//      design_harness_external_process): probe / attach / spawn the singleton
//      daemon on 127.0.0.1:9321, register workspaces, list files, bridge MCP
//      calls, subscribe to SSE, and shut the daemon down with the plugin.
//   3. TOOLS — host/tools.js (second patch row) turns the same server into
//      native model tools (canvas_harness_*) via ctx.tools; it consumes the
//      ctx.canvasHarness face this plugin mounts.
//
// This file deliberately imports NOTHING from @deepseek-ai/* so it loads and
// tests in a bare Cordis context (see test/smoke.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { designsDirFor } from "./client/logic.js";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(REPO_ROOT, ".agents", "skills");

// ============================ skill registration ============================

// --- minimal frontmatter parser (subset of the dsh-skill-filesystem rules) ---
const BOOLEAN = /^(true|false|yes|no|on|off|1|0)$/i;
function parseBoolean(value) {
  const m = BOOLEAN.exec(String(value).trim());
  if (!m) return undefined;
  return /^(true|yes|on|1)$/i.test(m[1]);
}
function unquote(value) {
  const t = String(value ?? "").trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}
function skillDirs() {
  if (!existsSync(SKILLS_ROOT)) return [];
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_ROOT, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}
function loadSkill(dir) {
  const skillDir = join(SKILLS_ROOT, dir);
  const md = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  const fields = {};
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^([a-zA-Z0-9-]+):\s*(.*)$/.exec(line);
      if (kv) fields[kv[1]] = kv[2];
    }
  }
  const name = unquote(fields.name);
  const description = unquote(fields.description);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`invalid skill name "${name}"`);
  if (!description) throw new Error(`skill "${name}" requires a description`);
  const disableModel = parseBoolean(fields["disable-model-invocation"]);
  const userInvocable = parseBoolean(fields["user-invocable"]);
  const registration = {
    name,
    description,
    source: "runtime",
    content: fm ? md.slice(fm[0].length) : md,
    resourceBase: { kind: "directory", path: skillDir },
  };
  if (fields.whenToUse) registration.whenToUse = unquote(fields.whenToUse);
  if (disableModel !== undefined || userInvocable !== undefined) {
    registration.invocation = {
      modelInvocable: disableModel === undefined ? true : !disableModel,
      userInvocable: userInvocable === undefined ? true : userInvocable,
    };
  }
  return registration;
}

// ======================= daemon lifecycle + capability ======================
// Client for the bundled canvas-design-harness server
// (specs: design_harness_external_process / _http / _events / _mcp).
// Dependency-free: node builtins + fetch only.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createCanvasHarness({ skillDir, port = Number(process.env.CANVAS_HARNESS_PORT) || 9321 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  const serverEntry = join(skillDir, "server", "src", "index.js");
  let child = null;

  async function ping() {
    try {
      const res = await fetch(`${base}/ping`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  // Probe -> attach, or spawn the singleton daemon and wait for it.
  async function ensureWorkspace(root) {
    const abs = resolve(root);
    if (!existsSync(abs)) throw new Error(`canvas-design-harness: workspace root must exist: ${abs}`);
    let info = await ping();
    if (!info) {
      if (!existsSync(serverEntry)) throw new Error(`canvas-design-harness: bundled server missing at ${serverEntry}`);
      child = spawn(process.execPath, [serverEntry, abs, "--port", String(port)], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      for (let i = 0; i < 100; i += 1) {
        info = await ping();
        if (info) break;
        await sleep(100);
      }
      if (!info) throw new Error(`canvas-design-harness: daemon did not start on port ${port}`);
    }
    const res = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: abs }),
    });
    if (!res.ok) throw new Error(`canvas-design-harness: workspace registration failed (${res.status})`);
    return res.json();
  }

  async function listFiles(root) {
    const workspace = await ensureWorkspace(root);
    return workspace.files ?? [];
  }

  // Bridge one JSON-RPC 2.0 MCP call: tool names are invoked through the
  // standard `tools/call` method and results arrive wrapped in
  // content[0].text (specs: design_harness_external_mcp). Throws on the
  // server's error branch.
  async function mcpCall(toolName, args = {}, options = {}) {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } }),
      signal: options.signal,
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? String(body.error));
    const result = body.result;
    const text = result?.content?.[0]?.text;
    if (text !== undefined) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return result;
  }

  function openUrl(fileId) {
    return `${base}/open?file=${encodeURIComponent(fileId)}`;
  }

  // Subscribe to one file's SSE stream (specs: design_harness_external_events).
  // Returns an unsubscribe function; the connection is best-effort.
  function events(fileId, onEvent) {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${base}/events?fileId=${encodeURIComponent(fileId)}`, { signal: controller.signal });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (event && data !== undefined) onEvent({ event, data });
          }
        }
      } catch {
        /* aborted or dropped connection */
      }
    })();
    return () => controller.abort();
  }

  function dispose() {
    if (child) {
      try { child.kill(); } catch { /* already gone */ }
      child = null;
    }
  }

  return { base, port, ping, ensureWorkspace, listFiles, mcpCall, openUrl, events, dispose };
}

/** Locate the skill directory that bundles the server (server/src/index.js). */
export function findServerSkillDir() {
  for (const dir of skillDirs()) {
    const candidate = join(SKILLS_ROOT, dir, "server", "src", "index.js");
    if (existsSync(candidate)) return join(SKILLS_ROOT, dir);
  }
  return undefined;
}

// Exported for offline tests (test/smoke.mjs Part E): the /canvas route family
// and its workspace→designs-dir resolution, exercised against a real daemon.
export { registerCanvasRoutes, resolveDesignsRoot };

// ======================= web routes for the browser half =====================
// The browser half (client/design-view.js) is a DSH client module served to
// the web GUI. It talks to this host half over same-origin HTTP routes on the
// harness web server (`ctx.webServer`), so no CORS and no framework RPC
// extension is needed:
//   GET /canvas/designs?sessionId=&root=  -> { ok, root, base, files }
//   GET /canvas/open?file=<fileId>        -> 302 to the daemon viewer
//   GET /canvas/events?file=<fileId>      -> SSE proxy of daemon update events
// The webServer / workspaceRegistry services are accessed lazily (never via
// `inject`) so plugin.js keeps loading in a bare Cordis test context.

function writeJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

/** Resolve the designs dir: explicit ?root= wins, else the session's workspace. */
function resolveDesignsRoot(ctx, params) {
  const root = params.get("root");
  if (root) return root.replace(/\/+$/, "");
  const sessionId = params.get("sessionId");
  if (!sessionId) return undefined;
  let workspaceRegistry;
  try {
    workspaceRegistry = ctx.get("workspaceRegistry");
  } catch {
    workspaceRegistry = undefined;
  }
  if (workspaceRegistry && typeof workspaceRegistry.list === "function") {
    for (const ws of workspaceRegistry.list()) {
      if (ws.sessionIds && ws.sessionIds.includes(sessionId)) return designsDirFor(ws.path);
    }
  }
  return undefined;
}

/** Register the /canvas/* route family. Returns a disposer (or undefined). */
function registerCanvasRoutes(ctx, harness) {
  let webServer;
  try {
    webServer = ctx.get("webServer");
  } catch {
    webServer = undefined;
  }
  if (!webServer || typeof webServer.register !== "function") {
    if (ctx.logger) ctx.logger.warn(`${name}: webServer unavailable — browser half routes disabled`);
    return undefined;
  }
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/canvas/designs") {
        const root = resolveDesignsRoot(ctx, url.searchParams);
        if (!root) {
          writeJson(res, 200, { ok: false, code: "no-root", error: "无法确定设计稿目录（缺少 root，且会话不属于任何工作区）" });
          return;
        }
        try {
          const files = await harness.listFiles(root);
          writeJson(res, 200, { ok: true, root, base: harness.base, files: files ?? [] });
        } catch (err) {
          writeJson(res, 200, { ok: false, code: "designs-dir-missing", root, error: String((err && err.message) || err) });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/canvas/init") {
        const root = resolveDesignsRoot(ctx, url.searchParams);
        if (!root) {
          writeJson(res, 200, { ok: false, code: "no-root", error: "无法确定设计稿目录" });
          return;
        }
        try {
          mkdirSync(root, { recursive: true });
          const ws = await harness.ensureWorkspace(root);
          let files = await harness.listFiles(root);
          if (!files || files.length === 0) {
            const created = await harness.mcpCall("document.createFile", { workspaceId: ws.id, name: "starter.html" });
            const pageRes = await harness.mcpCall("document.createPage", { fileId: created.fileId, name: "主页面" });
            await harness.mcpCall("batch", {
              fileId: created.fileId,
              operations: [
                { tool: "page.createFrame", arguments: { fileId: created.fileId, pageId: pageRes.pageId, name: "欢迎使用 Canvas Design", size: { w: 1200, h: 800 } } },
                { tool: "frame.addComponent", arguments: { fileId: created.fileId, type: "card", props: { title: "开始设计你的界面", description: "在对话框中向 Agent 描述需求，即可自动在此生成和修改设计稿。" } } },
              ],
            }).catch(() => {});
            files = await harness.listFiles(root);
          }
          writeJson(res, 200, { ok: true, root, base: harness.base, files: files ?? [] });
        } catch (err) {
          writeJson(res, 200, { ok: false, root, error: String((err && err.message) || err) });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/canvas/create") {
        const root = resolveDesignsRoot(ctx, url.searchParams);
        if (!root) {
          writeJson(res, 200, { ok: false, code: "no-root", error: "无法确定设计稿目录" });
          return;
        }
        try {
          let name = url.searchParams.get("name") || "new-design.html";
          if (!name.endsWith(".html")) name += ".html";
          name = name.replace(/[^a-zA-Z0-9._-]/g, "_");
          mkdirSync(root, { recursive: true });
          const ws = await harness.ensureWorkspace(root);
          const created = await harness.mcpCall("document.createFile", { workspaceId: ws.id, name });
          await harness.mcpCall("document.createPage", { fileId: created.fileId, name: "页面 1" }).catch(() => {});
          const files = await harness.listFiles(root);
          writeJson(res, 200, { ok: true, root, base: harness.base, fileId: created.fileId, name, files: files ?? [] });
        } catch (err) {
          writeJson(res, 200, { ok: false, root, error: String((err && err.message) || err) });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/canvas/open") {
        const file = url.searchParams.get("file");
        if (!file) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("missing file");
          return;
        }
        res.writeHead(302, { location: harness.openUrl(file) });
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/canvas/events") {
        const file = url.searchParams.get("file");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write("event: open\ndata: connected\n\n");
        const unsubscribe = file
          ? harness.events(file, (evt) => {
              try {
                res.write(`event: ${evt.event}\ndata: ${evt.data}\n\n`);
              } catch {
                /* socket gone */
              }
            })
          : undefined;
        req.on("close", () => unsubscribe?.());
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      try {
        writeJson(res, 500, { ok: false, error: String((err && err.message) || err) });
      } catch {
        /* socket gone */
      }
    }
  };
  try {
    return webServer.register({ kind: "prefix", path: "/canvas", handler: handle });
  } catch (err) {
    if (ctx.logger) ctx.logger.warn(`${name}: /canvas route registration failed: ${err.message}`);
    return undefined;
  }
}

// ================================= plugin ===================================

export const name = "dsh-canvas-design-harness";
export const inject = ["skills"];

export function apply(ctx) {
  // --- skills (rank 250 runtime registration + hot reload) ---
  let disposers = new Map();
  const registerAll = () => {
    for (const dispose of disposers.values()) {
      try { dispose(); } catch { /* best-effort teardown */ }
    }
    disposers = new Map();
    for (const dir of skillDirs()) {
      try {
        disposers.set(dir, ctx.skills.register(loadSkill(dir)));
      } catch (err) {
        if (ctx.logger) ctx.logger.warn(`${name}: skipped ${dir}: ${err.message}`);
      }
    }
  };
  registerAll();
  const watchers = skillDirs().map((dir) => {
    const file = join(SKILLS_ROOT, dir, "SKILL.md");
    let timer;
    const watcher = watch(file, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          registerAll();
          if (ctx.logger) ctx.logger.info(`${name}: re-registered after ${dir}/SKILL.md change`);
        } catch (err) {
          if (ctx.logger) ctx.logger.warn(`${name}: keeping previous registrations (${err.message})`);
        }
      }, 200);
    });
    watcher.on("error", () => {});
    return watcher;
  });

  // --- daemon lifecycle service for host/tools.js and the client half ---
  const serverSkillDir = findServerSkillDir();
  let harness;
  let provideHarness;
  let disposeRoutes;
  if (serverSkillDir) {
    harness = createCanvasHarness({ skillDir: serverSkillDir });
    provideHarness = ctx.provide("canvasHarness", harness);
    // The webServer service may not exist yet when this row applies (the web
    // stack boots asynchronously). Register the /canvas routes immediately
    // when it does, otherwise wait for the service through cordis's
    // inject-wait mechanism — otherwise /canvas/* falls through to the SPA
    // fallback and the browser half fails to load the design list.
    const tryRegister = () => {
      let webServer;
      try {
        webServer = ctx.get("webServer");
      } catch {
        webServer = undefined;
      }
      if (webServer && typeof webServer.register === "function") {
        disposeRoutes = registerCanvasRoutes(ctx, harness);
        return true;
      }
      return false;
    };
    if (tryRegister()) {
      if (ctx.logger) ctx.logger.info(`${name}: /canvas routes registered`);
    } else {
      ctx.inject(["webServer"], (ctx2) => {
        ctx2.effect(() => registerCanvasRoutes(ctx2, harness), `${name}: /canvas routes`);
      });
      if (ctx.logger) ctx.logger.info(`${name}: webServer not ready yet — /canvas routes will register when it is`);
    }
    if (ctx.logger) ctx.logger.info(`${name}: canvas-design-harness daemon client ready (port ${harness.port})`);
  } else if (ctx.logger) {
    ctx.logger.warn(`${name}: no bundled server found — daemon tools disabled`);
  }

  return () => {
    for (const watcher of watchers) watcher.close();
    for (const dispose of disposers.values()) {
      try { dispose(); } catch { /* best-effort teardown */ }
    }
    if (typeof disposeRoutes === "function") {
      try { disposeRoutes(); } catch { /* best-effort teardown */ }
    }
    provideHarness?.();
    harness?.dispose();
  };
}

export default { name, inject, apply };
