#!/usr/bin/env node
// Specs: design_harness_singleton_service, design_harness_http_mcp
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Registry } from './registry.js';
import { Mcp } from './mcp.js';

const DEFAULT_PORT = 9321;

function readArgs(argv) {
  const folder = argv[2];
  let port = Number(process.env.CANVAS_HARNESS_PORT || DEFAULT_PORT);
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') port = Number(argv[i + 1]);
    else if (arg.startsWith('--port=')) port = Number(arg.split('=')[1]);
  }
  if (!folder) {
    console.error('usage: node src/index.js <folder> [--port N]');
    process.exit(2);
  }
  return { folder, port };
}

async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export class HarnessServer {
  constructor({ folder, port }) {
    this.folder = folder;
    this.port = port;
    this.registry = new Registry();
    this.events = new Events();
    this.mcp = new Mcp(this.registry, this.events);
    this.registry.upsertWorkspace(folder);
    this.clients = new Set();
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', resolve);
    });
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    let requestId = null;
    try {
      if (req.method === 'GET' && url.pathname === '/ping') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, port: this.port, workspaces: this.registry.workspaces.length }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/workspaces') {
        const body = JSON.parse(await readBody(req));
        const workspace = this.registry.upsertWorkspace(body.root);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(workspace));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/workspaces') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ workspaces: this.registry.workspaces }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const wantsJson = String(req.headers.accept || '').includes('application/json');
        if (wantsJson) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ workspaces: this.registry.workspaces }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(this.homeHtml());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/open') {
        const file = this.registry.filesById.get(url.searchParams.get('file'));
        if (!file) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('file not found');
          return;
        }
        const html = path.extname(file.htmlPath) === '.html' && exists(file.htmlPath) ? file.htmlPath : null;
        if (!html) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('render the file first via the render tool');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        const source = await readFile(html);
        const liveReload = `<script>(function(){var events=new EventSource('/events?fileId=${encodeURIComponent(file.id)}');events.addEventListener('updated',function(){location.reload();});})();</script>`;
        res.end(source.replace('</body>', `${liveReload}</body>`));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        this.events.subscribe(res, url.searchParams.get('fileId'));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/mcp') {
        const body = JSON.parse(await readBody(req));
        requestId = body?.id ?? null;
        const result = await this.mcp.dispatch(body.method, body.params);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch (error) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: requestId, error: { code: -32603, message: String(error.message || error) } }));
    }
  }

  homeHtml() {
    const groups = this.registry.workspaces
      .map(
        (workspace) => `<section class="ws-group">
          <h2>${escapeHtml(workspace.name)} <small>${workspace.files.length} files</small></h2>
          <ul>${workspace.files
            .map(
              (file) =>
                `<li><a href="/open?file=${encodeURIComponent(file.id)}">${escapeHtml(file.name)}</a></li>`,
            )
            .join('') || '<li>no .html files</li>'}</ul>
        </section>`,
      )
      .join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Canvas Design Harness</title>
    <style>body{font-family:-apple-system,system-ui,sans-serif;max-width:880px;margin:32px auto;padding:0 20px;color:#141a22}h2 small{color:#98a2b3;font-weight:400}.ws-group{border:1px solid #e1e8f0;border-radius:14px;padding:14px 18px;margin-bottom:18px}ul{list-style:none;padding:0;margin:8px 0 0}li a{display:block;padding:8px 10px;border-radius:8px;color:#176ff2;text-decoration:none}li a:hover{background:#eef4ff}</style></head>
    <body><h1>Canvas Design Harness</h1>${groups || '<p>no workspaces</p>'}</body></html>`;
  }
}

class Events {
  constructor() {
    this.clients = new Set();
  }

  subscribe(res, fileId) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const client = { res, fileId: fileId || '*' };
    this.clients.add(client);
    res.write('event: open\ndata: connected\n\n');
    res.on('close', () => this.clients.delete(client));
  }

  emit(file) {
    const payload = {
      workspaceId: file.workspaceId ?? null,
      fileId: file.id,
      action: 'update',
      updatedAt: Date.now(),
    };
    for (const client of this.clients) {
      if (client.fileId === '*' || client.fileId === file.id) {
        client.res.write(`event: updated\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function readFile(p) {
  return fs.promises.readFile(p, 'utf8');
}

// CLI entry: reuse a running instance on the port, otherwise become it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { folder, port } = readArgs(process.argv);
  if (await ping(port)) {
    const res = await fetch(`http://127.0.0.1:${port}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: folder }),
    });
    console.log(`reused harness on port ${port} (${res.status})`);
    process.exit(0);
  }
  const server = new HarnessServer({ folder, port });
  await server.start();
  console.log(`canvas-design-harness listening on http://127.0.0.1:${port}`);
  console.log(`workspace: ${server.registry.workspaces[0].name} (${server.registry.workspaces[0].root})`);
}
