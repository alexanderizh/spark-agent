# Computer Use 技术方案

> 状态: 待开发 | 最后核对: 2026-06-19
>
> 目标：为 Spark Agent 桌面端添加类似 Claude Desktop / OpenAI Operator 的 Computer Use 能力，让 Agent 能够"看到屏幕、理解界面、操作键鼠"，完成跨应用的自动化任务。

---

## 一、整体架构：四层感知-决策-执行-安全闭环

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Loop (Reasoning)                │
│   Multimodal LLM (Claude / GPT-4o / Gemini)             │
│   输入: screenshot + accessibility_tree + task_context   │
│   输出: action_plan (click / type / scroll / hotkey / drag) │
└──────────────┬──────────────────────┬────────────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌────────▼─────────┐
    │  Perception Layer   │  │  Action Layer    │
    │  screen capture     │  │  mouse/keyboard  │
    │  accessibility tree │  │  app control     │
    │  OCR / element det  │  │  window mgmt     │
    └─────────────────────┘  └──────────────────┘
               │                      │
    ┌──────────▼──────────────────────▼────────────────────┐
    │              Safety & Permission Layer                │
    │  action whitelist · user confirmation · screenshot   │
    │  diff verification · rollback · rate limiting        │
    └──────────────────────────────────────────────────────┘
```

核心理念：**Screenshot → Think → Act → Verify** 循环，每一步都可被人类审计和中断。

---

## 二、各层技术选型与实现路径

### Layer 1: 感知层 (Perception)

整个系统的"眼睛"。三个信号源并行，互为补充：

| 信号源 | 技术 | 精度 | 覆盖范围 | 延迟 |
|--------|------|------|----------|------|
| **屏幕截图** | Electron `desktopCapturer` (主进程) | 像素级 | 全屏 / 指定窗口 | 50-150ms |
| **无障碍树** | macOS Accessibility API / Windows UIAutomation | 语义级 | 可交互元素 | 30-100ms |
| **元素检测** | OmniParser / Florence-2 / UI-TARS 本地推理 | 混合 | 截图中的 UI 元素 | 100-300ms |

#### 三阶段演进路线

**MVP（2-3 周可交付）：纯截图 + 多模态 LLM**

- 用 Electron `desktopCapturer` 获取屏幕 / 窗口截图
- 直接发给 Claude / GPT-4o / Gemini，让模型输出 `[action, coordinates, text]`
- 这就是 Claude Computer Use 和 OpenAI Operator 的核心路径
- 优势：实现简单，跨平台一致；劣势：精度依赖模型，对复杂 UI 可能定位不准

**进阶（4-6 周）：截图 + Accessibility Tree 双通道**

- macOS：写一个 Swift 辅助工具（或复用 `@anthropic-ai/claude-computer-use` 里的 Accessibility 桥接），通过 `AXUIElement` API 拿到元素树
- Windows：用 UI Automation COM 接口（可经 `node-ffi-napi` 或原生 Node addon 调用）
- Accessibility Tree 提供元素的坐标、角色（button/input/text）、名称、值，作为截图的补充信息，显著提高定位精度（特别是文本输入、下拉菜单这种"看起来都差不多"的元素）
- 截图 + A11y 双输入，类似 Claude 3.5 Sonnet 的 computer use beta 实践

**前沿（6-8 周）：截图 + 本地 Grounding 模型**

- 集成 OmniParser（Microsoft 开源）或 UI-TARS（ByteDance）做本地元素检测
- 用 ONNX Runtime 在 Electron 主进程或 sidecar 进程里跑轻量模型（< 200MB）
- 完全本地推理，不依赖云端，延迟低至 50-100ms
- 适合对延迟敏感的场景（实时拖拽、快速连续点击）

### Layer 2: 决策层 (Reasoning Loop)

核心是一个 **Screenshot → Think → Act → Verify** 循环：

```typescript
// Computer Use Agent Loop (伪代码)
interface ComputerUseAction {
  type:
    | 'click'
    | 'double_click'
    | 'right_click'
    | 'type'
    | 'scroll'
    | 'hotkey'
    | 'drag'
    | 'wait'
    | 'screenshot'
    | 'done'
  coordinates?: [number, number]        // [x, y] 归一化到屏幕尺寸
  text?: string                          // for type action
  keys?: string[]                        // for hotkey, e.g. ['command', 'c']
  scrollAmount?: number                  // for scroll, 正向下 / 负向上
  startCoords?: [number, number]         // for drag 起点
  endCoords?: [number, number]           // for drag 终点
  duration?: number                      // for wait / drag 持续时间
  reasoning?: string                     // 模型对这一步的解释
}

