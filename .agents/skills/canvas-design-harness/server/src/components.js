// Framework component registry: schemas + deterministic HTML rendering.
// Every node carries data-cf-id / data-cf-type and its props as data-*
// attributes on the root element; the visual children are generated chrome.
// Specs: design_harness_html_document, design_harness_http_mcp

export const schemas = {
  'status-bar': { props: { clock: 'string', battery: 'number' }, children: false },
  'app-bar': { props: { title: 'string', back: 'boolean' }, children: false },
  'backdrop': { props: {}, children: false },
  'text': { props: { value: 'string' }, children: false },
  'panel': { props: { title: 'string' }, children: true },
  'process': { props: { label: 'string' }, children: false },
  'anchor': {
    props: {
      word: 'string',
      pronunciation: 'string',
      coreMeaning: 'string',
      memoryHook: 'string',
      feedback: 'boolean',
      options: 'array',
      response: 'string',
    },
    children: false,
  },
  'action-row': { props: { label: 'string', description: 'string', icon: 'string', selected: 'boolean' }, children: false },
  'field': { props: { placeholder: 'string', value: 'string', lines: 'number' }, children: false },
  'button': { props: { label: 'string', variant: 'string' }, children: false },
  'heading': { props: { value: 'string' }, children: false },
  'title2': { props: { value: 'string' }, children: false },
  'sheet-header': { props: { backLabel: 'string', introActive: 'boolean' }, children: false },
  'expand-head': { props: { backLabel: 'string', submitLabel: 'string' }, children: false },
  'dock': { props: { submitLabel: 'string' }, children: true },
  'seg': { props: { items: 'array', active: 'string' }, children: false },
  'dim': { props: {}, children: false },
  'overlay-sheet': { props: {}, children: true },
  'keyboard': { props: {}, children: false },
  'section': { props: { title: 'string', kind: 'string' }, children: true },
  'launch-sheet': { props: { accent: 'string', state: 'string', title: 'string' }, children: true },
  'figjam-sticky': { props: { title: 'string', text: 'string' }, children: false },
  'connector': { props: { fromId: 'string', toId: 'string' }, children: false },
};

export const FRAME_TYPES = new Set(['page', 'frame']);

export function validateType(type) {
  if (FRAME_TYPES.has(type)) return null;
  return schemas[type] ? null : `unknown node type: ${type}`;
}

export function validateProps(type, props) {
  if (FRAME_TYPES.has(type)) return null;
  const schema = schemas[type];
  if (!schema) return `unknown node type: ${type}`;
  for (const key of Object.keys(props || {})) {
    if (key === 'state') continue; // state is a generic node attribute
    const kind = schema.props[key];
    if (!kind) return `unknown prop for ${type}: ${key}`;
    const value = props[key];
    if (kind === 'string' && typeof value !== 'string') return `prop ${key} must be a string`;
    if (kind === 'number' && typeof value !== 'number') return `prop ${key} must be a number`;
    if (kind === 'boolean' && typeof value !== 'boolean') return `prop ${key} must be a boolean`;
    if (kind === 'array' && !Array.isArray(value)) return `prop ${key} must be an array`;
  }
  return null;
}

