# followups.md — SparkXxx → @lobehub/ui 迁移遗留小尾巴

> 由各 worker 追加;verify (D4) worker 在最后收口。

## A1 · ChatView

- 旧 `SparkInput type="checkbox" checked readOnly`(任务列表里 GFM `[x]` / `[ ]` 复选框,Markdown 渲染)用 `SparkInput` 内部的 `<input type="checkbox">` 分支实现,迁移规范 §2.3 明确指出 lobe `Input` **不**支持 `type='checkbox'`,需要业务侧自行用原生 `<input type="checkbox">`。本次按规范切到原生 `<input type="checkbox" className="spark-checkbox" checked readOnly />`,CSS 类名 `spark-checkbox` 保持不变,样式可继续走 `ChatView.less`。
  - 后续可考虑用 lobe `Checkbox`(`checked` + `disabled`)替代,只需 1 行改动 + 1 处样式微调,可读性更好;不过这会改变 `readOnly` 语义(`disabled` 会有灰化视觉),需要产品/设计 review 后再替换。
  - 文件位置:`apps/desktop/src/renderer/design/views/ChatView.tsx` line ~2960(`renderMarkdownList` 块)。

## B2 · Canvas 视图 (5 文件)

- `@lobehub/ui` 缺 `Descriptions` / `Space` / `Spin` 三个常用展示组件的命名导出(对比 antd 是 `Spin/Space/Descriptions` 直接命名导出)。本次按 design.md §1.1 兜底策略,从 `antd` 直接 import 并加 `// TODO(lobe-migration):` 注释。涉及文件:
  - `CanvasInspector.tsx`:`import { Descriptions, Space } from 'antd'`
  - `CanvasWorkspaceView.tsx`:`import { Spin, message as AntdMessage } from 'antd'`
  - 后续 D3 删 `SparkOverlays.tsx` 时这些 antd fallback 是**永久**的(直到 lobe 加导出或 D4 推动替代实现)。建议在 `app/FormControls.legacy.tsx`(或类似)集中封装,避免散落到更多文件。
- `@lobehub/ui` 的 `List` API 与 antd `List` 不兼容:`@lobehub/ui/es/List/type.d.mts` 明确写 `interface ListProps { items: ListItemProps[]; ... }` 与 `ListItemProps { key: string; title: ReactNode; ... }`,**不**支持 antd 的 `dataSource`+`renderItem` 模式。本次在 `CanvasAssetDrawer.tsx` 用 `useMemo` 把 `filteredAssets` 映射成 `{ key, title: <原 List.Item 内容> }[]`。如果其他 worker 也需要从 antd `List` 迁过来,需要类似的 map-to-items 改造(可以参考 `CanvasAssetDrawer.tsx` 的 `listItems` 写法)。
- 业务侧的 CSS className 保留(`canvas-asset-list` / `canvas-asset-item` / `canvas-inspector-desc` 等),未做改动,样式继续走各文件同目录的 `.less`。

## A3 · ProvidersView + provider-import-export

- `@lobehub/ui` 没有 `Badge` 命名导出(对比 antd 直接命名导出)。本次按 design.md §1.1 兜底策略从 `antd` 直接 import 并加 `// TODO(lobe-migration):` 注释。`Badge` 在 `ProvidersView.tsx` 中只有 1 处使用(`ProviderCardX` 的状态指示)。后续 D3/D4 推动 lobe 加 `Badge` 命名导出后可移除 fallback。
- `@lobehub/ui` 没有 `Space` 命名导出,本次在 `ImportPreviewModal.tsx` 中改用 `FlexBasic direction="vertical" gap={4}` 替代 §2.12 中提到的 `Space`。`FlexBasic` 是 lobe 的 `<div>` + CSS-var 包装版,视觉/行为与 antd `Space` 等价。建议 B2 也跟进。
- `<Input.Password>` 在 lobe 中是顶层 `InputPassword`,**不是** `Input` 的子组件 — 设计文档 §1.1 模板用 `Input.Password` 写法是 antd 风格的脑残粉,迁移到 lobe 时需要改命名。已在本 worker 3 个文件迁移时显式处理(`<SparkInput type="password">` → `<InputPassword>`)。

## A2 · BoardView

- `Input.Search` 在 lobe 中**没有**作为 `Input` 的静态属性挂载。`@lobehub/ui/es/Input/Input.mjs` 用 `memo` 包装 antd `Input`(不是 class component),所以 `Input.Search` 不可用。本次按 §2.4 兜底:`import { Input as AntdInput } from 'antd'`,然后用 `<AntdInput.Search .../>`。涉及文件:`apps/desktop/src/renderer/design/views/BoardView.tsx` line ~1855。
  - 后续若 lobe 提升 `InputSearch` 到根导出(或把 `.Search` 重新挂到 `Input`),可统一改回 `import { Input } from '@lobehub/ui'` + `<Input.Search .../>`(1 行改动)。
- `Switch` 在 lobe v5.15.15 中**仅** `@lobehub/ui/base-ui` 暴露(`SwitchProps` 类型 + `Switch` 组件),根 `@lobehub/ui` 没有。设计文档 §1.2 写的是 `import { Switch } from '@lobehub/ui'`,但实际只能从 `@lobehub/ui/base-ui` 拿。本次按实际路径走 `import { Switch } from '@lobehub/ui/base-ui'`。
  - 后续若 lobe 把 `Switch` 提升到根导出,可统一 import 路径(1 行改动)。
- `Space` 不在 lobe(同 B2 followup)。本次 `BoardView.tsx` 1 处使用(`<Space size={6}>`),直接从 `antd` import。如未来希望避免散落 antd fallback,可在 D4 推动 lobe 添加 `Space` 命名导出。
- `Dropdown` 在 lobe 中要求 `menu: { items: [...] }`(`MenuProps` 类型),**不**支持 Arco 的 `droplist` JSX。本次在 `BoardView.tsx` line ~1923 把"导入导出"按钮组的 3 个按钮转成 3 个 `MenuItemType`:`{ key, label: <span className="board-dropdown-item">...</span>, onClick: ... }`。注意 `label` 字段允许任意 ReactNode,所以可以保留原本的自定义 className 与图标结构,视觉效果不变。


