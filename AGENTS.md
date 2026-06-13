# Project Rules

## 前端 UI 组件栈（强制规则）

项目已经移除 Arco Design、Radix、`@spark/ui-kit` 以及本地二次封装控件。前端 UI 必须遵循当前组件栈：

1. 优先直接使用 `@lobehub/ui` 提供的基础组件。
2. `@lobehub/ui` 没有覆盖或 API 不满足时，直接使用 `antd` 基础组件。
3. 禁止新增或恢复本地二次封装控件来模拟基础组件外观。
4. 禁止引入或继续使用已移除的 UI 栈：`@arco-design/web-react`、Radix、`@spark/ui-kit`。

### 控件使用约束

| 控件类型 | 必须优先使用 | 允许补位 | 禁止 |
| --- | --- | --- | --- |
| 下拉选择 | `@lobehub/ui` `Select` | `antd` `Select` | 原生 `<select>`、自写 `<ul role="listbox">`、自写 popup、`SparkSelect` |
| 弹窗 / 抽屉 / 气泡 | `@lobehub/ui` `Modal` / `Drawer` / `Popover` / `Tooltip` | `antd` 对应组件 | 自实现遮罩 + 浮层、Arco/Radix 浮层 |
| 表单 | `@lobehub/ui` 或 `antd` 的 `Form` + `Input` / `Select` / `Checkbox` | 原生小控件例外见下方 | 裸 `<form>` + 裸 `<input>` 拼装业务表单、`FormControls` |
| 按钮 | `@lobehub/ui` `Button` | `antd` `Button` | 自写 `<button>` 带 style 模仿组件库外观、Arco `Button` |
| 标签 / 徽标 | `@lobehub/ui` `Tag` / `Badge` | `antd` `Tag` / `Badge` | 自写圆角 span 模仿标签 |
| 菜单 / 列表 | `@lobehub/ui` 或 `antd` `Dropdown` / `Menu` / `List` / `Tree` | - | 自写悬浮菜单面板、Radix menu |
| 加载 / 空状态 | `@lobehub/ui` 或 `antd` `Spin` / `Empty` / `Skeleton` | - | 自写 loading 动画 |

### 已废弃用法

- 不要使用 `@arco-design/web-react`，也不要新增 `.arco-*` 相关样式。
- 不要使用 Radix 组件或 `@spark/ui-kit`。
- 不要恢复 `FormControls.tsx`、`SparkOverlays.tsx`、`SparkSelect`、`SparkInput`、`SparkTextarea`、`SparkCheckbox` 等本地二次封装。
- 旧 CSS 中针对已移除组件库的选择器（如 `.arco-*`、`.spark-select-*`、`.spark-textarea-*`）如果已经不匹配实际渲染，应直接删除或迁移到当前组件库的真实类名，不要继续累积无效规则。

### 例外

- `<input type="range">` / `<input type="checkbox">` / `<input type="radio">` 在简单、非业务表单的小控件场景可以保留原生。
- ChipList、富文本/Markdown 内部 checkbox、代码编辑器等高度自定义复合输入可以保留原生或专用实现。
- 如果 `@lobehub/ui` 和 `antd` 都没有对应能力，必须在相关代码或文档中说明替代方案。
