// Specs: design_harness_singleton_service, design_harness_external_file_identity
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { newId, parseDocument } from './html.js';

// Stable file identity (spec design_harness_external_file_identity): the id is
// derived from (workspaceId, file name), so re-scanning a workspace never
// changes a file's id within the process (or across restarts). Clients key
// designs by (root, name); file ids stay valid while the file exists.
function fileIdFor(workspaceId, name) {
  return 'file_' + createHash('sha1').update(`${workspaceId}/${name}`).digest('hex').slice(0, 12);
}

// Per-file metadata for client galleries: page/frame counts come from the
// framework parser, updatedAt from the file mtime. Parsing is best-effort:
// an unparseable HTML entry still lists with zero counts.
function scanFile(workspaceId, abs, name) {
  const htmlPath = path.join(abs, name);
  const stats = fs.existsSync(htmlPath) ? fs.statSync(htmlPath) : null;
  let pageCount = 0;
  let frameCount = 0;
  try {
    const doc = parseDocument(fs.readFileSync(htmlPath, 'utf8'));
    pageCount = (doc.pages || []).length;
    frameCount = (doc.pages || []).reduce((sum, page) => sum + (page.frames || []).length, 0);
  } catch {
    /* unparseable draft — list it with zero counts */
  }
  return {
    id: fileIdFor(workspaceId, name),
    name,
    relPath: path.relative(abs, htmlPath),
    htmlPath,
    workspaceId,
    pageCount,
    frameCount,
    updatedAt: stats ? stats.mtimeMs : null,
  };
}

export class Registry {
  constructor() {
    this.workspaces = [];
    this.filesById = new Map();
  }

  // One workspace per root path; repeated registration upserts the same id.
  upsertWorkspace(root) {
    const abs = path.resolve(root);
    let workspace = this.workspaces.find((item) => item.root === abs);
    if (!workspace) {
      workspace = { id: newId('ws'), name: path.basename(abs), root: abs, files: [] };
      this.workspaces.push(workspace);
    }
    workspace.files = fs.existsSync(abs)
      ? fs
          .readdirSync(abs)
          .filter((name) => name.endsWith('.html') && !name.endsWith('.fragment.html'))
          .map((name) => scanFile(workspace.id, abs, name))
      : [];
    for (const file of workspace.files) this.filesById.set(file.id, file);
    return workspace;
  }

  addFile(workspaceId, name, htmlPath) {
    const workspace = this.findWorkspace(workspaceId);
    if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
    const file = scanFile(workspaceId, workspace.root, name);
    file.htmlPath = htmlPath;
    workspace.files.push(file);
    this.filesById.set(file.id, file);
    return file;
  }

  findWorkspace(id) {
    return this.workspaces.find((item) => item.id === id);
  }

  findFile(workspaceId, fileId) {
    const workspace = this.findWorkspace(workspaceId);
    return workspace ? workspace.files.find((file) => file.id === fileId) : null;
  }
}
