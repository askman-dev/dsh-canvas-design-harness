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
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (serverSkillDir) {
    harness = createCanvasHarness({ skillDir: serverSkillDir });
    provideHarness = ctx.provide("canvasHarness", harness);
    if (ctx.logger) ctx.logger.info(`${name}: canvas-design-harness daemon client ready (port ${harness.port})`);
  } else if (ctx.logger) {
    ctx.logger.warn(`${name}: no bundled server found — daemon tools disabled`);
  }

  return () => {
    for (const watcher of watchers) watcher.close();
    for (const dispose of disposers.values()) {
      try { dispose(); } catch { /* best-effort teardown */ }
    }
    provideHarness?.();
    harness?.dispose();
  };
}

export default { name, inject, apply };
