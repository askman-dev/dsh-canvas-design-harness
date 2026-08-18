// client/design-view.js — BROWSER half of the DSH canvas wrapper (方案 A tabs).
//
// This file runs as the BODY of an async function whose parameters are the
// dynamic-package symbol surface (React, console, styles, host, ...): NO
// imports, NO module syntax, NO fetch/setTimeout (both are trapped and must
// go through the host half). It implements, inside the DSH web GUI:
//   - the persistent `🗂️ 设计大厅` tab (conversation.view slot, order 20),
//   - one dynamic `🎨 <file>.html ✕` tab per opened design (order 21+),
//   - the gallery grid, the embedded canvas iframe (/open?file=...),
//   - the postMessage click-to-ask bridge into the composer draft.
//
// The tiny helpers below are INLINED from client/logic.js (the browser half
// cannot import; logic.js is the canonical copy unit-tested in Part D — keep
// them in sync). The host half must expose these harness.handle RPCs backed
// by ctx.canvasHarness + sessions (see client/README.md):
//   designsDirForSession({ sessionId }) -> string     (designs dir)
//   listDesigns({ root })               -> DesignFile[]
//   openUrl({ fileId })                 -> string     (viewer URL)
//   setDraft({ sessionId, text })       -> void       (composer draft)
//   subscribe({ fileId }, onEvent)      -> unsubscribe (SSE)
const { useState, useEffect, createElement: h } = React;

// --- inlined from client/logic.js (keep in sync; Part D tests logic.js) ---
function designTabLabel(name) {
  return String(name ?? "design").replace(/\.html$/i, "");
}
function draftForNodeSelected(payload) {
  const label = payload.nodeLabel ? `「${payload.nodeLabel}」` : "";
  const id = payload.nodeId ? ` (ID: ${payload.nodeId})` : "";
  const kind = payload.nodeType && payload.nodeType !== "frame" ? `(${payload.nodeType})` : "";
  return `请修改设计稿中的${kind}节点${label}${id}：`;
}

function GalleryView({ root, onOpenFile }) {
  const [files, setFiles] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!root) return undefined;
    host
      .call("listDesigns", { root })
      .then((list) => alive && setFiles(Array.isArray(list) ? list : []))
      .catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
  }, [root]);
  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12,
    padding: 16,
    overflow: "auto",
    height: "100%",
  };
  const card = {
    border: "1px solid var(--dsw-alias-border-l2, #e1e8f0)",
    borderRadius: 12,
    padding: 12,
    cursor: "pointer",
    background: "var(--dsw-alias-bg-base, #fff)",
    textAlign: "left",
  };
  const titleStyle = { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #141a22)" };
  const metaStyle = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #667085)", marginTop: 4 };
  if (!root) return h("div", { style: { padding: 16, color: "#98a2b3" } }, "加载工作区…");
  if (files === null) return h("div", { style: { padding: 16, color: "#98a2b3" } }, "加载设计中…");
  if (files.length === 0) {
    return h("div", { style: { padding: 16, color: "#98a2b3" } }, `该目录下没有设计稿: ${root}`);
  }
  return h(
    "div",
    { style: grid },
    files.map((f) =>
      h(
        "button",
        { key: f.id, style: card, onClick: () => onOpenFile(f), title: f.relPath ?? f.name },
        h("div", { style: titleStyle }, f.name),
        h("div", { style: metaStyle }, `${f.pageCount ?? 0} 页 · ${f.frameCount ?? 0} 帧`),
      ),
    ),
  );
}

function CanvasView(props) {
  const { fileId, fileName, sessionId } = props;
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    host
      .call("openUrl", { fileId })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [fileId]);
  useEffect(() => {
    function onMessage(event) {
      const msg = event.data;
      if (!msg || msg.source !== "canvas-design-harness" || msg.type !== "node:selected") return;
      if (!msg.payload || !msg.payload.nodeId) return;
      host.call("setDraft", { sessionId, text: draftForNodeSelected(msg.payload) }).catch(() => {});
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fileId, sessionId]);
  return h(
    "div",
    { style: { width: "100%", height: "100%", display: "flex", flexDirection: "column" } },
    h("iframe", { src, title: fileName, style: { flex: 1, width: "100%", border: "none", background: "#f7f9fc" } }),
  );
}

// Per-session open file tabs: `${sessionId}|${fileId}` -> { dispose }.
const openTabs = new Map();

function openFileTab(ctx, actions, sessionId, file) {
  const key = `${sessionId}|${file.id}`;
  const tabId = "design:file:" + file.id;
  if (openTabs.has(key)) {
    actions.setView(tabId);
    return;
  }
  const dispose = ctx.slots.register(
    {
      name: "conversation.view",
      id: tabId,
      order: 21,
      label: () =>
        h(
          "span",
          { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
          h("span", null, "🎨 " + designTabLabel(file.name)),
          h(
            "button",
            {
              style: { border: "none", background: "none", cursor: "pointer", opacity: 0.6 },
              onClick: (e) => {
                e.stopPropagation();
                dispose();
                openTabs.delete(key);
                actions.setView("design:gallery");
              },
              "aria-label": "关闭 " + file.name,
            },
            "✕",
          ),
        ),
    },
    (viewProps) => h(CanvasView, Object.assign({}, viewProps, { fileId: file.id, fileName: file.name })),
  );
  openTabs.set(key, { dispose });
  actions.setView(tabId);
}

return {
  inject: ["slots", "sessions"],
  apply(ctx) {
    ctx.slots.inject("conversation.view", () =>
      ctx.slots.register(
        {
          name: "conversation.view",
          id: "design:gallery",
          order: 20,
          label: () => "🗂️ 设计大厅",
        },
        (props) => {
          const { sessionId, useSession, actions } = props;
          const sessionCwd = useSession ? useSession((s) => (s.header ? s.header.cwd : s.cwd)) : null;
          const [root, setRoot] = useState(null);
          useEffect(() => {
            let alive = true;
            host
              .call("designsDirForSession", { sessionId, cwd: sessionCwd })
              .then((dir) => alive && setRoot(dir))
              .catch(() => {});
            return () => {
              alive = false;
            };
          }, [sessionId, sessionCwd]);
          return h(GalleryView, { root, onOpenFile: (file) => openFileTab(ctx, actions, sessionId, file) });
        },
      ),
    );
  },
};
