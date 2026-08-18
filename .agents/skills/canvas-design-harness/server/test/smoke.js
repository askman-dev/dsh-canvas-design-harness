// Specs: design_harness_singleton_service, design_harness_http_mcp,
//        design_harness_html_document
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9399 + Math.floor(Math.random() * 100);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-smoke-'));
fs.writeFileSync(path.join(TMP, 'placeholder.html'), '<!doctype html><title>placeholder</title>', 'utf8');

async function json(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function waitReady(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready');
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', args);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`))));
  });
}

const child = spawn('node', [path.join(ROOT, 'src/index.js'), TMP, '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => (bootLog += d));
child.stderr.on('data', (d) => (bootLog += d));

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push(`PASS ${name}`);
  } catch (error) {
    checks.push(`FAIL ${name}: ${error.message}`);
  }
}

try {
  await waitReady(PORT);
  const BASE = `http://127.0.0.1:${PORT}`;
  const call = (name, args) =>
    json('POST', `${BASE}/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

  let workspaceId;
  let fileId;
  await check('register workspace', async () => {
    const ws = await json('POST', `${BASE}/workspaces`, { root: TMP });
    workspaceId = ws.data.id;
    if (!workspaceId) throw new Error('no workspace id');
    const listed = await call('workspace.list', {});
    const files = JSON.parse(listed.data.result.content[0].text).workspaces;
    if (!files.some((item) => item.id === workspaceId)) throw new Error('workspace.list failed');
    const listedFiles = await call('workspace.listFiles', { workspaceId });
    if (!Array.isArray(JSON.parse(listedFiles.data.result.content[0].text).files)) throw new Error('workspace.listFiles failed');
  });

  await check('create_file writes a browser-ready html', async () => {
    const r = await call('document.createFile', { workspaceId, name: 'demo' });
    fileId = JSON.parse(r.data.result.content[0].text).fileId;
    const html = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (!html.includes('<!doctype html>') || !html.includes('canvas-frames-demo')) {
      throw new Error('file not browser-ready');
    }
  });

  await check('create_file rejects traversal and absolute names', async () => {
    for (const name of ['../escape', '/tmp/escape', 'nested/file']) {
      const r = await call('document.createFile', { workspaceId, name });
      if (!String(r.data.error?.message || '').includes('direct child')) throw new Error(`accepted ${name}`);
    }
  });

  let pageId;
  let frameId;
  let nodeId;
  let buttonId;
  await check('create_page / create_frame / add_component', async () => {
    pageId = JSON.parse((await call('document.createPage', { fileId, name: 'P1' })).data.result.content[0].text).pageId;
    frameId = JSON.parse((await call('page.createFrame', { fileId, pageId, name: 'F1' })).data.result.content[0].text).frameId;
    nodeId = JSON.parse(
      (await call('frame.addComponent', { fileId, frameId, type: 'action-row', props: { label: '拍下单词表' } })).data.result.content[0].text,
    ).nodeId;
    buttonId = JSON.parse(
      (await call('frame.addComponent', { fileId, frameId, type: 'button', props: { label: '开始', variant: 'toggle' } })).data.result.content[0].text,
    ).nodeId;
    if (!pageId || !frameId || !nodeId) throw new Error('missing ids');
  });

  await check('invalid writes are rejected and leave the file untouched', async () => {
    const before = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    const bad1 = await call('frame.addComponent', { fileId, frameId, type: 'not-a-type' });
    const bad2 = await call('node.setProps', { fileId, nodeId, props: { nope: 1 } });
    if (!String(bad1.data.error?.message || '').includes('unknown node type')) throw new Error('type not rejected');
    if (!String(bad2.data.error?.message || '').includes('unknown prop')) throw new Error('props not rejected');
    const after = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (before !== after) throw new Error('file changed after rejected writes');
  });

  await check('get_document parses the html back', async () => {
    const r = await call('document.getDocument', { fileId });
    const doc = JSON.parse(r.data.result.content[0].text);
    if (doc.document.pages.length !== 1) throw new Error('expected one page');
    const page = doc.document.pages.find((p) => p.frames.length === 1);
    if (!page) throw new Error('page with frame missing');
    const frame = page.frames[0];
    if (!frame.components.some((c) => c.id === nodeId && c.type === 'action-row')) {
      throw new Error('component not found');
    }
  });

  await check('round-trip is deterministic', async () => {
    const a = await call('document.getDocument', { fileId });
    const b = await call('document.getDocument', { fileId });
    if (a.data.result.content[0].text !== b.data.result.content[0].text) throw new Error('get_document not stable');
  });

  await check('get_screenshot renders svg without a browser', async () => {
    const r = await call('node.getScreenshot', { fileId });
    const result = JSON.parse(r.data.result.content[0].text);
    if (result.format !== 'svg' || !result.svg.startsWith('<svg')) throw new Error('not svg');
    if (!result.svg.includes('拍下单词表')) throw new Error('svg missing component text');
  });

  await check('set_props / set_state persist into the html', async () => {
    await call('node.setProps', { fileId, nodeId, props: { label: '从相簿选择' } });
    await call('node.setProps', { fileId, nodeId: buttonId, props: { active: true } });
    await call('node.setState', { fileId, nodeId, state: 'input' });
    const html = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (!html.includes('data-label="从相簿选择"') || !html.includes('data-active="true"') || !html.includes('data-state="input"')) {
      throw new Error('props/state not persisted');
    }
  });

  await check('old aliases still work', async () => {
    const r = await call('set_props', { fileId, nodeId, props: { description: '别名可用' } });
    if (!r.data.result.content[0].text.includes('mutatedIds')) throw new Error('alias failed');
  });

  await check('selection only exists inside batch (stateless calls)', async () => {
    const r = await call('document.selectFrame', { fileId, frameId });
    if (!String(r.data.error?.message || '').includes('only valid inside batch')) {
      throw new Error('selectFrame should be batch-only');
    }
  });

  await check('batch selection mirrors figma currentPage', async () => {
    const r = await call('batch', {
      fileId,
      operations: [
        { tool: 'document.selectFrame', arguments: { frameId } },
        { tool: 'frame.addComponent', arguments: { type: 'heading', props: { value: '上下文命中' } } },
      ],
    });
    const added = JSON.parse(r.data.result.content[0].text).results[1].nodeId;
    if (!added) throw new Error('no node from batch selection');
    const doc = JSON.parse((await call('document.getDocument', { fileId })).data.result.content[0].text);
    const page = doc.document.pages.find((p) => p.frames.some((f) => f.id === frameId));
    const frame = page.frames.find((f) => f.id === frameId);
    if (!frame.components.some((c) => c.id === added)) throw new Error('batch selection add failed');
  });

  await check('batch applies multiple operations in one atomic write', async () => {
    const r = await call('batch', {
      fileId,
      operations: [
        { tool: 'node.setProps', arguments: { nodeId, props: { label: '批量修改' } } },
        { tool: 'node.setState', arguments: { nodeId, state: 'batch' } },
      ],
    });
    if (!r.data.result.content[0].text.includes('"count":2')) throw new Error('batch count mismatch');
    const html = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (!html.includes('data-label="批量修改"') || !html.includes('data-state="batch"')) {
      throw new Error('batch not persisted');
    }
  });

  await check('batch failure is atomic (file untouched)', async () => {
    const before = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    const r = await call('batch', {
      fileId,
      operations: [
        { tool: 'node.setProps', arguments: { nodeId, props: { label: '不应生效' } } },
        { tool: 'frame.addComponent', arguments: { frameId, type: 'not-a-type' } },
      ],
    });
    if (!String(r.data.error?.message || '').includes('unknown node type')) {
      throw new Error('batch should reject invalid op');
    }
    const after = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (before !== after) throw new Error('batch failed but file changed');
  });

  await check('duplicate data-cf-id is rejected and file untouched', async () => {
    const htmlPath = path.join(TMP, 'demo.html');
    const before = fs.readFileSync(htmlPath, 'utf8');
    const corrupt = before.replace('data-cf-id="' + nodeId + '"', 'data-cf-id="' + nodeId + '" data-cf-id="' + nodeId + '"');
    fs.writeFileSync(htmlPath, corrupt, 'utf8');
    const r = await call('document.getDocument', { fileId });
    fs.writeFileSync(htmlPath, before, 'utf8');
    if (!String(r.data.error?.message || '').includes('duplicate')) {
      throw new Error('duplicate id not rejected');
    }
  });

  await check('validate reports structure', async () => {
    const r = await call('document.validate', { fileId });
    const result = JSON.parse(r.data.result.content[0].text);
    if (!result.ok || result.pages !== 1 || result.frames !== 1) throw new Error('validate mismatch');
  });

  await check('home page lists file and viewer serves it', async () => {
    const home = await (await fetch(`${BASE}/`)).text();
    if (!home.includes('demo.html')) throw new Error('home missing file');
    const viewer = await fetch(`${BASE}/open?file=${fileId}`);
    const html = await viewer.text();
    if (!html.includes('canvas-frames-demo') || !html.includes("new EventSource('/events?fileId=")) throw new Error('viewer missing canvas live reload');
  });

  await check('read-only batch does not rewrite the file', async () => {
    const before = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    await call('batch', { fileId, operations: [{ tool: 'document.getDocument', arguments: {} }] });
    const after = fs.readFileSync(path.join(TMP, 'demo.html'), 'utf8');
    if (before !== after) throw new Error('read-only batch rewrote the file');
  });

  await check('second CLI reuses singleton', async () => {
    const out = await runNode([path.join(ROOT, 'src/index.js'), TMP, '--port', String(PORT)]);
    if (!out.includes('reused harness')) throw new Error(`expected reuse, got: ${out}`);
  });

  // ---- external capability contract (specs/external_capabilities.yaml) ----

  await check('GET /workspaces returns JSON with file metadata', async () => {
    const res = await fetch(`${BASE}/workspaces`);
    const body = await res.json();
    const ws = body.workspaces.find((item) => item.root === TMP);
    if (!ws) throw new Error('workspace missing');
    const file = ws.files.find((item) => item.name === 'demo.html');
    if (!file) throw new Error('demo.html missing from metadata');
    for (const key of ['id', 'relPath', 'pageCount', 'frameCount', 'updatedAt', 'workspaceId']) {
      if (!(key in file)) throw new Error(`metadata field missing: ${key}`);
    }
    if (file.pageCount < 1 || file.frameCount < 1) throw new Error(`bad counts: ${file.pageCount}/${file.frameCount}`);
    if (typeof file.updatedAt !== 'number') throw new Error('updatedAt not a number');
    if (file.relPath !== 'demo.html') throw new Error(`bad relPath: ${file.relPath}`);
    if (file.workspaceId !== workspaceId) throw new Error('workspaceId mismatch');
  });

  await check('GET / with Accept: application/json serves JSON', async () => {
    const res = await fetch(`${BASE}/`, { headers: { accept: 'application/json' } });
    const body = await res.json();
    if (!Array.isArray(body.workspaces)) throw new Error('expected workspaces JSON');
  });

  await check('file ids are stable across workspace re-scans', async () => {
    const before = (await json('POST', `${BASE}/workspaces`, { root: TMP })).data.files.find((f) => f.name === 'demo.html').id;
    const after = (await json('POST', `${BASE}/workspaces`, { root: TMP })).data.files.find((f) => f.name === 'demo.html').id;
    if (before !== after || before !== fileId) throw new Error(`unstable id: ${before} vs ${after} vs ${fileId}`);
  });

  await check('SSE frames carry JSON { workspaceId, fileId, action, updatedAt }', async () => {
    const controller = new AbortController();
    const streamPromise = (async () => {
      const res = await fetch(`${BASE}/events?fileId=${fileId}`, { signal: controller.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frame = /event: updated\ndata: (.+)\n\n/.exec(buffer);
        if (frame) return JSON.parse(frame[1]);
      }
      return null;
    })();
    await new Promise((r) => setTimeout(r, 200));
    await call('node.setProps', { fileId, nodeId, props: { description: 'sse-ping' } });
    const event = await streamPromise;
    controller.abort();
    if (!event || event.action !== 'update' || event.fileId !== fileId || event.workspaceId !== workspaceId) {
      throw new Error(`bad event: ${JSON.stringify(event)}`);
    }
    if (typeof event.updatedAt !== 'number') throw new Error('updatedAt missing');
  });

  await check('viewer bridge payload contract (buildNodeSelectedPayload)', async () => {
    const source = fs.readFileSync(path.join(ROOT, '..', 'reference', 'canvas-frames.js'), 'utf8');
    const start = source.indexOf('/* #cf-node-selected-payload-start');
    const end = source.indexOf('/* #cf-node-selected-payload-end');
    if (start < 0 || end < 0) throw new Error('bridge markers missing');
    const fnSource = source.slice(source.indexOf('function buildNodeSelectedPayload', start), source.lastIndexOf('}', end) + 1);
    const buildNodeSelectedPayload = new Function(`return (${fnSource});`)();
    const empty = buildNodeSelectedPayload({});
    if (empty.source !== 'canvas-design-harness' || empty.type !== 'node:selected') throw new Error('envelope wrong');
    if (empty.payload.nodeId !== null || empty.payload.nodeType !== 'frame') throw new Error('defaults wrong');
    const full = buildNodeSelectedPayload({
      fileId: 'file_abc',
      pageId: 'p1',
      nodeId: 'n1',
      nodeType: 'button',
      nodeLabel: '登录',
      rect: { x: 1, y: 2, width: 393, height: 852 },
    });
    if (full.payload.nodeLabel !== '登录' || full.payload.rect.width !== 393) throw new Error('payload fields wrong');
    if (full.payload.fileId !== 'file_abc' || full.payload.pageId !== 'p1') throw new Error('ids wrong');
  });

  console.log(checks.join('\n'));
  const failed = checks.filter((line) => line.startsWith('FAIL')).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error('smoke aborted:', error.message);
  console.log(bootLog);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => fs.rmSync(TMP, { recursive: true, force: true }), 200);
}
