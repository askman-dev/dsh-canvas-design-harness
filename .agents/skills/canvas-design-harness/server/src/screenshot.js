// Model -> SVG screenshot renderer. No browser: the component model is drawn
// directly into a deterministic vector image, so rendering is instant and
// reproducible. Raster PNG can be produced later by a native rasterizer
// (e.g. resvg), never by a headless browser.
// Spec: design_harness_http_mcp

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
function textWidth(text, size) {
  let width = 0;
  for (const ch of String(text ?? '')) width += CJK.test(ch) ? size : size * 0.58;
  return width;
}

function rect(x, y, w, h, fill, rx = 0, stroke) {
  const sw = stroke ? ` stroke="${stroke}" stroke-width="1"` : '';
  const r = rx ? ` rx="${rx}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${r}${sw}/>`;
}

function text(x, y, value, size, fill = '#141a22', weight = 400) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="-apple-system,'PingFang SC',sans-serif">${esc(value)}</text>`;
}

function circle(cx, cy, r, fill) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

const ACCENT = '#5B72CF';
const INK = '#141a22';
const INK_2 = '#667085';
const LINE = '#dce5ef';
const FIELD = '#f8fafc';
const SURFACE = '#ffffff';
const BG = '#f7f9fc';

export function frameToSvg(frame) {
  const W = frame.props.size?.w || 393;
  const H = frame.props.size?.h || 852;
  const parts = [rect(0, 0, W, H, BG), rect(0, 0, W, 44, SURFACE)];
  const ctx = { x: 0, y: 44, w: W, sheetTop: null, sheetX: 0 };

  for (const node of frame.components || []) renderComponent(ctx, parts, node, W, H);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

function renderComponent(ctx, parts, node, W, H) {
  const p = node.props || {};
  const indent = ctx.sheetTop === null ? 0 : 14;
  const left = ctx.x + indent;
  const width = ctx.w - indent * 2;
  switch (node.type) {
    case 'status-bar':
      parts.push(
        text(24, 27, String(p.clock ?? '13:35'), 13, INK, 600),
        text(W - 90, 27, '5G 89', 13, INK, 600),
      );
      ctx.y += 0;
      break;
    case 'backdrop':
      break;
    case 'app-bar':
      parts.push(rect(0, ctx.y, W, 56, SURFACE), text(W / 2, ctx.y + 35, String(p.title ?? ''), 17, INK, 600));
      ctx.y += 56;
      break;
    case 'launch-sheet': {
      const top = ctx.sheetTop === null ? Math.round(H * 0.16) : ctx.y;
      ctx.sheetTop = top;
      ctx.y = top + 14;
      ctx.sheetX = 0;
      parts.push(rect(0, top, W, H - top, '#fafcff', 34));
      for (const child of node.children || []) renderComponent(ctx, parts, child, W, H);
      break;
    }
    case 'sheet-header': {
      const y = ctx.y;
      parts.push(
        rect(left, y, 56, 28, ACCENT, 14),
        text(left + 28 - 12, y + 19, '介绍', 12, '#fff', 600),
        circle(W - 28, y + 14, 13, '#eff3f8'),
        text(W - 32, y + 19, '×', 14, INK_2),
      );
      ctx.y = y + 42;
      break;
    }
    case 'heading':
      parts.push(text(left, ctx.y + 20, String(p.value ?? ''), 18, INK, 800));
      ctx.y += 40;
      break;
    case 'title2':
      parts.push(text(left, ctx.y + 20, String(p.value ?? ''), 20, INK, 800));
      ctx.y += 42;
      break;
    case 'action-row': {
      const y = ctx.y;
      parts.push(rect(left, y, width, 56, SURFACE, 18, LINE));
      parts.push(
        text(left + 14, y + 23, String(p.label ?? ''), 14, INK, 700),
        p.description ? text(left + 14, y + 42, String(p.description), 11, INK_2) : '',
      );
      ctx.y = y + 64;
      break;
    }
    case 'field': {
      const y = ctx.y;
      const h = Math.max(52, Number(p.lines ?? 4) * 26);
      parts.push(rect(left, y, width, h, FIELD, 14, LINE));
      parts.push(text(left + 14, y + 22, String(p.placeholder ?? ''), 14, '#98a2b3'));
      ctx.y = y + h + 12;
      break;
    }
    case 'button': {
      const y = ctx.y;
      parts.push(rect(left, y, width, 52, ACCENT, 14));
      parts.push(text(W / 2 - textWidth(String(p.label ?? ''), 15) / 2, y + 33, String(p.label ?? ''), 15, '#fff', 600));
      ctx.y = y + 66;
      break;
    }
    case 'expand-head': {
      const y = ctx.y;
      parts.push(text(left, y + 18, `‹ ${p.backLabel ?? ''}`, 14, ACCENT, 600));
      const label = p.submitLabel ?? '提交';
      const pillW = textWidth(label, 14) + 34;
      const pillX = W - left - pillW;
      parts.push(rect(pillX, y, pillW, 36, ACCENT, 18));
      parts.push(text(pillX + 17, y + 24, label, 14, '#fff', 600));
      ctx.y = y + 50;
      break;
    }
    case 'dock': {
      const y = ctx.y;
      parts.push(rect(0, y - 1, W, 1, LINE));
      const fieldH = 44;
      parts.push(rect(left, y + 12, width - 96, fieldH, FIELD, 12, LINE));
      parts.push(rect(W - left - 72, y + 12, 72, fieldH, ACCENT, 22));
      parts.push(text(W - left - 36 - 7, y + 38, '提交', 14, '#fff', 600));
      ctx.y = y + fieldH + 18;
      break;
    }
    case 'seg': {
      const y = ctx.y;
      const itemW = (width - 12) / 3;
      parts.push(rect(left, y, width, 40, '#edf0f5', 12));
      for (const item of p.items || []) {
        const i = (p.items || []).indexOf(item);
        const x = left + i * (itemW + 6);
        if (item === p.active) parts.push(rect(x, y + 3, itemW, 34, SURFACE, 9));
        parts.push(text(x + itemW / 2 - textWidth(String(item), 12.5) / 2, y + 25, String(item), 12.5, item === p.active ? ACCENT : INK_2, 600));
      }
      ctx.y = y + 52;
      break;
    }
    case 'dim':
      if (ctx.sheetTop !== null) parts.push(rect(0, ctx.sheetTop, W, H - ctx.sheetTop, 'rgba(20,26,34,0.38)', 34));
      break;
    case 'overlay-sheet': {
      const y = ctx.y;
      parts.push(rect(0, y, W, H - y, SURFACE, 22));
      ctx.y = y + 14;
      ctx.sheetX = 0;
      for (const child of node.children || []) renderComponent(ctx, parts, child, W, H);
      ctx.y = H;
      break;
    }
    case 'keyboard': {
      const y = ctx.y;
      const keyW = (width - 9 * 5) / 10;
      for (let i = 0; i < 10; i += 1) parts.push(rect(left + i * (keyW + 5), y, keyW, 28, SURFACE, 6, '#dfe4eb'));
      parts.push(rect(left, y + 33, width, 28, SURFACE, 6, '#dfe4eb'));
      ctx.y = y + 70;
      break;
    }
    case 'text': {
      const lines = String(p.value ?? '').split('\n');
      for (const line of lines) {
        parts.push(text(left, ctx.y + 16, line, 14, INK_2));
        ctx.y += 24;
      }
      ctx.y += 6;
      break;
    }
    case 'panel': {
      const y = ctx.y;
      parts.push(rect(left, y, width, 40, SURFACE, 14, '#e1e8f0'));
      parts.push(text(left + 16, y + 25, String(p.title ?? ''), 15, INK, 700));
      ctx.y = y + 52;
      for (const child of node.children || []) renderComponent(ctx, parts, child, W, H);
      break;
    }
    case 'process': {
      const y = ctx.y;
      parts.push(rect(left, y, width, 42, '#f7f9fc', 12, '#e3e8ef'));
      parts.push(text(left + 14, y + 27, String(p.label ?? ''), 13, INK_2, 600));
      ctx.y = y + 52;
      break;
    }
    case 'anchor': {
      const y = ctx.y;
      parts.push(rect(left, y, width, 46, SURFACE, 14, '#e1e8f0'));
      parts.push(text(left + 16, y + 22, String(p.word ?? ''), 15, INK, 700));
      if (p.pronunciation) parts.push(text(left + 16 + textWidth(p.word, 15) + 10, y + 22, String(p.pronunciation), 12, '#5b72cf', 700));
      ctx.y = y + 56;
      if (p.coreMeaning) {
        parts.push(text(left, ctx.y + 18, String(p.coreMeaning), 15, INK, 700));
        ctx.y += 30;
      }
      const hookH = 54;
      parts.push(rect(left, ctx.y, width, hookH, '#f0f2ff', 16, '#e5d9b8'));
      parts.push(text(left + 14, ctx.y + 22, String(p.memoryHook ?? '').slice(0, 34), 13, INK_2));
      ctx.y += hookH + 14;
      for (const option of p.options || []) {
        parts.push(rect(left, ctx.y, width, 40, SURFACE, 20, LINE));
        parts.push(text(left + width / 2 - textWidth(String(option), 14) / 2, ctx.y + 27, String(option), 14, INK_2, 600));
        ctx.y += 48;
      }
      break;
    }
    case 'section': {
      if (p.title) {
        parts.push(text(left, ctx.y + 20, String(p.title), 18, INK, 800));
        ctx.y += 30;
      }
      for (const child of node.children || []) renderComponent(ctx, parts, child, W, H);
      break;
    }
    case 'figjam-sticky': {
      const y = ctx.y;
      const w = Math.min(220, width);
      const title = String(p.title ?? '');
      const h = 46 + (p.text ? 20 : 0);
      parts.push(rect(left, y, w, h, '#fff3c4', 12, '#e9d87f'));
      parts.push(text(left + 12, y + 22, title, 13, '#5c4e1e', 700));
      if (p.text) parts.push(text(left + 12, y + 40, String(p.text), 11, '#8a7a3e'));
      ctx.y = y + h + 10;
      break;
    }
    case 'connector':
      parts.push(`<line x1="${W * 0.4}" y1="${ctx.y}" x2="${W * 0.62}" y2="${ctx.y}" stroke="#b9a95f" stroke-width="2"/>`);
      break;
    default:
      break;
  }
}

export function screenshotDocument(doc, { frameId } = {}) {
  let frames = [];
  for (const page of doc.pages) {
    for (const frame of page.frames) {
      if (!frameId || frame.id === frameId) frames.push({ page, frame });
    }
  }
  if (frames.length === 0) throw new Error('no frames to screenshot');
  const gap = 24;
  const maxW = Math.max(...frames.map((f) => f.frame.props.size.w || 393));
  const totalH = frames.reduce((sum, f) => sum + (f.frame.props.size.h || 852) + gap, gap);
  const group = frames
    .map(({ frame }, index) => {
      const x = (maxW - (frame.props.size.w || 393)) / 2;
      const y = gap + index * ((frame.props.size.h || 852) + gap);
      const svg = frameToSvg(frame).replace(/^<svg[^>]*>|<\/svg>$/g, '');
      return `<g transform="translate(${x} ${y})">${svg}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${totalH}" width="${maxW}" height="${totalH}">${group}</svg>`;
}