async function computerUseLoop(task: string, maxSteps = 50) {
  const history: ComputerUseAction[] = []

  for (let step = 0; step < maxSteps; step++) {
    // 1. Capture — 感知层
    const screenshot = await captureScreen()
    const a11yTree = await getAccessibilityTree() // 可选，进阶阶段

    // 2. Think — 发给多模态 LLM
    const response = await llm.complete({
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: COMPUTER_USE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', data: screenshot } },
            { type: 'text', text: `Task: ${task}\nPrevious actions: ${JSON.stringify(history)}` },
            // 可选：附加 a11y tree 作为文本
            { type: 'text', text: `Accessibility: ${JSON.stringify(a11yTree)}` },
          ],
        },
      ],
      tools: [COMPUTER_USE_TOOL_DEFINITION],
    })

    // 3. Act — 解析模型输出并执行
    const action = parseAction(response)
    if (action.type === 'done') break

    await safetyCheck(action)             // 安全审批（可能弹用户确认）
    await executeAction(action)           // 执行层
    history.push(action)

    // 4. Verify — 短暂等待后重新截图验证
    await sleep(500)
  }
}
```

#### System Prompt 关键设计

- **强制结构化输出**：每一步必须输出 reasoning + action，便于审计
- **动作空间约束**：明确告诉模型有哪些 action 可用，参数格式是什么
- **失败重试机制**：如果截图后发现自己上一步没生效，模型应主动尝试替代路径（如点坐标 → 改用快捷键）
- **任务完成判定**：模型必须显式输出 `done` action 并说明完成依据，避免无限循环

### Layer 3: 执行层 (Action Layer)

执行层把抽象的 `ComputerUseAction` 翻译成真实的 OS 级事件。

#### 鼠标控制

| 平台 | 技术 | 能力 |
|------|------|------|
| macOS | `Quartz Event Services` (via `@nut-tree-fork/nut-js` 或原生 addon) | 移动 / 点击 / 拖拽 / 滚动 |
| Windows | `SendInput` Win32 API | 同上 |
| Linux | `libxdo` / `uinput` | 同上 |

推荐直接用成熟的键鼠模拟库：
- **`@nut-tree-fork/nut-js`**：跨平台，TypeScript 友好，社区活跃
- 或 **`robotjs`**：老牌但维护缓慢，对新版 Node 兼容性差

#### 键盘控制

- 文本输入：通过 OS 的虚拟键盘逐字符发送，或用 `clipboard.writeText` + 粘贴（更快，但可能被某些应用拦截）
- 快捷键：组合键发送（Cmd+C / Ctrl+Shift+T 等）
- 中文 / 日文等 IME：需要特殊处理，先激活输入法，再发送拼音 / 假名

#### 窗口管理

- macOS：`AXWindow` API，可枚举窗口、聚焦、最小化、调整位置
- Windows：`EnumWindows` + `SetForegroundWindow`
- 这是多窗口任务（"把 Excel 数据复制到浏览器表单"）的基础

### Layer 4: 安全与权限层 (Safety & Permission)

**这是最重要的层。** Computer Use 让 Agent 拿到了真实的键鼠控制权，必须有完善的安全机制。

#### 1. Action Whitelist（动作白名单）

```typescript
const ACTION_WHITELIST = {
  // 允许，无需确认
  click: true,
  type: true,
  scroll: true,
  screenshot: true,

  // 需要用户确认
  hotkey: 'confirm',          // 快捷键可能触发系统级动作
  drag: 'confirm',            // 拖拽可能移动文件 / 改变布局
  right_click: 'confirm',     // 右键菜单

  // 默认禁止
  delete_files: 'blocked',
  system_settings: 'blocked', // 系统设置修改
  install_software: 'blocked',
}

