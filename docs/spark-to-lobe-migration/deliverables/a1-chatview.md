# A1 · ChatView 迁移交付

> Worker: A1
> 文件: `apps/desktop/src/renderer/design/views/ChatView.tsx`(只此一个文件,严格按 `file-ownership.md` 约束)
> 任务: 把残留的 `SparkInput` / `SparkTextarea` / `SparkOverlays.Button` 全部替换为 `@lobehub/ui` 直接导出。

## 1. 改动概览

| # | 原组件 | 新组件 | 行号 | 关键适配 |
|---|--------|--------|------|---------|
| 1 | `<Button size="mini" type="text">` (SparkOverlays) | `<Button size="small" type="text">` (@lobehub/ui) | ~4469 | `size="mini"` → `size="small"`(§2.7);`type="text"` 直接兼容;`onClick` 签名不变。 |
| 2 | `<SparkInput type="checkbox" checked readOnly>`(GFM `[x]` 复选框) | 原生 `<input type="checkbox" className="spark-checkbox" checked readOnly>` | ~2960 | §2.3:lobe `Input` 不支持 `type="checkbox"`,走原生 `<input>`;className 保留 `spark-checkbox`,样式继续走 `ChatView.less`。 |
| 3 | `<SparkInput value ... onChange={(e) => fn(e.target.value)}>` (other 文本框) | `<Input ...>` (@lobehub/ui) | ~10071 | onChange 签名一致(§2.3),无需改;`placeholder` / `disabled` 透传。 |
| 4 | `<SparkTextarea value ... rows={5} autoSize={{minRows:4,maxRows:8}} autoFocus>` | `<TextArea ...>` (@lobehub/ui) | ~10084 | `autoSize` / `rows` / `onChange` 全部透传,签名一致(§2.3)。 |
| 5 | `<SparkInput value ... autoFocus>`(单行 answer) | `<Input ...>` (@lobehub/ui) | ~10094 | onChange 签名一致。 |

## 2. 改动文件

- **修改** `apps/desktop/src/renderer/design/views/ChatView.tsx`
  - 删除:`import { Button } from '../components/SparkOverlays'`
  - 删除:`import { SparkInput, SparkTextarea } from '../components/FormControls'`
  - 新增:`import { Button, Input, TextArea } from '@lobehub/ui'`
  - 替换 5 处 JSX(见上表)。
- **未改**:任何 CSS、className、其他文件(严格遵守 `file-ownership.md` 不越界)。

## 3. 验证

- `pnpm --filter desktop typecheck` 在 `ChatView.tsx` 上**0 错误**。完整 typecheck 还报 4 条 TS 错误,全部位于 `apps/desktop/src/renderer/design/views/provider-import-export/ImportPreviewModal.tsx`(归属 Group **A3**,不是本 worker 责任),`Radio` / `Space` 缺导出 + `Modal.onClose` 类型不匹配,留给 A3 修复。
- `grep -E "Spark(Input|Textarea|Select|Checkbox|SearchInput|MultiSelect|Modal|Drawer|Button|Tag|Tooltip|Popover|Switch|Radio|Popconfirm|Dropdown|InputNumber|Alert|Message|Overlays)" apps/desktop/src/renderer/design/views/ChatView.tsx` 命中 0(唯一匹配是 `Icons.Sparkles`,与本次迁移无关)。
- `grep -E "FormControls|SparkOverlays" ...` 命中 0。

## 4. Followup

详见 `docs/spark-to-lobe-migration/deliverables/followups.md` → **A1 · ChatView**:

- GFM 复选框目前用原生 `<input type="checkbox" className="spark-checkbox" readOnly>`,符合 §2.3 规范但视觉上未来可换 lobe `Checkbox disabled`;本次不动。

## 5. 自检

- [x] 业务代码中 0 处 `Spark*` 残留
- [x] 0 处 `FormControls` / `SparkOverlays` 引用
- [x] import 全部从 `@lobehub/ui` 直接命名导入(非 `import * as`)
- [x] onChange 签名已确认与 lobe 风格一致(无需改)
- [x] size / type 等 Arco-only prop 已映射到 antd 风格
- [x] 不在代码里留 `// TODO`,fallback 已记录到 `deliverables/followups.md`
- [x] typecheck 在本文件上 0 错误
