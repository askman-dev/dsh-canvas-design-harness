/**
 * test/smoke.mjs — offline smoke test for the dual-spec repo.
 *
 * Part A: mounts the real @deepseek-ai/dsh-skill SkillRegistry + this repo's
 *         plugin.js and asserts the skills under .agents/skills/ are visible.
 * Part B: mounts the real @deepseek-ai/dsh-skill-filesystem provider with
 *         cwd = this repo and asserts native discovery from .agents/skills/
 *         (the Codex layout, rank 200 project-agents).
 *
 * Usage: node test/smoke.mjs
 */
import { Context } from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/cordis/lib/index.js";
import SkillRegistry from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-skill/lib/index.js";
import { apply as fsApply, inject as fsInject, name as fsName } from "file:///Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
console.log(failures === 0 ? "\nsmoke: OK" : `\nsmoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
