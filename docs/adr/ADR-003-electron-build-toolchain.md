# ADR-003: Electron 构建工具链选型

- **状态**: 已接受 (Accepted)
- **日期**: 2026-05-26
- **决策者**: 子涵-架构师
- **关联任务**: P0-02

---

## 背景

Electron 应用由三个进程组成：`main`（Node.js 环境）、`preload`（受限 Node.js + contextBridge）、`renderer`（浏览器环境）。普通 Vite 只能处理 renderer，main 和 preload 需要额外配置。

## 决策

**使用 `electron-vite` 作为构建工具，不使用普通 Vite。**

### 安全配置（强制，不可协商）

```typescript
// apps/desktop/src/main/index.ts
const win = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,    // 必须：隔离 preload 和 renderer 的 JS 上下文
    nodeIntegration: false,    // 必须：renderer 无法直接访问 Node.js API
    sandbox: true,             // 必须：renderer 进程沙盒化
    preload: path.join(__dirname, '../preload/index.js'),
  },
})
```

**为什么这三项是强制的**：
- `contextIsolation: false` + `nodeIntegration: true` 意味着任何 XSS 攻击都能直接访问文件系统和执行系统命令
- Spark Agent 会渲染来自 AI 的内容（Markdown/HTML），XSS 风险真实存在
- 这是 Electron 安全最佳实践的基本要求

### 项目结构

```
apps/desktop/
  src/
    main/          # 主进程（Node.js 环境，可访问 fs/os/sqlite）
      index.ts
      ipc/         # IPC handlers
    preload/       # 预加载脚本（contextBridge 暴露 API）
      index.ts
    renderer/      # 渲染进程（浏览器环境，React 应用）
      main.tsx
      App.tsx
```

### CSP 策略

renderer 必须配置 Content Security Policy，禁止 `unsafe-inline` 和 `unsafe-eval`（React 生产模式不需要 eval）。

## 被拒绝的方案

### 普通 Vite + 手动配置
- 需要自行处理 main 进程 TypeScript 编译（tsc 或 esbuild）
- preload 的 contextBridge 类型系统需要手动配置
- 额外复杂度换不来实质收益
- **拒绝理由**：electron-vite 已经解决了所有这些问题

### Webpack (electron-forge 默认)
- 构建速度慢
- 配置复杂
- **拒绝理由**：Vite 生态更现代，与 React 19 配合更好
