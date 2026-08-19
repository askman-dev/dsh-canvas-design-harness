# client/ — DSH Web GUI 模块

本目录是 `dsh-canvas-design-harness` 插件的**浏览器端实现**，挂载到 DeepSeek Harness Web GUI 的 `conversation.view` 标签页环中。

---

## 📁 文件结构

- `design-view.js` — **浏览器端组件源码**：
  - 基于 React + DSH 原生 Design System 变量体系开发；
  - 接入 DSH 原生 `ctx.locale` 服务（zh / en 双语自适应）；
  - 实现设计稿画廊（Card Grid）、空态引导卡片及内嵌画布查看器（iframe）。
- `bundle.js` — **构建产物**（请勿直接编辑，由 `npm run build:client` 生成）：
  - 包装为 DSH `@deepseek-ai/dsh-client-modules` 规范的经典脚本，通过 `window.__ModuleLoader__.load({ id, factory })` 注册。
- `logic.js` — **纯逻辑函数**：
  - 提供设计稿目录映射（`designsDirFor`）、Tab 标识生成、SSE 帧解析等无副作用辅助函数，供 `test/smoke.mjs`（Part D）离线测试。

---

## 🔌 宿主通信路由 (Host Routes)

前端组件通过同源 HTTP 路由与宿主 `plugin.js`（基于 `ctx.webServer`）通信：

| 路由地址 | 请求方式 | 作用与参数 |
|---|---|---|
| `/canvas/designs` | `GET` | `?sessionId=&root=`：解析当前会话工作区，调用守护进程返回设计稿列表 |
| `/canvas/open` | `GET` | `?file=<fileId>`：302 重定向至守护进程的 HTML 查看器页面 |
| `/canvas/events` | `GET` | `?file=<fileId>`：SSE 实时事件流代理（推送文件更新事件） |

---

## 🛠️ 构建与测试

```sh
# 重新打包客户端 bundle
npm run build:client

# 运行包含前端纯逻辑测试的完整套件
node test/smoke.mjs
```
