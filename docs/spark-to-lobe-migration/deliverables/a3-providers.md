# A3 · ProvidersView + provider-import-export 迁移交付

> Worker: A3
> 文件: 3 个 (按 `file-ownership.md` 约束,严格不越界)
> - `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
> - `apps/desktop/src/renderer/design/views/provider-import-export/ImportPreviewModal.tsx`
> - `apps/desktop/src/renderer/design/views/provider-import-export/MultiSelectToolbar.tsx`
>
> 任务: 把 `SparkInput` / `SparkSelect` (FormControls) + `Button/Modal/Radio/Tag/...` (SparkOverlays) 全部替换为 `@lobehub/ui` 直接导出。

## 1. 改动概览

### 1.1 `MultiSelectToolbar.tsx`

| # | 原组件 | 新组件 | 关键适配 |
|---|--------|--------|---------|
| 1 | `import { Button } from '../components/SparkOverlays'` | `import { Button } from '@lobehub/ui'` | 直接命名导入,SparkOverlays 解耦 |
| 2 | `<Button size="mini">` (×5) | `<Button size="small">` | §2.7:`mini` → `small` |
| 3 | `<Button size="mini" type="outline" status="danger" icon={<Icons.Trash />}>` | `<Button size="small" danger icon={<Icons.Trash />}>` | §2.7:`outline` → 移除(lobe 默认);`status="danger"` → `danger` 布尔 |

### 1.2 `ImportPreviewModal.tsx`

| # | 原组件 | 新组件 | 关键适配 |
|---|--------|--------|---------|
| 1 | `import { Modal, Button, Radio, Tag } from '../../components/SparkOverlays'` | `import { Modal, Button, Radio, Tag, FlexBasic } from '@lobehub/ui'` | 用 `FlexBasic` 替代 `Space`(lobe 无 `Space` 命名导出);Switch/Form 等不在本文件使用 |
| 2 | `<Modal visible onCancel={onClose}>` | `<Modal open onClose={onClose}>` | §2.5:`visible` → `open`;`onCancel` → `onClose` |
| 3 | `<Radio.Group value={mode} onChange={(v) => setMode(v)} direction="vertical">` | `<Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>` + 子节点用 `<FlexBasic direction="vertical" gap={4}>` 包裹 | §2.12:`direction="vertical"` 不在 antd Radio.Group 上,用 `FlexBasic direction="vertical"` 包 children;§2.1 onChange 改 `e.target.value` 取值 |
| 4 | `<Tag size="small" color="purple">` / `color="orange"` / `color="green"` | `<Tag size="small" color="purple">` 等 | 颜色映射已在 SparkOverlays 内部完成;lobe `Tag` 透传 antd,直接使用 |

### 1.3 `ProvidersView.tsx`

| # | 原组件 | 新组件 | 关键适配 |
|---|--------|--------|---------|
| 1 | `import { Button, Tag, Badge, Checkbox, Drawer, Switch, Alert } from '../components/SparkOverlays'` | `import { Button, Tag, Checkbox, Drawer, Switch, Alert, Input, InputPassword, Select } from '@lobehub/ui'` + `import { Badge } from 'antd'` (TODO) | Badge 在 lobe 无命名导出,按 design.md §1.1 兜底策略走 antd fallback |
| 2 | `import { SparkInput, SparkSelect } from '../components/FormControls'` | 删除,改用上面 `Input`/`Select` | FormControls 解耦 |
| 3 | `<SparkSelect value onChange={(e) => fn(e.target.value)}>` + 子节点 `<option>` | `<Select value onChange={(v) => fn(v)} options={[{label, value}, ...]}>` | §2.1:onChange 签名变化(直传 value);子节点 → `options` prop;共改 5 个 Select(provider / modelType / preset / imageProvider / imageApiType / codexApiKind)|
| 4 | `<SparkSelect width={220}>` | `<Select style={{ width: 220 }}>` | §2.x:`width` prop 不存在,用 `style.width` 替代 |
| 5 | `<SparkInput value onChange={(e) => fn(e.target.value)}>` | `<Input value onChange={(e) => fn(e.target.value)}>` | §2.3:onChange 签名 antd 风格一致,无需改业务逻辑;共改 6 个 Input(name / defaultModel / endpoint / apiKey / haikuModel / sonnetModel / opusModel)|
| 6 | `<SparkInput type="password">` | `<InputPassword>` | §2.x:lobe 不支持 `Input.Password` 子组件,用顶层 `InputPassword` 导出 |
| 7 | `<Button size="small" type="outline">` (×3) | `<Button size="small" type="default">` | §2.7:`outline` → `default`;`outline` + `default` 视觉等价(都是无色描边按钮) |
| 8 | `<Button size="small" type={cond ? 'primary' : 'outline'}>` | `<Button size="small" type={cond ? 'primary' : 'default'}>` | 同上 |
| 9 | `<Button size="mini" type="text" shape="circle" status="danger">` (×3) | `<Button size="small" type="text" shape="circle" danger>` | §2.7:`mini` → `small`;`status="danger"` → `danger` 布尔 |
| 10 | `<Drawer visible onCancel onOk okText cancelText confirmLoading bodyStyle>` | `<Drawer open onClose footer={...} styles={{ body: ... }}>` | §2.6:全部 Arco-only props 拆出;`onOk` / `okText` / `cancelText` / `confirmLoading` 用自定义 footer 实现(`Button type="primary" loading={saving}`);`bodyStyle={{padding:0}}` → `styles={{ body: { padding: 0 } }}`(antd v6 风格) |
| 11 | `<Alert type="info" content={...}>` / `type="error" content={error}` | `<Alert type="info" message={...}>` / `message={error}` | §2.17:`content` → `message` |
| 12 | `<Badge status="success|error|warning|default">` (×1, status badge) | `<Badge status="...">` (从 antd 直接 import) | lobe 无 Badge,按 design.md §1.1 兜底;**只有 1 处使用**,已 TODO 标注 |

## 2. 改动文件

- **修改** `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
  - 删除:`import { Button, Tag, Badge, Checkbox, Drawer, Switch, Alert } from '../components/SparkOverlays'`
  - 删除:`import { SparkInput, SparkSelect } from '../components/FormControls'`
  - 新增:`import { Button, Tag, Checkbox, Drawer, Switch, Alert, Input, InputPassword, Select } from '@lobehub/ui'`
  - 新增:`import { Badge } from 'antd'`(带 `// TODO(lobe-migration):` 注释)
  - 替换 18 处 JSX(见 1.3 表)。
  - 顶部 doc 注释:`Arco Design` → `@lobehub/ui`,对齐新的技术栈。
