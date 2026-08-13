# Renderer 样式架构

> 状态: 已落地 | 最后核对: 2026-08-13

## 目标

渲染端样式遵循“令牌 → 公共组件 → 页面/功能专属样式”的单向依赖，避免同一个选择器在多个全局入口中反复声明，再依赖导入顺序互相覆盖。

## 分层与归属

| 层级         | 文件/位置                                     | 负责内容                                                                                                        |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 令牌与基础层 | `design/styles/styles.css`                    | 主题变量、密度变量、窗口壳层、原生控件基础样式                                                                  |
| 公共组件层   | `design/styles/components.css`                | `.btn`、`.card`、`.badge`、`.empty-state`、`.form-grid`、`.settings-card`、Provider Logo、ChipList 等跨页面组件 |
| 全局兼容层   | `design/styles/global-overrides.css`          | 必须跨渲染端生效的第三方组件覆盖；只保留确实需要全局胜出的规则                                                  |
| 页面/功能层  | `design/views/*/*.less`                       | 页面布局、页面专属交互、页面专属第三方控件覆盖                                                                  |
| 历史组合层   | `design/styles/views.css`、`interactions.css` | 尚未完成迁移的旧页面组合样式；新规则不得继续放入这里                                                            |

`styles.css` 只通过 `@import './components.css'` 引入公共组件层。页面样式由页面组件自身导入，例如设置页使用 `SettingsView.less`，浏览器面板使用 `BrowserPanelView.less`。

## 归一化规则

1. 一个跨页面 class 只允许有一个公共定义点；状态变体紧邻基础组件定义。
2. 重复的间距、圆角、控件高度优先使用现有语义令牌；确有组件特有值时，先定义组件令牌再使用。
3. 页面专属 class 必须放在对应页面 Less；不能因为旧全局文件已经存在就继续追加覆盖。
4. 第三方弹窗、Portal 或库组件的全局修正才允许进入 `global-overrides.css`，并注明“为什么必须全局生效”。
5. 禁止用导入顺序解决冲突。发现同一 selector 在多个层重复出现时，应合并为单一归属；响应式规则也跟随该归属移动。
6. 删除规则前先检索 TSX/JSX 使用点；只删除无使用点的死样式，或把原有最终生效值合并到新归属中。

## 本轮迁移

- 公共按钮、卡片、空状态、表单网格、设置卡片统一到 `components.css`。
- Provider Logo 与 ChipList 的共享视觉契约统一到 `components.css`。
- 设置页告警、抽屉、规则、权限、快捷键、表单扁平化覆盖统一到 `SettingsView.less`。
- Browser Panel 的重复全局定义移除，保留 `BrowserPanelView.less` 页面归属。
- 合并项目会话、发送按钮、工作流状态、运行时保存按钮、Agent 配置面板、日志行、Markdown 语义行与 Board 工具栏中的重复声明。
- 删除 CanvasWorkspaceView 中操作节点、资源输出与运行导航的整段重复声明，保留单一生效定义。

## 后续迁移顺序

`views.css` 仍包含历史页面组合样式，后续按页面边界继续拆分：聊天 → 设置/MCP → Board/Skill Store → 其余旧页面。每次迁移都应遵循：检索使用点、确认最终生效值、移动到页面 Less、删除旧全局块、补回归测试。

## 验证

样式架构约束测试位于 `apps/desktop/src/renderer/design/style-architecture.test.ts`。修改公共 class 或页面归属时，至少运行该测试、Less 编译、渲染端类型检查和桌面端构建。
