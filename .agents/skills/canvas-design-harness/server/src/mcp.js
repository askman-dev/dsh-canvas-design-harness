// HTTP-MCP over the HTML document, with Figma-object-model tool names so the
// agent can reuse its knowledge of the Figma API (page.createFrame,
// node.set, node.screenshot ...). Every write is: read -> parse (validate)
// -> mutate -> serialize -> atomic replace. `batch` runs several operations
// on one parse/serialize/write cycle and is atomic as a whole.
// Specs: design_harness_http_mcp, design_harness_html_document
import fs from 'node:fs';
import path from 'node:path';
import {
  emptyDocument,
  findFrame,
  findNode,
  findPage,
  newId,
  parseDocument,
  serializeDocument,
} from './html.js';
import { canHaveChildren, validateProps, validateType } from './components.js';
import { screenshotDocument } from './screenshot.js';

const TEXT_PROPS = {
  text: 'value',
  field: 'value',
  heading: 'value',
  title2: 'value',
  button: 'label',
  'action-row': 'label',
  'app-bar': 'title',
  section: 'title',
  'launch-sheet': 'title',
  'figjam-sticky': 'title',
};

const tools = [
  { name: 'document.createFile', aliases: ['create_file'], inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, name: { type: 'string' } }, required: ['workspaceId', 'name'] } },
  { name: 'document.selectPage', aliases: ['select_page'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, pageId: { type: 'string' } }, required: ['fileId', 'pageId'] } },
  { name: 'document.selectFrame', aliases: ['select_frame'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, frameId: { type: 'string' } }, required: ['fileId', 'frameId'] } },
  { name: 'document.getDocument', aliases: ['get_document'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] } },
  { name: 'document.validate', aliases: ['validate'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] } },
  { name: 'document.createPage', aliases: ['create_page'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, name: { type: 'string' } }, required: ['fileId'] } },
  { name: 'page.createFrame', aliases: ['create_frame'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, pageId: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, size: { type: 'object' } }, required: ['fileId'] } },
  { name: 'frame.addComponent', aliases: ['add_component'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, frameId: { type: 'string' }, type: { type: 'string' }, props: { type: 'object' }, parentId: { type: 'string' } }, required: ['fileId', 'type'] } },
  { name: 'node.setText', aliases: ['set_text'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' }, text: { type: 'string' } }, required: ['fileId', 'nodeId', 'text'] } },
  { name: 'node.setProps', aliases: ['set_props'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' }, props: { type: 'object' } }, required: ['fileId', 'nodeId', 'props'] } },
  { name: 'node.setState', aliases: ['set_state'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' }, state: { type: 'string' } }, required: ['fileId', 'nodeId', 'state'] } },
  { name: 'node.remove', aliases: ['remove_node'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' } }, required: ['fileId', 'nodeId'] } },
  { name: 'node.connect', aliases: ['connect'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, fromId: { type: 'string' }, toId: { type: 'string' } }, required: ['fileId', 'fromId', 'toId'] } },
  { name: 'node.getNode', aliases: ['get_frame'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' } }, required: ['fileId', 'nodeId'] } },
  { name: 'node.getScreenshot', aliases: ['get_screenshot'], inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, nodeId: { type: 'string' } }, required: ['fileId'] } },
  { name: 'workspace.list', aliases: ['list_workspaces'], inputSchema: { type: 'object', properties: {} } },
  { name: 'workspace.listFiles', aliases: ['list_files'], inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] } },
  { name: 'batch', inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, operations: { type: 'array' } }, required: ['fileId', 'operations'] } },
];

const ALIASES = Object.fromEntries(
  tools.flatMap((tool) => (tool.aliases || []).map((alias) => [alias, tool.name])),
);

const READ_ONLY = new Set([
  'document.getDocument',
  'document.validate',
  'node.getNode',
  'node.getScreenshot',
  'workspace.list',
  'workspace.listFiles',
]);

export class Mcp {
  constructor(registry, events) {
    this.registry = registry;
    this.events = events;
  }

  file(fileId) {
    const file = this.registry.filesById.get(fileId);
    if (!file) throw new Error(`file not found: ${fileId}`);
    return file;
  }

  read(fileId) {
    return fs.readFileSync(this.file(fileId).htmlPath, 'utf8');
  }

  // Atomic write: temp file + rename; never leaves a partial document.
  write(file, html) {
    const tmp = `${file.htmlPath}.${newId('tmp')}`;
    fs.writeFileSync(tmp, html, 'utf8');
    fs.renameSync(tmp, file.htmlPath);
  }

  async call(name, args) {
    const canonical = ALIASES[name] || name;
    switch (canonical) {
      case 'document.createFile':
        return this.opCreateFile(args);
      case 'document.selectPage':
      case 'document.selectFrame':
        throw new Error(`${canonical} is only valid inside batch (MCP calls are stateless)`);
      case 'batch':
        return this.opBatch(args);
      default: {
        const fileId = args.fileId;
        const file = this.file(fileId);
        const doc = parseDocument(this.read(fileId));
        // Stateless single call: no inherited selection. Mirror Figma's
        // currentPage default only inside batch; here ids must be explicit.
        const result = this.runOp(canonical, doc, args, fileId, { pageId: null, frameId: null });
        if (!READ_ONLY.has(canonical)) {
          this.write(file, serializeDocument(doc));
          this.events.emit(file.id);
        }
        return result;
      }
    }
  }

  opCreateFile(args) {
    const workspace = this.registry.findWorkspace(args.workspaceId);
    if (!workspace) throw new Error(`workspace not found: ${args.workspaceId}`);
    const safeName = args.name.endsWith('.html') ? args.name : `${args.name}.html`;
    const htmlPath = path.join(workspace.root, safeName);
    const doc = emptyDocument(safeName.replace(/\.html$/, ''));
    this.write({ htmlPath }, serializeDocument(doc));
    const file = this.registry.addFile(args.workspaceId, safeName, htmlPath);
    return { createdIds: [file.id], fileId: file.id };
  }

  opBatch(args) {
    const fileId = args.fileId;
    const file = this.file(fileId);
    const doc = parseDocument(this.read(fileId));
    // Mirrors Figma: a script starts with currentPage = first page and may
    // call setCurrentPageAsync (document.selectPage / selectFrame) mid-script.
    const current = { pageId: doc.pages[0]?.id || null, frameId: null };
    const results = [];
    for (const operation of args.operations || []) {
      const canonical = ALIASES[operation.tool] || operation.tool;
      if (canonical === 'batch') throw new Error('batch cannot nest batch');
      results.push(this.runOp(canonical, doc, operation.arguments || {}, fileId, current));
    }
    this.write(file, serializeDocument(doc));
    this.events.emit(file.id);
    return { count: results.length, results };
  }

  // Pure operations on an already-parsed document. Throwing leaves the file
  // untouched (the caller writes only after the whole op/batch succeeds).
  runOp(canonical, doc, args, fileId, current) {
    switch (canonical) {
      case 'document.createPage': {
        const page = { id: newId('page'), type: 'page', props: { name: args.name || '页面' }, frames: [] };
        doc.pages.push(page);
        current.pageId = page.id;
        current.frameId = null;
        return { createdIds: [page.id], pageId: page.id };
      }
      case 'document.selectPage': {
        if (!findPage(doc, args.pageId)) throw new Error(`page not found: ${args.pageId}`);
        current.pageId = args.pageId;
        current.frameId = null;
        return { pageId: args.pageId };
      }
      case 'document.selectFrame': {
        const frame = findFrame(doc, args.frameId);
        if (!frame) throw new Error(`frame not found: ${args.frameId}`);
        const page = doc.pages.find((p) => p.frames.some((f) => f.id === args.frameId));
        current.pageId = page ? page.id : current.pageId;
        current.frameId = args.frameId;
        return { frameId: args.frameId, pageId: current.pageId };
      }
      case 'page.createFrame': {
        const pageId = args.pageId || current.pageId;
        if (!pageId) throw new Error('pageId required (or use batch with document.selectPage)');
        const page = findPage(doc, pageId);
        if (!page) throw new Error(`page not found: ${pageId}`);
        const size = args.size || { w: 393, h: 852 };
        const frame = {
          id: newId('frame'),
          type: 'frame',
          props: { name: args.name || 'Frame', kind: args.kind || 'phone', size: { w: size.w, h: size.h } },
          components: [],
        };
        page.frames.push(frame);
        current.pageId = page.id;
        current.frameId = frame.id;
        return { createdIds: [frame.id], frameId: frame.id };
      }
      case 'frame.addComponent': {
        const typeError = validateType(args.type);
        if (typeError) throw new Error(typeError);
        const propsError = validateProps(args.type, args.props || {});
        if (propsError) throw new Error(propsError);
        const frameId = args.frameId || current.frameId;
        if (!frameId) throw new Error('frameId required (or use batch with document.selectFrame)');
        const frame = findFrame(doc, frameId);
        if (!frame) throw new Error(`frame not found: ${frameId}`);
        const node = { id: newId('c'), type: args.type, props: { ...(args.props || {}) }, children: [] };
        if (args.parentId) {
          const parent = findNode(doc, args.parentId);
          if (!parent || !canHaveChildren(parent.type)) {
            throw new Error(`cannot attach child to ${args.parentId || '<missing>'}`);
          }
          parent.children.push(node);
        } else {
          frame.components.push(node);
        }
        return { createdIds: [node.id], nodeId: node.id };
      }
      case 'node.setText': {
        const node = findNode(doc, args.nodeId);
        if (!node) throw new Error(`node not found: ${args.nodeId}`);
        const key = TEXT_PROPS[node.type] || 'text';
        const propsError = validateProps(node.type, { ...node.props, [key]: args.text });
        if (propsError) throw new Error(propsError);
        node.props[key] = args.text;
        return { mutatedIds: [args.nodeId], ok: true };
      }
      case 'node.setProps': {
        const node = findNode(doc, args.nodeId);
        if (!node) throw new Error(`node not found: ${args.nodeId}`);
        const propsError = validateProps(node.type, args.props || {});
        if (propsError) throw new Error(propsError);
        node.props = { ...node.props, ...(args.props || {}) };
        return { mutatedIds: [args.nodeId], ok: true };
      }
      case 'node.setState': {
        const node = findNode(doc, args.nodeId);
        if (!node) throw new Error(`node not found: ${args.nodeId}`);
        node.props = { ...node.props, state: args.state };
        return { mutatedIds: [args.nodeId], ok: true };
      }
      case 'node.connect': {
        const owner = frameOwningNode(doc, args.fromId) || frameOwningNode(doc, args.toId);
        if (!owner) throw new Error('connector needs an existing node in a frame');
        const node = { id: newId('c'), type: 'connector', props: { fromId: args.fromId, toId: args.toId }, children: [] };
        owner.components.push(node);
        return { createdIds: [node.id], nodeId: node.id };
      }
      case 'node.remove': {
        if (!removeNode(doc, args.nodeId)) throw new Error(`node not found: ${args.nodeId}`);
        return { mutatedIds: [args.nodeId], ok: true };
      }
      case 'document.getDocument':
        return { document: doc };
      case 'node.getNode': {
        const node = findNode(doc, args.nodeId) || findFrame(doc, args.nodeId);
        if (!node) throw new Error(`node not found: ${args.nodeId}`);
        return { node };
      }
      case 'node.getScreenshot': {
        const svg = screenshotDocument(doc, { frameId: args.nodeId });
        return { format: 'svg', svg, dataUri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
      }
      case 'document.validate':
        return { ok: true, pages: doc.pages.length, frames: doc.pages.reduce((n, p) => n + p.frames.length, 0) };
      case 'workspace.list':
        return { workspaces: this.registry.workspaces.map(({ id, name, root, files }) => ({ id, name, root, files: files.map((f) => ({ id: f.id, name: f.name })) })) };
      case 'workspace.listFiles': {
        const workspace = this.registry.findWorkspace(args.workspaceId);
        if (!workspace) throw new Error(`workspace not found: ${args.workspaceId}`);
        return { files: workspace.files.map(({ id, name }) => ({ id, name })) };
      }
      default:
        throw new Error(`unknown tool: ${canonical}`);
    }
  }

  async dispatch(method, params) {
    if (method === 'tools/list') return { tools };
    if (method === 'resources/list') {
      return {
        resources: this.registry.workspaces.flatMap((workspace) =>
          workspace.files.map((file) => ({ uri: `harness://workspaces/${workspace.id}/files/${file.id}`, name: file.name })),
        ),
      };
    }
    if (method === 'resources/read') {
      const match = String(params?.uri || '').match(/files\/([^/]+)$/);
      if (!match) throw new Error(`bad resource uri: ${params?.uri}`);
      return { contents: [{ uri: params.uri, text: JSON.stringify(parseDocument(this.read(match[1])), null, 2) }] };
    }
    if (method === 'tools/call') {
      const result = await this.call(params.name, params.arguments || {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    throw new Error(`unsupported method: ${method}`);
  }
}

function frameOwningNode(doc, nodeId) {
  for (const page of doc.pages) {
    for (const frame of page.frames) {
      if (contains(frame, nodeId)) return frame;
    }
  }
  return null;
}

function contains(node, nodeId) {
  if (node.id === nodeId) return true;
  for (const child of node.children || node.components || []) {
    if (contains(child, nodeId)) return true;
  }
  return false;
}

function removeNode(doc, nodeId) {
  for (let p = 0; p < doc.pages.length; p += 1) {
    const page = doc.pages[p];
    if (page.id === nodeId) {
      doc.pages.splice(p, 1);
      return true;
    }
    for (let i = 0; i < page.frames.length; i += 1) {
      if (page.frames[i].id === nodeId) {
        page.frames.splice(i, 1);
        return true;
      }
      if (removeFromChildren(page.frames[i], nodeId)) return true;
    }
  }
  return false;
}

function removeFromChildren(node, nodeId) {
  const list = node.children || node.components || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === nodeId) {
      list.splice(i, 1);
      return true;
    }
    if (removeFromChildren(list[i], nodeId)) return true;
  }
  return false;
}
