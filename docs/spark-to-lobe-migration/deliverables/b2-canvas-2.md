# B2 · Canvas 视图 (5 文件) 迁移交付

> Worker: B2
> 文件 (按 `file-ownership.md` 严格约束):
> - `apps/desktop/src/renderer/design/views/canvas/CanvasInspector.tsx`
> - `apps/desktop/src/renderer/design/views/canvas/CanvasAssetDrawer.tsx`
> - `apps/desktop/src/renderer/design/views/canvas/CanvasAiPanel.tsx`
> - `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
> - `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
>
> 任务: 把残留的 `SparkInput` / `SparkTextarea` / `SparkSearchInput` / `SparkSelect` 与 `SparkOverlays.{Button,Tag,Empty,Space,Descriptions,Drawer,List,Spin,Message}` 全部替换为 `@lobehub/ui` 直接导出或 antd fallback。

## 1. 改动概览

| # | 文件 | 原组件 | 新组件 | 关键适配 |
|---|------|--------|--------|---------|
| 1 | CanvasInspector | `SparkOverlays.{Button,Descriptions,Empty,Space,Tag}` + `SparkTextarea` | `@lobehub/ui.{Button,Empty,Tag,TextArea}` + `antd.{Descriptions,Space}` fallback | Descriptions/Space lobe 缺导出 → 临时 antd;Tag `arcoblue`→`blue`,`gray`→`default`(§2.8);`size="mini"`→`"small"`(§2.7) |
| 2 | CanvasAssetDrawer | `SparkOverlays.{Drawer,Empty,List,Tag}` + `SparkSearchInput` + `SparkSelect` | `@lobehub/ui.{Drawer,Empty,List,SearchBar,Select,Tag}` | **关键**:Drawer `visible`→`open`、`onCancel`→`onClose`(§2.6);Select 改用 `options` 数组 + `useMemo`,`width={132}`→`style={{ width: 132 }}`;List 改用 `items` 数组,每条 `key`+`title`(`@lobehub/ui` List API 不支持 `dataSource`+`renderItem`);SearchBar `onInputChange` 直接接受 value 字符串,正好对接原 onChange |
| 3 | CanvasAiPanel | `SparkOverlays.{Button,Tag}` + `SparkSelect` + `SparkTextarea` | `@lobehub/ui.{Button,Tag,Select,TextArea}` | Select 用 `useMemo` 转 `options`,`onChange` 改成 `(value) => setX(value)`;Button `long`→`block`(§2.7);Tag 颜色映射同 #1 |
| 4 | CanvasInlineAiComposer | `SparkOverlays.{Button,Tag}` + `SparkSelect` + `SparkTextarea` | `@lobehub/ui.{Button,Tag,Select,TextArea}` | 同 #3 |
| 5 | CanvasWorkspaceView | `SparkOverlays.{Button,Empty,Message,Spin,Tag}` | `@lobehub/ui.{Button,Empty,Tag}` + `antd.{Spin, message}` fallback | Spin lobe 缺导出 → 临时 antd;`Message.warning`→`AntdMessage.warning`(§2.18);Tag `green` 内置保留 |

## 2. 改动文件 (5 个,均在 `apps/desktop/src/renderer/design/views/canvas/`)

- **修改** `CanvasInspector.tsx`
  - 删除:`import { Button, Descriptions, Empty, Space, Tag } from '../../components/SparkOverlays'`
  - 删除:`import { SparkTextarea } from '../../components/FormControls'`
  - 新增:`import { Descriptions, Space } from 'antd'` + `// TODO(lobe-migration):` 注释
  - 新增:`import { Button, Empty, Tag, TextArea } from '@lobehub/ui'`
  - 替换 8 处 JSX(2× 空态 Space+Button,1× 多选 Tag 颜色,1× Descriptions+3 Button,1× TextNodeEditor 内 TextArea+Button)

- **修改** `CanvasAssetDrawer.tsx`
  - 删除:`import { Drawer, Empty, List, Tag } from '../../components/SparkOverlays'`
  - 删除:`import { SparkSearchInput, SparkSelect } from '../../components/FormControls'`
  - 新增:`import { Drawer, Empty, List, SearchBar, Select, Tag } from '@lobehub/ui'`
  - 替换 1 处 Drawer(`visible`→`open`,`onCancel`→`onClose`)
  - 提取 `TYPE_OPTIONS` 常量,Select 用 `options` 数组
  - List 重构:用 `useMemo` 把 `filteredAssets` 映射成 `listItems: { key, title: JSX }[]`,原 `<List.Item>` 内容塞到 `title` 里