// 用户可在 Settings 里逐项调整白名单
```

#### 2. 用户确认机制

- 高风险 action 触发前，弹出一个 Arco `Modal.confirm`：
  - 显示当前截图（红框标注即将操作的坐标）
  - 显示 action 类型和参数
  - 显示模型的 reasoning
  - 用户可选 "允许一次" / "允许本次会话" / "总是允许此类操作" / "拒绝"
- 用户可设置"自动批准阈值"（如：只允许点击和输入，自动通过）

#### 3. Screenshot Diff 验证

- 每次 action 执行后，自动对比前后截图
- 如果检测到剧烈变化（如全屏切换、弹窗出现），暂停并让模型重新评估
- 如果检测到无变化（action 没生效），让模型知道并尝试其他方案

#### 4. 紧急停止 (Kill Switch)

- 全局快捷键（如 `Cmd+Shift+Esc`）立即中止整个 Agent Loop
- 失去窗口焦点时自动暂停
- 用户随时可在 UI 上点"停止"按钮

#### 5. 速率限制

- 单次 action 最小间隔 200ms（防止模型"发疯"快速点击）
- 单任务最大 step 数限制（默认 50，用户可调）
- 单次会话最大总操作数限制

#### 6. 沙盒模式（可选）

- MVP 不做，但未来可考虑：在虚拟显示器或 Docker 容器里跑 Agent，物理隔离
- 类似 OpenAI Operator 的"隔离浏览器"，但扩展到整个桌面

---

## 三、与现有架构的集成

### 3.1 作为 MCP Server 注册

参照项目中已有的 Playwright MCP 集成方式，新增一个 `computer-use` MCP Server：

```typescript
// packages/mcp-servers/computer-use/src/index.ts
const server = new McpServer({
  name: 'computer-use',
  version: '0.1.0',
})

server.tool(
  'screenshot',
  '截取当前屏幕或指定窗口的截图',
  { target: z.enum(['screen', 'window', 'region']).optional() },
  async ({ target }) => {
    const img = await captureScreen(target)
    return { content: [{ type: 'image', data: img.toString('base64'), mimeType: 'image/png' }] }
  }
)

server.tool(
  'mouse_click',
  '在指定坐标点击鼠标',
  {
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    doubleClick: z.boolean().default(false),
  },
  async (params) => {
    await safetyCheck({ type: 'click', ...params })
    await mouse.click(params.x, params.y, params.button)
    return { content: [{ type: 'text', text: `Clicked at (${params.x}, ${params.y})` }] }
  }
)