export function canHaveChildren(type) {
  if (FRAME_TYPES.has(type)) return true;
  return Boolean(schemas[type]?.children);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dataAttrs(props, order) {
  const keys = [...new Set([...order, ...Object.keys(props).sort()])];
  return keys
    .filter((key) => props[key] !== undefined)
    .map((key) => {
      const value = props[key];
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `data-${key}="${esc(text)}"`;
    })
    .join(' ');
}

function renderChildren(node) {
  return (node.children || [])
    .map((child) => renderNode(child))
    .join('\n');
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4-4 3 3 4-4 3 3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19l1-4L17 4l3 3L9 18l-4 1z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h16"/><path d="M14 6l6 6-6 6"/></svg>',
};

function icon(name) {
  const key = ICONS[name] ? name : 'edit';
  return `<span class="cf-ico">${ICONS[key]}</span>`;
}

// Renders one component node (not page/frame, which are handled by html.js).
export function renderNode(node) {
  const { id, type, props = {} } = node;
  const attrs = `data-cf-id="${id}" data-cf-type="${type}" ${dataAttrs(props, ['label', 'title', 'value', 'placeholder', 'state'])}`;
  switch (type) {
    case 'status-bar':
      return `<div class="cf-status" ${attrs}><span>${esc(props.clock ?? '13:35')}</span><span class="cf-status-right"><span>5G</span><span class="cf-batt"><i></i></span><span>${esc(String(props.battery ?? 89))}</span></span></div>`;
    case 'app-bar':
      return `<div class="cf-appbar" ${attrs}>${props.back ? '<span class="cf-back">' + icon('back') + '</span>' : ''}${esc(props.title ?? '')}</div>`;
    case 'backdrop':
      return `<div class="cf-backdrop" ${attrs}></div>`;
    case 'text':
      return `<div class="cf-tl-body" ${attrs}>${esc(props.value ?? '')}</div>`;
    case 'panel':
      return `<div class="cf-src-block" ${attrs}>${props.title ? `<div class="cf-src-title">${esc(props.title)}</div>` : ''}${renderChildren(node)}</div>`;
    case 'process':
      return `<div class="cf-process" ${attrs}>${icon('check')}<span>${esc(props.label ?? '')}</span><span class="cf-chev">${icon('chev')}</span></div>`;
    case 'anchor': {
      const title = props.feedback ? `${props.word} · 回忆反馈` : (props.word ?? '');
      const options = (props.options || [])
        .map((option) => `<button class="cf-choice">${esc(option)}</button>`)
        .join('');
      const resolved = props.response
        ? `<div class="cf-anchor-resolved">你的回答：${esc(props.response)}</div>`
        : '';
      return `<div class="cf-panel cf-anchor" ${attrs}><div class="cf-tl-head"><div class="cf-tl-title">${esc(title)}</div>${props.pronunciation ? `<span class="cf-chip cf-pron">${esc(props.pronunciation)}</span>` : ''}</div>${props.coreMeaning ? `<div class="cf-anchor-meaning">${esc(props.coreMeaning)}</div>` : ''}<div class="cf-anchor-hook">${esc(props.memoryHook ?? '')}</div>${options ? `<div class="cf-choices">${options}</div>` : ''}${resolved}</div>`;
    }
    case 'action-row':
      return `<div class="cf-action${props.selected ? ' is-selected' : ''}" ${attrs}><span class="cf-action-ico">${icon(props.icon)}</span><div><b>${esc(props.label ?? '')}</b>${props.description ? `<span>${esc(props.description)}</span>` : ''}</div><span class="cf-chev">${icon('chev')}</span></div>`;
    case 'field':
      return `<textarea class="cf-ls-field" ${attrs} placeholder="${esc(props.placeholder ?? '')}">${esc(props.value ?? '')}</textarea>`;
    case 'button': {
      const cls =
        props.variant === 'primary'
          ? 'cf-ls-submit'
          : props.variant === 'choice'
            ? 'cf-choice'
            : `cf-ls-toggle${props.active ? ' is-active' : ''}`;
      return `<button class="${cls}" ${attrs}>${esc(props.label ?? '')}</button>`;
    }
    case 'heading':
      return `<div class="cf-start" ${attrs}>${esc(props.value ?? '')}</div>`;
    case 'title2':
      return `<div class="cf-ls-title2" ${attrs}>${esc(props.value ?? '')}</div>`;
    case 'sheet-header': {
      const back = props.backLabel ? `<button class="cf-ls-back">${icon('back')}${esc(props.backLabel)}</button>` : '';
      return `<div class="cf-ls-header" ${attrs}>${back}<button class="cf-ls-toggle${props.introActive ? ' is-active' : ''}">介绍</button><button class="cf-close">${icon('close')}</button></div>`;
    }
    case 'expand-head':
      return `<div class="cf-ls-expand-head" ${attrs}><button class="cf-ls-back">${icon('back')}${esc(props.backLabel ?? '')}</button><button class="cf-ls-submit">${esc(props.submitLabel ?? '提交')}</button></div>`;
    case 'dock':
      return `<div class="cf-dock" ${attrs}>${icon('back')}${renderChildren(node)}<button class="cf-ls-submit">${esc(props.submitLabel ?? '提交')}</button></div>`;
    case 'seg': {
      const items = (props.items || []).map((item) => `<button class="cf-seg-item${item === props.active ? ' is-active' : ''}">${esc(item)}</button>`).join('');
      return `<div class="cf-seg" ${attrs}>${items}</div>`;
    }
    case 'dim':
      return `<div class="cf-dim" ${attrs}></div>`;
    case 'overlay-sheet':
      return `<div class="cf-overlay-sheet" ${attrs}>${renderChildren(node)}</div>`;
    case 'keyboard':
      return `<div class="cf-keyboard" ${attrs}>${'<i></i>'.repeat(10)}<span class="cf-kb-space"></span></div>`;
    case 'section':
      return `<div class="cf-ls-intro" ${attrs}>${props.title ? `<div class="cf-launch-title">${esc(props.title)}</div>` : ''}${renderChildren(node)}</div>`;
    case 'launch-sheet': {
      const accent = props.accent || '#5B72CF';
      const state = props.state || 'list';
      return `<div class="cf-sheet cf-ls" ${attrs} style="--cf-accent:${accent};--cf-accent-soft:#EDF0FF;--cf-math:${accent};--cf-primary:${accent}"><div class="cf-ls-state is-active" data-ls-state="${esc(state)}"><div class="cf-drag"></div>${props.title ? `<div class="cf-launch-title">${esc(props.title)}</div>` : ''}${renderChildren(node)}</div></div>`;
    }
    case 'figjam-sticky':
      return `<div class="cf-jam-sticky" ${attrs}><b>${esc(props.title ?? '')}</b>${props.text ? `<span>${esc(props.text)}</span>` : ''}</div>`;
    case 'connector':
      return `<span class="cf-jam-arrow" ${attrs}>${icon('arrow')}</span>`;
    default:
      return `<div class="cf-unsupported" ${attrs}>unsupported: ${esc(type)}</div>`;
  }
}
