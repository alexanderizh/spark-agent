# SparkXxx → @lobehub/ui 迁移设计文档

> 适用范围: `apps/desktop/src/renderer/**`
> 参照: `apps/desktop/src/renderer/design/views/AgentsView.tsx`(已率先迁移,直接 `import { Checkbox, Input, Select, TextArea, ... } from '@lobehub/ui'`)
> 目标: 全量删除 `FormControls.tsx` 与 `SparkOverlays.tsx` 两个薄封装,所有业务代码直接 `from '@lobehub/ui'`

## 0. 现状盘点

- `apps/desktop/src/renderer/design/components/FormControls.tsx` 导出:
  `SparkInput`, `SparkSearchInput`, `SparkSelect`, `SparkMultiSelect`, `SparkTextarea`, `SparkCheckbox`
- `apps/desktop/src/renderer/design/components/SparkOverlays.tsx` 导出:
  `Modal`, `Drawer`, `Button`, `Tag`, `Tooltip`, `Popover`, `Switch`, `Radio`, `Select`, `Popconfirm`,
  `Dropdown`, `Input`, `InputNumber`, `Alert`, `Message`, `Form`, 以及直接重导出的 `Spin/Empty/Badge/Avatar/Space/Progress/Slider/Descriptions/List/DatePicker/AutoComplete/Checkbox`
- 待改文件 30 个,见 `docs/spark-to-lobe-migration/file-ownership.md`
- `@lobehub/ui` 已在 `apps/desktop/package.json` 中固定为 `^5.15.15`

## 1. 目标导入规范

### 1.1 表单组件 (替换 `SparkInput/SparkSearchInput/SparkSelect/SparkMultiSelect/SparkTextarea/SparkCheckbox`)

```tsx
import {
  Input,
  TextArea,
  Select,
  Checkbox,
  InputSearch,    // 对应 SparkSearchInput
} from '@lobehub/ui'
```

> 注意:`@lobehub/ui` 当前不直接暴露 `MultiSelect` 命名导出,需要 `Select` 的 `mode="multiple"`(见下)
> `InputSearch` 的实际导出名以 `node_modules/@lobehub/ui/es/index.d.ts` 为准;若未导出,则用 antd 原生 `Input.Search`:`import { Input as AntdInput } from 'antd'; <AntdInput.Search ... />`,但**不**走 antd 包装层(因为目标是"全部替换为 lobe 原始")。
> 兜底策略:若 `@lobehub/ui` 无对应组件,先在 `Input` 顶部加 `// TODO(lobe-migration): 无对应组件,临时从 antd 引用` 注释,并在 `docs/spark-to-lobe-migration/followups.md` 留条目,**不阻断** worker 推进。

### 1.2 弹窗/触发器组件 (替换 `SparkOverlays` 里弹窗/触发器)

```tsx
import {
  Modal,        // 替代 SparkOverlays.Modal
  Drawer,       // 替代 SparkOverlays.Drawer
  Button,       // 替代 SparkOverlays.Button
  Tag,          // 替代 SparkOverlays.Tag
  Tooltip,      // 替代 SparkOverlays.Tooltip
  Popover,      // 替代 SparkOverlays.Popover
  Switch,       // 替代 SparkOverlays.Switch
  Radio,        // 替代 SparkOverlays.Radio
  Select,       // 替代 SparkOverlays.Select
  Popconfirm,   // 替代 SparkOverlays.Popconfirm
  Dropdown,     // 替代 SparkOverlays.Dropdown
  InputNumber,  // 替代 SparkOverlays.InputNumber
  Alert,        // 替代 SparkOverlays.Alert
  Form,         // 替代 SparkOverlays.Form
  // 通用展示/列表:
  Spin, Empty, Badge, Avatar, Space, Progress, Slider, Descriptions, List, DatePicker, AutoComplete, Checkbox,
  // 消息提示:
  // @lobehub/ui 没有等价 Message 命名导出,统一用 antd 的 App.useApp() 或 message 实例
} from '@lobehub/ui'
```

> 注意:`Message` 在 `@lobehub/ui` 中没有对应导出(它走 `App.useApp().message`)。迁移时:
> - 若使用方已经走 `App.useApp()`(React 上下文),`Message.success(...)` → `const { message } = App.useApp(); message.success(...)`
> - 否则直接 `import { message } from 'antd'`(不破坏现状),并在 `followups.md` 留条目,后续统一走 `App.useApp()`

## 2. API 差异速查 (必看)

### 2.1 `SparkSelect` → `Select` (大改)

