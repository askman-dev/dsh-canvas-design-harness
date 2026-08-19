# dsh-canvas-design-harness

DeepSeek Harness 的**可视化画布设计插件**与**双规格 Skill 包**。

为 DeepSeek Harness Web GUI 提供「设计大厅」多画板交互界面，同时支持在 Codex / Claude Code / 独立终端中作为通用 Skill 零依赖运行。

---

## 🌟 核心特性

- **🖼️ Web GUI「设计大厅」**：在 DSH 会话标签页中提供原生设计画廊，直观浏览工作区 `docs/designs/` 下的 HTML 多画板设计稿。
- **💬 对话即设计**：在会话中直接向 Agent 描述产品界面需求，Agent 自动调用 `canvas_harness_*` 工具在工作区生成、排版与修改设计稿。
- **🔄 守护进程与实时预览**：内置轻量级 HTTP-MCP 守护进程（`127.0.0.1:9321`），支持 iframe 画布预览、MCP 结构化修改与 SSE 热重载。
- **🌐 原生双语支持**：接入 DSH `ctx.locale` 服务，提供完整的中文与英文自适应界面。
- **🔌 双规格支持 (Dual-Spec)**：
  - **DeepSeek Harness 插件**：通过 `dsh.bundle.patch` 与 `dsh.client` 深度接入 DSH 宿主与前端；
  - **Codex / Claude Code Skill**：单例引擎位于 `.agents/skills/canvas-design-harness`，可无缝脱离 DSH 独立使用。

---

## 🚀 快速开始

### 1. 安装到 DeepSeek Harness

```sh
# 添加为 DSH 插件
dsh plugin --profile web add /path/to/dsh-canvas-design-harness

# 在普通终端重启 Web profile
python3 scripts/restart-web.py
```

刷新浏览器页面（`http://127.0.0.1:3080`），即可在会话右上角看到「**设计大厅**」Tab。

### 2. 使用方法

1. **通过对话生成设计稿**：在会话中对 Agent 描述需求，例如：
   > *“帮我设计一个用户登录与注册界面的设计稿”*
2. **在设计大厅查看**：Agent 将自动在当前工作区的 `docs/designs/` 目录下生成 `.html` 设计稿，点击「设计大厅」即可看到卡片列表。
3. **进入画布**：点击任意设计稿卡片即可在全屏内嵌画布中查看 Figma 级多画板排版。

---

## 🏗️ 仓库结构

```
dsh-canvas-design-harness/
├── .agents/skills/canvas-design-harness/   # 标准 Skill 引擎 (与 upstream 同步)
│   ├── SKILL.md       # 技能指令规范
│   ├── reference/     # 画布样式与交互脚本 (canvas-frames.css / canvas-frames.js)
│   ├── server/        # 零依赖 HTTP-MCP 守护进程
│   └── specs/         # 协议规范 (design_harness.yaml / external_capabilities.yaml)
├── client/            # DSH Web 前端模块
│   ├── design-view.js # 前端组件源码 (React + DSH 原生 locale)
│   ├── bundle.js      # 构建后的 classic-script bundle
│   └── logic.js       # 纯逻辑与测试辅助
├── host/              # 宿主工具桥接
│   ├── tools.js       # 原生模型工具定义 (canvas_harness_*)
│   └── tools-entry.js # DSH tools 注入入口
├── scripts/           # 构建、验收与维护工具
│   ├── build-client.mjs  # 客户端 bundle 打包脚本
│   ├── restart-web.py    # 宿主安全的守护化重启脚本
│   ├── verify-web.mjs    # 针对实时 GUI 的自动化验收脚本
│   └── sync-from-upstream.sh # 上游技能引擎同步脚本
├── plugin.js          # DSH 插件入口 (技能注册、daemon 调度、/canvas/* 路由)
├── package.json       # 插件清单 (声明 dsh.bundle.patch 与 dsh.client)
├── cordis.patch.yml   # Cordis profile 补丁声明
└── test/smoke.mjs     # 42 项离线集成测试套件 (Parts A~F)
```

---

## 🛠️ 宿主能力与工具清单

插件通过 `ctx.canvasHarness` 与 `ctx.tools` 注册了以下模型工具（统一以 `root` + `name` 寻址）：

| 工具名称 | 功能说明 | 对应 MCP 方法 |
|---|---|---|
| `canvas_harness_ensure_workspace` | 探测/启动守护进程并注册工作区 | `POST /workspaces` |
| `canvas_harness_list_designs` | 列出工作区目录下的所有设计稿 | `workspace.listFiles` |
| `canvas_harness_create_design` | 在工作区新建设计稿 HTML | `document.createFile` |
| `canvas_harness_get_document` | 读取并解析设计稿的节点树 | `document.getDocument` |
| `canvas_harness_batch` | 原子执行一组页面/画板/组件操作 | `batch` |
| `canvas_harness_validate` | 校验设计稿结构与规范 | `document.validate` |
| `canvas_harness_screenshot` | 无浏览器渲染为 SVG 图片 | `node.getScreenshot` |
| `canvas_harness_mcp_call` | 原始 MCP JSON-RPC 调用逃生口 | `tools/call` |

---

## 💻 开发者与验收指南

修改代码后，请按以下三步标准流程进行验收：

```sh
# 1. 重新构建客户端 Bundle
npm run build:client

# 2. 运行 42 项离线测试套件 (A 技能 / B 发现 / C 工具 / D 逻辑 / E 路由 / F 启动竞态)
node test/smoke.mjs

# 3. 对运行中的 Web GUI 运行实时验收
node scripts/verify-web.mjs
```

### 独立运行 Skill 引擎 (Codex / Claude Code)

本技能不强依赖 DSH，可直接在终端中独立启动守护进程：

```sh
cd .agents/skills/canvas-design-harness/server
node src/index.js <your-designs-folder>      # 默认监听 http://127.0.0.1:9321
```

---

## 📄 开源许可

[MIT License](LICENSE)
