// DSH plugin wrapper for this repository.
//
// The repo speaks two specs over one skill tree:
//   - Codex/Claude spec: .agents/skills/<name>/SKILL.md (+ reference/, server/,
//     specs/ and any other siblings).
//   - DSH plugin spec: this file + package.json (dsh.bundle.patch) +
//     cordis.patch.yml, installed with `dsh plugin --profile <p> add <repo>`.
//
// This wrapper registers every skill under .agents/skills/ into the harness's
// ctx.skills registry (host/global layer, rank 250), so the skills are
// available from any workspace. The harness filesystem provider additionally
// discovers the same tree natively when a session's cwd is this repo
// (project-agents, rank 200 — within one layer it wins by rank). Editing a
// SKILL.md hot-reloads its registration.
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(REPO_ROOT, ".agents", "skills");

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

export const name = "dsh-canvas-design-harness";
export const inject = ["skills"];

export function apply(ctx) {
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
  return () => {
    for (const watcher of watchers) watcher.close();
    for (const dispose of disposers.values()) {
      try { dispose(); } catch { /* best-effort teardown */ }
    }
  };
}

export default { name, inject, apply };