| 项 | SparkSelect (旧) | Select (新) |
| --- | --- | --- |
| 子元素 | `<Select><option value="x">X</option></Select>` | 不支持,必须用 `options` 数组 |
| onChange 签名 | `(e: { target: { value: string } }) => void` | `(value: string, option) => void` |
| value 类型 | string | string(单选) / string[](多选) |
| 多选 | 用 `SparkMultiSelect` | `Select` + `mode="multiple"` |
| placeholder/allowClear/showSearch | 支持 | 支持(同 antd) |
| size | `'mini' \| 'small' \| 'default' \| 'large'` | `'small' \| 'middle' \| 'large'`(`mini`/`default` 没有,统一映射到 `middle`) |
| 容器 | `getPopupContainer={() => document.body}` | 默认即可,不需要传 |

**转换模板**:
```tsx
// 旧
<SparkSelect value={x} onChange={(e) => setX(e.target.value)}>
  <option value="a">A</option>
  <option value="b">B</option>
</SparkSelect>

// 新
<Select
  value={x}
  onChange={(v) => setX(v)}
  options={[{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]}
/>
```

**多选转换模板**:
```tsx
// 旧
<SparkMultiSelect value={xs} onChange={(e) => setXs(e.target.value)}>
  <option value="a">A</option>
</SparkMultiSelect>

// 新
<Select
  mode="multiple"
  value={xs}
  onChange={(v) => setXs(v as string[])}
  options={[{ label: 'A', value: 'a' }]}
/>
```

**动态 options 提取 (复用)**: 如果 `<SparkSelect>` 的子元素是变量 (例如来自 map),把 `<option>` 数组提前用 `useMemo` 转成 `{ label, value }`:
```tsx
const options = useMemo(
  () => items.map((it) => ({ label: it.name, value: it.id })),
  [items],
)
```

### 2.2 `SparkCheckbox` → `Checkbox`

| 项 | SparkCheckbox (旧) | Checkbox (新) |
| --- | --- | --- |
| onChange | `(e: { target: { checked: boolean } }) => void` | `(checked: boolean) => void` |
| label | 接受 `label` prop 或 children | 只接受 children |
| 受控/非受控 | `checked` / `defaultChecked` | 同 |

**转换模板**:
```tsx
// 旧
<SparkCheckbox checked={x} onChange={(e) => setX(e.target.checked)} label="启用" />

// 新
<Checkbox checked={x} onChange={(v) => setX(v)}>启用</Checkbox>
```

### 2.3 `SparkInput` / `SparkTextarea` → `Input` / `TextArea`

| 项 | SparkInput/Textarea (旧) | Input/TextArea (新) |
| --- | --- | --- |
| onChange | `(e: { target: { value: string } }) => void` | `(e: React.ChangeEvent<HTMLInputElement>) => void`,取值用 `e.target.value` |
| size | `'mini' \| 'small' \| 'default' \| 'large'` | `'small' \| 'middle' \| 'large'`,统一映射 `mini`→`small`, `default`→`middle` |
| type='range' / 'checkbox' / 'radio' | SparkInput 内部分支走原生 `<input>` | **不**通过,需要走原生 `<input type="range">` 等,业务侧自行处理 |
| icon | SparkInput 有 `icon` prop | 没有;若需要,前端单独包 `<Input prefix={...} />` |
| autoSize (TextArea) | `boolean \| { minRows, maxRows }` | 同 |

`onChange` 差异:
```tsx
// 旧
<SparkInput value={x} onChange={(e) => setX(e.target.value)} />
// 新
<Input value={x} onChange={(e) => setX(e.target.value)} />
```
(签名意外相同,只是类型是 React 标准 event)

### 2.4 `SparkSearchInput` → `Input.Search` 或 `InputSearch`

- 优先:`@lobehub/ui` 的 `InputSearch`(若存在导出)
- 兜底:`import { Input as AntdInput } from 'antd'` + `<AntdInput.Search ... />`,并标注 TODO
- onChange: `SparkSearchInput` 的 `onChange(value: string)`(已直接传值),而 antd `Input.Search` 的 `onChange(e: ChangeEvent<HTMLInputElement>)` 要取 `e.target.value`
- onSearch: 接收搜索值 (button/enter 触发),可继续保留

### 2.5 `SparkOverlays.Modal` → `Modal`

