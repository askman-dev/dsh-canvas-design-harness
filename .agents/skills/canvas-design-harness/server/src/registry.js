// Spec: design_harness_singleton_service
import fs from 'node:fs';
import path from 'node:path';
import { newId } from './html.js';

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
          .map((name) => ({
            id: newId('file'),
            name,
            htmlPath: path.join(abs, name),
          }))
      : [];
    for (const file of workspace.files) this.filesById.set(file.id, file);
    return workspace;
  }

  addFile(workspaceId, name, htmlPath) {
    const workspace = this.findWorkspace(workspaceId);
    if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
    const file = { id: newId('file'), name, htmlPath };
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
