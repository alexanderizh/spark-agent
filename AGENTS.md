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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **spark-agent** (12699 symbols, 23401 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/spark-agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/spark-agent/clusters` | All functional areas |
| `gitnexus://repo/spark-agent/processes` | All execution flows |
| `gitnexus://repo/spark-agent/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