| 项 | SparkOverlays.Modal | @lobehub/ui.Modal |
| --- | --- | --- |
| open | 接受 `visible` 或 `open` | **只**接受 `open` |
| onClose | `onCancel` 或 `onClose` | **只**接受 `onClose` |
| onOk | 支持 + `confirmLoading` | 同 antd Modal (`onOk(e)` / `confirmLoading`) |
| 其它 props | Arco 风格 | 透传 antd ModalProps |

**转换**: 业务侧 `onCancel` 全部改 `onClose`;`visible` 全部改 `open`。

### 2.6 `SparkOverlays.Drawer` → `Drawer`

同上,`onCancel` → `onClose`,`visible` → `open`。
若业务侧有 `footer={...}` Arco 风格(已含 ok/cancel 按钮),保留 `footer` 即可 (lobe 的 Drawer 透传 antd)。
若有 `okText` / `cancelText` / `onOk` 触发自动 footer,迁移为 antd 原生 footer:

```tsx
// 旧
<Drawer title="X" okText="确定" cancelText="取消" onOk={...} onCancel={...} />

// 新
<Drawer
  title="X"
  open={open}
  onClose={onCancel}
  footer={
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <Button onClick={onCancel}>取消</Button>
      <Button type="primary" onClick={onOk}>确定</Button>
    </div>
  }
/>
```

### 2.7 `SparkOverlays.Button` → `Button`

| 项 | SparkOverlays.Button | @lobehub/ui.Button |
| --- | --- | --- |
| type | `'default' \| 'primary' \| 'secondary' \| 'dashed' \| 'link' \| 'text' \| 'outline'` | 同 antd:`'default' \| 'primary' \| 'dashed' \| 'link' \| 'text'` |
| size | `'mini' \| 'small' \| 'default' \| 'large' \| 'middle'` | `'small' \| 'middle' \| 'large'` |
| status | `'default' \| 'success' \| 'warning' \| 'danger'` | `danger={status === 'danger'}` 布尔转换;`success/warning` 走 `type="primary"` 或自定义样式,无等价时降级为 `type="default"` + 业务自管样式 |
| long | `long: true` → 加 `.antd-btn-block` 类 | 用 `style={{ width: '100%' }}` 或 `block` prop (antd) |
| onClick | 同 | 同 |

**转换**:
- `type='secondary'` / `type='outline'` → `type='default'`
- `size='mini'` → `size='small'`
- `size='default'` → `size='middle'`
- `status='danger'` → `danger`
- `status='success'/'warning'` → `type='primary'`(若不能 100% 还原旧外观,在 followups.md 留条目)
- `long` → `block`

### 2.8 `SparkOverlays.Tag` → `Tag`

- `size='small'` → 通过 className 或 styles 控制字号,lobe 的 `Tag` 不一定接受 `size`
- `color='arcoblue'|'green'|'red'|'orange'|'purple'|'cyan'|'magenta'|'gray'` → 映射到 antd 内置颜色:
  - `arcoblue/cyan/blue` → `blue`
  - `green` → `green`
  - `red` → `red`
  - `orange` → `orange`
  - `purple` → `purple`
  - `magenta` → `magenta`
  - `gray` → `default`
- 自定义十六进制 color 保持原样

### 2.9 `SparkOverlays.Tooltip` → `Tooltip`

- `content` → `title`(lobe 的 Tooltip 走 antd, 用 `title` 而非 `content`)
- `position` → `placement`
- 其它 props 透传

### 2.10 `SparkOverlays.Popover` → `Popover`

- `content` 保留 (lobe 透传 antd)
- `position` → `placement`
- `title` 保留

### 2.11 `SparkOverlays.Switch` → `Switch`

- `checkedText` → `checkedChildren`
- `uncheckedText` → `unCheckedChildren`
- onChange 原本 `(checked: boolean) => void` 已匹配 lobe 签名,**无需改**

### 2.12 `SparkOverlays.Radio` → `Radio`

- `Radio.Group` 保留 (lobe 透传)
- `direction='vertical'` → 通过 `Space direction="vertical"` 包裹 children,或自定义 className
- onChange `(value)` 直传已匹配,无需改

### 2.13 `SparkOverlays.Popconfirm` → `Popconfirm`

- `onOk` → `onConfirm`
- `title` / `content` 二选一 (lobe 透传 antd,接受 `title`)
- 其它不变

### 2.14 `SparkOverlays.Dropdown` → `Dropdown`

- `droplist` (Arco 用法) → `menu={{ items: [...] }}` (antd 用法,**最大改点**)
- `trigger='click' | 'hover' | 'contextMenu'` → 同 antd 数组 `['click']`
- `position` → `placement`
- `open` / `onOpenChange` 保留

