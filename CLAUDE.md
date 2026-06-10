<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **spark-agent** (7605 symbols, 16915 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

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

# UI 技术栈规则（强约束）

新增 / 修改任何前端样式、组件时遵守以下技术选型：

## 样式

- **样式系统只用 Tailwind CSS 和 LESS。** 不再写新的全局 .css 文件。
- 组件级样式与 .tsx 同目录，命名 `<Component>.less`，由组件顶部 `import './Component.less'`。
- 历史 `apps/desktop/src/renderer/design/styles/*.css` 不强制迁移，但**不再新增**规则；要改某组件样式时优先把对应规则迁出到组件级 .less 一并改。
- 优先用 Tailwind 原子类；只在 Tailwind 不便表达（嵌套选择器、深层伪类、复杂状态组合）时落到 .less。

## 组件库

- **UI 组件库只用 Arco Design**（`@arco-design/web-react`）。
- **禁止引入新的 `@radix-ui/*` 依赖**。`packages/ui-kit` 内现存的 Radix 组件（button / dialog / dropdown-menu / scroll-area 等）属于历史包袱，**不要新增基于 Radix 的组件**；新需求一律走 Arco Design，老组件按需逐步替换。
- 表单元素必须用 Arco 封装（`SparkInput` / `SparkSelect` / `SparkTextarea` / `SparkCheckbox` / `SparkMultiSelect`），禁止裸 `<input>` / `<select>` / `<textarea>`。

## 落地动作

- 写新组件前先确认 Arco 是否有对应组件；有则用之，没有再自己封装。
- 看到老代码混用 Radix + Arco 时，不要默默替换（可能破坏样式与交互），先告知用户再动手。
- 任何新 PR 引入 `@radix-ui/*` 依赖应直接驳回，要求改用 Arco。