// 类似地注册 mouse_drag, keyboard_type, keyboard_hotkey, window_focus, ...
```

这样 Spark Agent 的任何 Agent 都能像调用 Playwright 一样调用 Computer Use 能力。

### 3.2 Provider 适配

复用项目已有的多 Provider 适配器：

| Provider | Computer Use 支持 | 备注 |
|----------|------------------|------|
| Claude (Anthropic) | ✅ 原生 `computer_20241022` tool | 推荐，精度最高 |
| OpenAI GPT-4o | ✅ 通过 function calling 模拟 | 需要自己组织截图 + 坐标 prompt |
| Gemini | ⚠️ 部分 | 多模态能力强，但缺少原生 computer use 工具 |
| 国产模型 (GLM/Qwen) | ⚠️ 视模型而定 | GLM-4V、Qwen-VL 可尝试 |

策略：在 Provider 层做能力探测，模型支持原生 computer use 就走原生，否则降级到"截图 + 文本坐标"模式。

### 3.3 与 A2A Team Mode 结合

- **前台 Agent**：负责执行 Computer Use（拿到键鼠控制权）
- **后台 Agent**：负责审计划、检查结果、做信息检索
- 团队模式天然适合"主操作手 + 辅助决策"的分工

### 3.4 与记忆系统结合

- Computer Use 的每次任务执行过程（截图序列 + action 序列 + 结果）可作为情景记忆存档
- 下次遇到类似任务，Agent 可回忆："上次我在这个应用的登录页，按钮在右上角..."
- 减少重复截图和模型调用，提速明显

### 3.5 UI 集成

- 在现有 Agent 配置页（已有 agents 配置面板）里增加"Computer Use 能力"开关
- 开启后，对话界面右侧增加"屏幕预览"面板，实时显示当前操作的截图 + 红框高亮
- 新增一个独立的"Computer Use"会话类型，类似 Chat / Plan 模式的并列

---

## 四、实施路线图

### Phase 0：技术验证（1 周）

**目标**：跑通最小闭环，证明技术路径可行。

- [ ] 写一个 standalone 脚本：截图 → 发给 Claude → 收到坐标 → 执行点击
- [ ] 跑通 `@nut-tree-fork/nut-js` 在 macOS 和 Windows 上的键鼠控制
- [ ] 跑通 `desktopCapturer` 截图并转 base64 发模型
- [ ] 评估 Claude computer use API 的精度和延迟

**交付物**：一个 demo 视频 + 技术可行性报告。

### Phase 1：MVP（2-3 周）

**目标**：作为 MCP Server 集成到 Spark Agent，能用对话驱动完成简单桌面任务。

- [ ] 注册 `computer-use` MCP Server，提供 6-8 个核心 tool（screenshot / click / type / scroll / hotkey / drag / done）
- [ ] 实现 Agent Loop（Screenshot → Think → Act → Verify）
- [ ] 实现基础安全层：全局停止按钮、step 数限制、危险 action 弹窗确认
- [ ] UI：对话右侧增加"屏幕预览"面板
- [ ] 接入 Claude Provider（原生 computer use tool）
- [ ] 测试场景：打开浏览器搜索关键词、在备忘录里写一段话、整理桌面图标

**交付物**：可在生产环境使用的 Computer Use MVP，用户开启 Agent 后能通过自然语言驱动桌面操作。

### Phase 2：双通道感知（4-6 周）

**目标**：加入 Accessibility Tree，显著提升定位精度。

- [ ] macOS：实现 Swift Accessibility bridge（独立 sidecar 进程）
- [ ] Windows：实现 UI Automation bridge
- [ ] 修改 System Prompt，让模型同时接收截图和 a11y tree
- [ ] 引入"元素 ID"机制：模型可以输出 `click element_id="button-submit"` 而非裸坐标
- [ ] 处理 a11y tree 过大问题（按区域 / 角色裁剪，只发当前焦点窗口）

**交付物**：精度大幅提升，能稳定完成"在表单第 3 个输入框填 X"这种精确任务。

### Phase 3：本地 Grounding 模型（6-8 周）

**目标**：本地推理，降低延迟和成本。

- [ ] 集成 ONNX Runtime（`onnxruntime-node`）
- [ ] 适配 OmniParser 或 UI-TARS 模型（导出 ONNX，量化到 int8）
- [ ] 实现 sidecar 推理进程，通过 IPC 与主进程通信
- [ ] 模型管理：下载、缓存、版本切换
- [ ] 混合策略：本地 grounding 做元素检测，云端 LLM 做决策

**交付物**：延迟从 1-2s 降到 200-500ms，云成本降低 60%+。

### Phase 4：生态化（持续）

- [ ] 任务录制：用户手动操作一遍，自动生成 Computer Use 计划，下次直接重放
- [ ] 任务市场：分享"自动填表"、"数据搬运"等常用任务模板
- [ ] 跨设备协同：手机端发起任务，桌面端执行（类似 macOS 远程控制）
- [ ] 与 Browser Use（已有 Playwright MCP）智能切换：浏览器任务走 Playwright，桌面应用走 Computer Use

---

## 五、关键技术风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| **macOS Accessibility 权限** | 没有"辅助功能"权限就无法控制键鼠 | 启动时检测权限，引导用户在"系统设置 > 隐私与安全 > 辅助功能"里勾选 |
| **Windows 焦点防篡改** | 部分应用（如任务管理器）拒绝程序化激活 | 文档说明限制，对 UAC 弹窗特殊处理 |
| **多显示器 / HiDPI** | 坐标在不同 DPI 下错位 | 统一用逻辑坐标，模型输出归一化 [0,1] 坐标，执行时按显示器 DPI 转换 |
| **模型精度不足** | 在复杂 UI 上点击错误位置 | 双通道（截图 + a11y）+ 用户确认机制兜底 |
| **延迟过高** | 单步 2-3s，任务执行慢 | 本地 grounding 模型 + 流式输出 + 缓存机制 |
| **模型越权操作** | Agent 做了用户不想做的事 | 多层安全：白名单 / 确认 / 紧急停止 / 操作审计日志 |
| **隐私泄露** | 截图可能包含敏感信息（密码 / 私人聊天） | 截图本地处理优先；上传云端前可选遮挡；任务结束后自动清理截图缓存 |

---

## 六、参考实现

- **Anthropic Computer Use Demo**：https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo
- **OpenAI Operator**：闭源，但其设计思路（隔离浏览器 + 多模态决策）可参考
- **OmniParser (Microsoft)**：https://github.com/microsoft/OmniParser
- **UI-TARS (ByteDance)**：https://github.com/bytedance/UI-TARS
- **nut-js**：https://github.com/nut-tree-fork/nut.js
- **Anthropic Computer Use Tool 文档**：https://docs.anthropic.com/en/docs/build-with-claude/computer-use

---

## 七、建议的下一步

1. **先做 Phase 0 技术验证**（1 周），确认 Claude computer use API 在我们的场景下精度够用
2. **同时启动安全层的设计评审**，让团队对"Agent 拿到键鼠控制权"的安全边界达成共识
3. **Phase 1 MVP 期间**，挑选 3-5 个真实用户场景作为验收用例（如：自动整理桌面、自动填报表单、自动回复特定消息）
4. **不要跳过 Phase 2 的 Accessibility 集成**，纯截图路线在复杂表单上的精度天花板很低