**转换示例**:
```tsx
// 旧
<Dropdown
  droplist={<ul><li onClick={...}>项1</li><li>项2</li></ul>}
  trigger="click"
>
  <Button>菜单</Button>
</Dropdown>

// 新
<Dropdown
  menu={{
    items: [
      { key: '1', label: '项1', onClick: ... },
      { key: '2', label: '项2' },
    ],
  }}
  trigger={['click']}
>
  <Button>菜单</Button>
</Dropdown>
```

### 2.15 `SparkOverlays.Input` → `Input`

- 仅是 onChange 签名微调:Arco 风格 `(value, event) => void` → lobe 风格 `(e: ChangeEvent) => void`,用 `e.target.value`
- TextArea / Password / Search / Group 全部可直接用

### 2.16 `SparkOverlays.InputNumber` → `InputNumber`

- onChange: `InputNumber` 透传 antd,接收 `(value: number | string | null)`,与业务用法一致

### 2.17 `SparkOverlays.Alert` → `Alert`

- `content` → `message`
- 其它透传

### 2.18 `SparkOverlays.Message` → `message` (antd)

- `@lobehub/ui` 没有等价导出
- 临时:`import { message } from 'antd'`,业务侧 `Message.success(x)` → `message.success(x)`
- 长期目标:在 `useToast` 已有包装的前提下,后续逐步统一到 `useToast`

### 2.19 通用展示/列表 (直接重导出)

`Spin/Empty/Badge/Avatar/Space/Progress/Slider/Descriptions/List/DatePicker/AutoComplete/Checkbox` 在 lobe 中存在同名导出,直接 import 使用即可,API 与 SparkOverlays 的直接重导出**完全一致**。

## 3. 工具与可复用片段

### 3.1 options 转换工具

如果文件内多处出现 `<SparkSelect><option>...</option></SparkSelect>`,建议在文件顶部加一个本地 helper:

```tsx
const toOptions = (items: ReadonlyArray<{ value: string; label: ReactNode }>) => items
```

但更常见的是直接内联 `options={[...]}`。

### 3.2 批量替换策略

- 单一文件用 Edit 工具**逐个**改,不要用 find-replace 全局替换
- 每次改完跑一次 `pnpm --filter desktop typecheck`(在工作区根目录),确认没破类型
- 一个文件改完就 commit,出错容易回滚

## 4. 收尾动作 (每个 worker 都做)

1. **删除** 业务文件中的 `import { ... } from '.../SparkOverlays'` 与 `from '.../FormControls'`
2. **加** `import { ... } from '@lobehub/ui'`(按本文件实际用到哪些命名导出来 import,**不要** `import * as ...`)
3. **保留** 业务侧自定义的 `xxx.less`(spark-input-wrap / spark-checkbox 等 class),不强制改 class 名(用户没要求改 CSS)
4. **改 onChange 签名** 适配 lobe 风格(见 §2)
5. **改 Arco-only prop**(`visible/onCancel/position/droplist/...`)为 antd 风格
6. **本文件无任何 SparkXxx 残留**:`grep -E "Spark(Input|Select|Textarea|Checkbox|SearchInput|MultiSelect|Modal|Drawer|Button|Tag|Tooltip|Popover|Switch|Radio|Popconfirm|Dropdown|Input|InputNumber|Alert|Message|Overlays)" path/to/file.tsx` 应当 0 命中

## 5. 验证清单 (worker 必跑)

- `pnpm --filter desktop typecheck` 必须通过 (在该文件改完后)
- 不在本 worker 负责范围内的文件**不能动**(会被其它 worker 接管)
- 完成后写 `docs/spark-to-lobe-migration/deliverables/<task-id>.md` 记录:
  - 改了哪些文件
  - 跨文件 followups (例如 lobe 缺某组件需 fallback 到 antd)
  - 关键 API 适配点

## 6. 全局收口

`docs/spark-to-lobe-migration/final-sweep.md` 由最后跑的 verify worker 写入:
- `grep` 全工程,确认 0 处 `SparkOverlays` / `FormControls` 引用
- 跑 `pnpm --filter desktop typecheck`、`pnpm --filter desktop lint`
- 跑 `pnpm --filter desktop test:unit`(若测试文件也被改)
- 删除 `apps/desktop/src/renderer/design/components/FormControls.tsx` 与 `SparkOverlays.tsx`(两个文件已 0 引用)
- 列出 `followups.md` 留给后续处理的小尾巴 (lobe 缺组件 / `Message` 收敛 / className 改名等)