- **修改** `CanvasAiPanel.tsx`
  - 删除:`import { Button, Tag } from '../../components/SparkOverlays'`
  - 删除:`import { SparkSelect, SparkTextarea } from '../../components/FormControls'`
  - 新增:`import { Button, Select, Tag, TextArea } from '@lobehub/ui'`
  - 提取 `operationOptions` useMemo,Select 用 `options`
  - Button `long` → `block`

- **修改** `CanvasInlineAiComposer.tsx`
  - 删除:`import { Button, Tag } from '../../components/SparkOverlays'`
  - 删除:`import { SparkSelect, SparkTextarea } from '../../components/FormControls'`
  - 新增:`import { Button, Select, Tag, TextArea } from '@lobehub/ui'`
  - 同 #3 的 Select 改造

- **修改** `CanvasWorkspaceView.tsx`
  - 删除:`import { Button, Empty, Message, Spin, Tag } from '../../components/SparkOverlays'`
  - 新增:`import { Button, Empty, Tag } from '@lobehub/ui'`
  - 新增:`import { Spin, message as AntdMessage } from 'antd'` + `// TODO(lobe-migration):` 注释
  - `Message.warning('请选择图片文件')` → `AntdMessage.warning('请选择图片文件')`

## 3. 验证

- `pnpm --filter desktop typecheck` 在我负责的 5 文件上 **0 错误**。
  - 完整 typecheck 还报 ~20 条 TS 错误,全部位于其他 worker 的文件(SettingsView / ProvidersView / SkillStoreView / CanvasProjectsView / ImportPreviewModal / overlays),不在本任务范围。
- 残留检查:
  - `grep -E "Spark(Input|Select|Textarea|Checkbox|SearchInput|MultiSelect|Modal|Drawer|Button|Tag|Tooltip|Popover|Switch|Radio|Popconfirm|Dropdown|Input|InputNumber|Alert|Message|Overlays)"` 在 5 文件上 → 0 命中
  - `grep -E "from '.*FormControls|from '.*SparkOverlays'"` 在 5 文件上 → 0 命中
- `Drawer` API 关键改动已确认:`open={open} onClose={onClose}`,业务侧 `onCancel` 全部重命名。

## 4. Followup

详见 `docs/spark-to-lobe-migration/deliverables/followups.md` → **B2 · Canvas 视图**:

- `@lobehub/ui` 缺 `Descriptions` / `Space` / `Spin` 三个常用展示组件,目前临时从 antd 引用。建议后续 (a) 推动 lobe 在 `@lobehub/ui` 加这些命名导出,或 (b) 在业务侧 `app/FormControls.legacy.tsx` 集中封装,避免散落到 5 个文件。本次按 design.md §1.1 兜底策略 + TODO 注释处理,不阻断。
- `@lobehub/ui` 的 `List` API 与 antd `List` 不兼容(只接受 `items` 数组,每条需 `key`+`title`,不支持 `dataSource`+`renderItem`)。本次用 `useMemo` map-to-items 改造。**注意**:D3 worker 在最终删 `SparkOverlays.tsx` 时,只要还有别处从 SparkOverlays 引用 `List`,就要切到 antd 或 lobe 的 `items` API;如果别的 worker 也从 antd `List` 迁过来,会需要类似 map-to-items 改造。

## 5. 自检

- [x] 业务代码中 0 处 `Spark*` 残留
- [x] 0 处 `FormControls` / `SparkOverlays` 引用
- [x] import 全部从 `@lobehub/ui` 直接命名导入(非 `import * as`),fallback 用 `antd` 并加 TODO 注释
- [x] Drawer `visible` → `open`,`onCancel` → `onClose`
- [x] Select onChange 签名已改 lobe 风格:`(value) => setX(value)`
- [x] size / type / color 等 Arco-only prop 已映射到 antd 风格(mini→small, arcoblue→blue, gray→default, long→block)
- [x] `Message` 临时走 antd `message`,符合 design.md §2.18
- [x] typecheck 在 5 文件上 0 错误
