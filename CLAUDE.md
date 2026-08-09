<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **spark-agent** (60545 symbols, 108263 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

# 文档保鲜（Docs Freshness）

`docs/` 下所有 plan / spec / PRD / 设计文档**必须**在文件开头(标题下第一段)带一行状态标记：

```
> 状态: [待开发 | 实施中 | 已落地 | 已废弃] | 最后核对: YYYY-MM-DD
```

## 规则

- **新建** plan/spec/PRD/设计文档时必须带这一行，否则 PR review 不通过。
- **状态变化**时（启动实施、上线、废弃）必须同步更新「状态」并刷新「最后核对」日期。
- **每季度**（每年 3 / 6 / 9 / 12 月初）由维护者轮值复核全部文档：
  - 对照代码确认状态描述是否仍准确；准确就只刷新「最后核对」日期。
  - 与代码冲突的描述要么改正，要么把文档标为 `已废弃` 并在后续版本删除。
  - 「已废弃」文档保留一个版本周期后从仓库移除。
- 单次修改文档实质内容时，顺手刷新该文件的「最后核对」日期。

## 适用范围

适用：`docs/**/*.md`（plan、spec、PRD、设计文档、改造方案、开发指南）。

不适用：`docs/adr/`（ADR 一旦记录通常不变）、`docs/reviews/`（带日期的历史复盘快照）、`README.md`、`CHANGELOG.md`、纯参考类文档（如 `agents-workflows.md`、`remote-connections.md` 等若仅描述当前能力且与代码同步维护，可不带状态行）。

判定原则：**只要文档描述的是「打算做的事」而不是「当前是什么」，就必须带状态行。**

写代码时控制好单文件的大小长度，如果一个代码文件超过了3000行，就不要在单文件上直接加东西了，能拆分为独立组件、工具、枚举数据等文件的都拆分出去使用模块导入，避免单文件过大；
