// scripts/verify-web.mjs — LIVE acceptance check for the DSH web GUI.
//
// Proves, against a running DSH web profile, that the plugin is actually
// loaded and wired — the three layers that have to be true for the
// `设计大厅` / `Design Gallery` tab to work:
//
//   1. CLIENT half composed — `window.__DSH_BOOT__.entries` (served in the
//      index.html) contains the `dsh-canvas-design-harness` client entry with
//      its inject list.
//   2. CLIENT bundle served — GET /plugins/dsh-canvas-design-harness/client.js
//      returns the classic-script bundle that registers the factory.
//   3. HOST routes live — GET /canvas/designs returns a JSON body (not the
//      SPA index HTML). This is the check that catches the webServer boot
//      race: when the route is missing, /canvas/* falls through to the SPA
//      fallback and the tab shows the generic load error.
//
// Usage (run in a normal terminal, the GUI must be up):
//   node scripts/verify-web.mjs [--port 3080] [--sessionId <id>]
//
// Without --sessionId it reads the first session id from the workspace
// storage, so the designs check runs against a real workspace.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.DSH_WEB_PORT || 3080);
const sidIdx = args.indexOf("--sessionId");
let sessionId = sidIdx >= 0 ? args[sidIdx + 1] : undefined;
const base = `http://127.0.0.1:${port}`;

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function pickSessionId() {
  const storage = join(homedir(), ".dsh", "storages", "workspace.json");
  if (!existsSync(storage)) return undefined;
  try {
    const data = JSON.parse(readFileSync(storage, "utf8"));
    const table = data?.tables?.workspaces ?? {};
    for (const ws of Object.values(table)) {
      if (Array.isArray(ws.sessionIds) && ws.sessionIds.length > 0) return ws.sessionIds[0];
    }
  } catch {
    /* keep undefined */
  }
  return undefined;
}

// --- 1. boot graph ---
let graph;
try {
  const html = await (await fetch(`${base}/`)).text();
  const m = /window\.__DSH_BOOT__ = (\{.*?\})\s*<\/script>/.exec(html);
  graph = m ? JSON.parse(m[1]) : null;
} catch {
  graph = null;
}
const entry = graph?.entries?.find((e) => e.id === "dsh-canvas-design-harness");
check("client entry in boot graph", !!entry, entry ? `rev=${entry.rev}` : "missing from __DSH_BOOT__.entries");
check(
  "client entry injects locale/runtime/conversation",
  !!entry?.inject &&
    ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"].every((n) => entry.inject.includes(n)),
  JSON.stringify(entry?.inject),
);

// --- 2. bundle served ---
let bundleOk = false;
let bundleHead = "";
try {
  const url = entry ? `${base}${entry.url}` : `${base}/plugins/dsh-canvas-design-harness/client.js`;
  const res = await fetch(url);
  const text = await res.text();
  bundleOk =
    res.status === 200 &&
    text.includes("window.__ModuleLoader__.load") &&
    text.includes('id: "dsh-canvas-design-harness"') &&
    text.includes('exports.apply = apply');
  bundleHead = text.slice(0, 46).replace(/\n/g, " ");
} catch {
  bundleOk = false;
}
check("client bundle served", bundleOk, bundleHead);

// --- 3. host routes live (the webServer-boot-race check) ---
if (!sessionId) sessionId = pickSessionId();
let routeDetail = "";
let routeOk = false;
try {
  const url = `${base}/canvas/designs${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`;
  const res = await fetch(url);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON — route fell through to the SPA fallback */
  }
  if (body && typeof body.ok === "boolean") {
    routeOk = true;
    routeDetail = body.ok
      ? `ok, ${body.files?.length ?? 0} files in ${body.root}`
      : `ok=false code=${body.code} (${body.root ?? "no root"})`;
  } else {
    routeDetail = `NOT JSON (${text.slice(0, 40)}…) — /canvas route is not registered`;
  }
} catch (err) {
  routeDetail = `fetch failed: ${err.message}`;
}
check("host /canvas/designs route returns JSON", routeOk, routeDetail);

console.log(failures === 0 ? "\nverify-web: OK" : `\nverify-web: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