- **修改** `apps/desktop/src/renderer/design/views/provider-import-export/ImportPreviewModal.tsx`
  - 删除:`import { Modal, Button, Radio, Tag } from '../../components/SparkOverlays'`
  - 新增:`import { Modal, Button, Radio, Tag, FlexBasic } from '@lobehub/ui'`
  - 替换 4 处 JSX(见 1.2 表)。
- **修改** `apps/desktop/src/renderer/design/views/provider-import-export/MultiSelectToolbar.tsx`
  - 删除:`import { Button } from '../../components/SparkOverlays'`
  - 新增:`import { Button } from '@lobehub/ui'`
  - 替换 3 处 JSX(见 1.1 表)。

## 3. 验证

- `pnpm --filter desktop typecheck` 在 3 个本 worker 文件上**0 错误**。
- 完整 typecheck 还报 11 条 TS 错误,全部位于 `apps/desktop/src/renderer/design/views/SettingsView.tsx`(归属另一个 worker,不是本 worker 责任) — 表现为 UTF-8 字符串字面量损坏(`时间戳格?`、`profile 适配的角?` 等 `?` 字符)。这些是 pre-existing 损坏,不是 A3 引入的回归。
- `grep -E "Spark(Input|Select|MultiSelect|Textarea|Checkbox|SearchInput)"` 在本 worker 3 个文件上**0 命中**。
- `grep -E "FormControls|SparkOverlays"` 在本 worker 3 个文件上**0 命中**(仅 1 处 TODO 注释提及 `SparkOverlays` 用于解释 antd fallback 来源)。
- 业务侧 `.less` 样式文件 `ProvidersView.less` 未改,所有 `pv_` 前缀 class 保持不变。

## 4. Followup

详见 `docs/spark-to-lobe-migration/deliverables/followups.md` → **A3 · ProvidersView**:

- `@lobehub/ui` 没有 `Badge` 命名导出,本次按 design.md §1.1 兜底策略从 `antd` 直接 import 并加 `// TODO(lobe-migration):` 注释。`Badge` 在本文件中只有 1 处使用(`ProviderCardX` 的状态指示)。
- `@lobehub/ui` 没有 `Space` 命名导出,本次在 `ImportPreviewModal.tsx` 中改用 `FlexBasic direction="vertical" gap={4}` 替代 §2.12 中提到的 `Space`。视觉/行为一致。
- `<Input.Password>` 在 lobe 中是顶层 `InputPassword`,不是 `Input` 的子组件,迁移时注意改命名(已在 deliverable 表中标注)。

## 5. 自检

- [x] 业务代码中 0 处 `Spark*` 残留
- [x] 0 处 `FormControls` / `SparkOverlays` 引用(注释除外)
- [x] import 全部从 `@lobehub/ui` 直接命名导入(非 `import * as`)
- [x] onChange 签名已确认与 lobe/antd 风格一致(`e.target.value` / `v`)
- [x] size / type 等 Arco-only prop 已映射到 antd 风格(`mini` → `small`、`outline` → `default`、`status="danger"` → `danger`、`visible` → `open`、`onCancel` → `onClose`、`content` → `message` 等)
- [x] Popconfirm / Dropdown 不在本 worker 文件中使用;Radio.Group direction 适配按 §2.12 用 `FlexBasic` 包 children
- [x] 兜底 fallback(Badge / Input.Password / Space)已记录到 `deliverables/followups.md`
- [x] typecheck 在本 worker 3 个文件上 0 错误
