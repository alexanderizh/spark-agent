# Project Rules

## Arco Design 优先（强制规则）

前端 UI 一律优先使用 Arco Design (`@arco-design/web-react`) 提供的基础组件。**禁止**自己手写可由 Arco 替代的控件外观。具体包括但不限于：

| 控件类型 | 必须使用 | 禁止 |
| --- | --- | --- |
| 下拉选择 | `<Select>`（项目内封装为 `SparkSelect`） | 原生 `<select>`、自写 `<ul role="listbox">`、自写 popup |
| 弹窗 / 抽屉 / 气泡 | `Modal` / `Drawer` / `Popover` / `Trigger` | 自实现遮罩 + 浮层 |
| 表单 | `Form` + `Form.Item` + `Input` / `Select` / `Checkbox` | 裸 `<form>` + 裸 `<input>` 拼装 |
| 按钮 | `Button` | 自写 `<button>` 带 style 模仿 Arco 外观 |
| 标签 / 徽标 | `Tag` / `Badge` | 自写圆角 span |
| 菜单 / 列表 | `Menu` / `List` / `Tree` | 自写悬浮面板 |
| 加载 / 空状态 | `Spin` / `Empty` / `Skeleton` | 自写 loading 动画 |

### 下拉弹窗（`SparkSelect`）专属规则

- 所有表单里的下拉框（agents 配置、面板新增弹窗、skills 手动创建、provider 新增/编辑侧拉框，以及其他任何出现下拉的场景）**必须**用 `SparkSelect`（封装 Arco `Select`），不要直接用 `Select`，更不要用原生 `<select>`。
- `SparkSelect` 内部走 Arco 默认下拉弹窗；CSS 只做轻量主题贴合（颜色 / 圆角 / 边框），**不要**重画外观。
- 旧 CSS 里覆盖选择器（如 `.arco-select-view-icon`）如果类名对不上 Arco 实际渲染，**直接删掉**，不要让无效规则继续累积。
- 新增业务字段需要"下拉"语义时，先在 `FormControls.tsx` 扩展 `SparkSelect`，复用 `<option>` API。

### 例外

- `<input type="range">` / `<input type="checkbox">` / `<input type="radio">` 在 Arco 不直接覆盖的小控件场景可以保留原生；ChipList 这种高度自定义的复合输入允许例外。
- 如果 Arco 没有对应能力，必须在 AGENTS.md 标注并说明替代方案。
