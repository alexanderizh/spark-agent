# D1 — AgentsView SparkXxx 扫尾

> 范围:`apps/desktop/src/renderer/design/views/AgentsView.tsx`
> 目标:清掉 `SparkOverlays` 残留的 `Dropdown` / `Switch` / `Message` 三处

## 改动清单

| 组件 | 旧来源 | 新来源 | API 适配 |
| --- | --- | --- | --- |
| `Dropdown` | `SparkOverlays` (`@lobehub/ui` 兼容名) | `@lobehub/ui` 命名 `Dropdown` (alias `LobeDropdown`) | `trigger="contextMenu"` → `trigger={['contextMenu']}`;`position="bottomLeft"` → `placement="bottomLeft"`;`menu={{ items: [...] }}` 形态不变 |
| `Switch` | `SparkOverlays` | `antd` 兜底(@lobehub/ui 无命名导出) | onChange `(checked: boolean) => void` 已匹配,无需改 |
| `Message` | `SparkOverlays` | **删除**(本文件导入但未使用) | — |

## followups(留给后续)

- `@lobehub/ui` 5.15.x 缺 `Switch` / `Message` / `Spin` / `Progress` / `Descriptions` / `Space` / `Badge` / `Radio` 等命名导出。本文件 `Switch` 已兜底走 antd;其它文件(McpView / ProvidersView / SkillStoreView / canvas/CanvasWorkspaceView / CanvasInspector / ImportPreviewModal 等)各自 worker 应该按需走 antd,并在本表加 TODO 注释。建议最终 verify 阶段把这一组兜底条目汇总到 `docs/spark-to-lobe-migration/followups.md`。
- design.md §1.2 提到的"统一用 antd App.useApp() 收敛 Message"本轮不适用(McpView 等文件 typecheck 错误属于其它 worker 范围)。

## 验证

- `pnpm --filter desktop typecheck`:本文件 0 错误(其它文件错误为其它 worker 范围,未触碰)
- `grep "SparkXxx" AgentsView.tsx`:0 命中
