# A2 · BoardView 迁移交付

> Worker: A2
> 文件: `apps/desktop/src/renderer/design/views/BoardView.tsx`(只此一个文件,严格按 `file-ownership.md` 约束)
> 任务: 把残留的 `SparkInput` / `SparkSearchInput` / `SparkSelect` / `SparkTextarea` + `SparkOverlays` 里的 `Popover` / `Dropdown` / `Button` / `DatePicker` / `Select` / `Space` / `Switch` / `Tooltip` 全部替换为 `@lobehub/ui` 直接导出。

## 1. 改动概览

### 1.1 Imports(顶部)

| # | 原 import | 新 import | 说明 |
|---|-----------|-----------|------|
| 1 | `import { Popover, Dropdown, Button, DatePicker, Select, Space, Switch, Tooltip } from '../components/SparkOverlays'` | `import { Input, TextArea, Select, Button, Popover, Dropdown, Tooltip, DatePicker } from '@lobehub/ui'` | 8 个中的 7 个在 `@lobehub/ui` 根导出 |
| 2 | (同上) | `import { Switch } from '@lobehub/ui/base-ui'` | `Switch` **仅**在 `@lobehub/ui/base-ui`,根导出没有 |
| 3 | (同上) | `import { Input as AntdInput, Space } from 'antd'` | `Space` 不在 lobe;`Input.Search` 走 antd 原生(§2.4 兜底) |
| 4 | `import { SparkInput, SparkSearchInput, SparkSelect, SparkTextarea } from '../components/FormControls'` | (删除) | 全部由 #1/#3 覆盖 |

### 1.2 JSX 替换

| # | 原组件 | 新组件 | 位置 | 关键适配 |
|---|--------|--------|------|---------|
| 1 | `<SparkInput ref value onChange placeholder className>` | `<Input ...>` | 标题输入(line ~582) | onChange 签名一致(§2.3),ref 类型不变 |
| 2 | `<SparkInput value onChange placeholder>` | `<Input ...>` | 标签输入(line ~753) | 同上 |
| 3 | `<SparkTextarea ref value onChange onPaste rows>` | `<TextArea ...>` | 描述 textarea(line ~594) | onPaste/onChange/onKeyDown 全部透传,签名一致 |
| 4 | `<SparkTextarea value onChange rows>` | `<TextArea ...>` | 验收条件 textarea(line ~728) | 同上 |
| 5 | `<SparkTextarea value onChange rows>` | `<TextArea ...>` | 评论编辑 textarea(line ~861) | 同上 |
| 6 | `<SparkTextarea onKeyDown value onChange rows>` | `<TextArea ...>` | 评论输入 textarea(line ~891) | 同上 |
| 7 | `<SparkSelect value onChange>COLUMNS.map(<option>)...` | `<Select options={statusOptions} ...>` | 状态下拉 | §2.1:options 用 `useMemo` 转 `{label,value}`,onChange `(v) => setStatus(v as TaskStatus)` |
| 8 | `<SparkSelect value onChange>PRIORITY_CONFIG.map(<option>)...` | `<Select options={priorityOptions} ...>` | 优先级下拉 | 同上,onChange `(v) => setPriority(v as Priority)` |
| 9 | `<SparkSelect value onChange placeholder allowClear showSearch><option>agents</option></SparkSelect>` | `<Select options={assigneeOptions} ...>` | 负责人下拉 | options via `useMemo`,signature `(v) => setAssignee(v)` |
| 10 | `<SparkSelect value onChange placeholder allowClear showSearch><option>agents</option><option>teamDefs</option></SparkSelect>` | `<Select options={processingAgentOptions} ...>` | 处理 Agent 下拉 | 同上 |
| 11 | `<SparkSelect ... testAgent ...>`(同上结构) | `<Select options={testAgentOptions} ...>` | 测试 Agent 下拉 | 同上 |
| 12 | `<SparkSelect value onChange placeholder allowClear showSearch><option>projectOptions</option></SparkSelect>` | `<Select options={projectOptions} ...>` | 项目下拉 | 同上 |
| 13 | `<SparkSearchInput value onChange placeholder className>` | `<AntdInput.Search value onChange={(e)=>setSearchQuery(e.target.value)} allowClear ...>` | 搜索栏(line ~1855) | §2.4:onChange 签名从 `(value: string)` 变为 `(e) => e.target.value`;`allowClear` 显式设 true(原 SparkSearchInput 默认 true) |
| 14 | `<Tooltip content={...}>` | `<Tooltip title={...}>` | 自动执行开关提示(line ~1827) | §2.9:`content` → `title` |
| 15 | `<Popover content trigger="click" position="bottom">` | `<Popover content trigger="click" placement="bottom">` | 筛选 popover(line ~1863) | §2.10:`position` → `placement` |
| 16 | `<Popover content={columnSelectorContent} trigger="click" position="bottom">` | `<Popover ... trigger="click" placement="bottom">` | 列选择 popover(line ~1906) | §2.10 |
| 17 | `<Dropdown droplist={<div>...buttons...</div>} trigger="click" position="bottom"><Button size="small" type="outline">` | `<Dropdown menu={{items:[{key,label,onClick},...]}} trigger={['click']} placement="bottom"><Button size="small" type="default">` | 导入/导出下拉菜单(line ~1923) | §2.14:`droplist` → `menu={{items:[...]}}`;`trigger="click"` → `trigger={['click']}`;`position` → `placement`;§2.7:`type="outline"` → `type="default"` |
| 18 | `<Button size="mini" type="primary">` | `<Button size="small" type="primary">` | 评论"保存"按钮(line ~863) | §2.7:`mini` → `small` |
| 19 | `<Button size="mini">` | `<Button size="small">` | 评论"取消"按钮(line ~864) | §2.7 |
| 20 | `<Button size="mini" type="text">` | `<Button size="small" type="text">` | 评论"编辑"按钮(line ~872) | §2.7 |
| 21 | `<Button size="mini" type="text" status="danger">` | `<Button size="small" type="text" danger>` | 评论"删除"按钮(line ~873) | §2.7:`mini` → `small`;`status="danger"` → `danger` |
| 22 | `<Button size="small" type="outline">` | `<Button size="small" type="default">` | 选区"全选"按钮(line ~1983) | §2.7:`outline` → `default` |
| 23 | `<Button size="small" type="outline">` | `<Button size="small" type="default">` | 选区"取消选择"按钮(line ~1986) | §2.7 |
| 24 | `<Button size="small" status="danger">` | `<Button size="small" danger>` | 选区"删除选中"按钮(line ~1989) | §2.7 |
| 25 | `<Button status="danger" size="small" icon={...}>` | `<Button danger size="small" icon={...}>` | 删除任务按钮(line ~1802) | §2.7 |
| 26 | `<Switch size="small" checked onChange>` | `<Switch size="small" checked onChange>`(从 `@lobehub/ui/base-ui`) | 自动执行开关(line ~1837) | 直接换成 base-ui Switch;`onChange(checked: boolean, event)` 与原 `(checked: boolean)` 兼容(忽略第二参) |

### 1.3 useMemo helpers(在 TaskFormPage 顶部新增)

为了让 6 个 `<Select>`(status / priority / assignee / processingAgent / testAgent)的 options 不在每次 render 重建,新增 5 个 `useMemo`:

```tsx
const statusOptions = useMemo(() => COLUMNS.map(c => ({ label: `${c.icon} ${c.label}`, value: c.key })), [])
const priorityOptions = useMemo(
  () => (Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => ({
    label: `${PRIORITY_CONFIG[p].icon} ${PRIORITY_CONFIG[p].label}`,
    value: p,
  })),
  [],
)
const assigneeOptions = useMemo(() => agents.map(a => ({ label: a.name, value: a.name })), [agents])
const processingAgentOptions = useMemo(
  () => [
    ...agents.map(a => ({ label: a.name, value: a.name })),
    ...teamDefs.map(t => ({ label: `[团队] ${t.name}`, value: `team:${t.name}` })),
  ],
  [agents, teamDefs],
)
const testAgentOptions = useMemo(
  () => [
    ...agents.map(a => ({ label: a.name, value: a.name })),
    ...teamDefs.map(t => ({ label: `[团队] ${t.name}`, value: `team:${t.name}` })),
  ],
  [agents, teamDefs],
)
```

`projectOptions` 原本就是 `useMemo`,复用即可,无需新增。

### 1.4 ref 类型微调

| # | 原 | 新 | 原因 |
|---|----|----|------|
| 1 | `const textareaRef = useRef<HTMLTextAreaElement>(null)` | `const textareaRef = useRef<any>(null)` | `<TextArea>` 是 `forwardRef<TextAreaRef>`,原 `HTMLTextAreaElement` 与 lobe `TextAreaRef` 不兼容;该 ref 只用作 `ref` prop 传递,从未读取,改 `any` 即可 |

## 2. 改动文件

- **修改** `apps/desktop/src/renderer/design/views/BoardView.tsx`
  - 删除:`import { ... } from '../components/SparkOverlays'`
  - 删除:`import { SparkInput, SparkSearchInput, SparkSelect, SparkTextarea } from '../components/FormControls'`
  - 新增:`import { Input, TextArea, Select, Button, Popover, Dropdown, Tooltip, DatePicker } from '@lobehub/ui'`
  - 新增:`import { Switch } from '@lobehub/ui/base-ui'`
  - 新增:`import { Input as AntdInput, Space } from 'antd'`(供 `Input.Search` 和 `Space` 使用,§2.4 兜底)
  - 在 `TaskFormPage` 内新增 5 个 `useMemo`(statusOptions/priorityOptions/assigneeOptions/processingAgentOptions/testAgentOptions)
  - 替换 26 处 JSX(见 1.2)
  - `textareaRef` 类型改为 `any`
- **未改**:任何 CSS / className、其他文件(严格遵守 `file-ownership.md` 不越界)。

## 3. 验证

- `pnpm --filter desktop typecheck` 在 `BoardView.tsx` 上 **0 错误**。
  - 完整 typecheck 还报 12 条 TS 错误,**全部位于 `apps/desktop/src/renderer/design/views/SettingsView.tsx`**(归属 Group **A4**,不是本 worker 责任),JSX 转义字符问题。`BoardView.tsx` 自身完全干净。
  - 工作区留有完整 typecheck 日志:`C:\Users\Administrator\.mavis\plans\plan_72867414\workspace\typecheck-a2.log`
- `grep -E "Spark(Input|Select|Textarea|Checkbox|SearchInput|MultiSelect|Overlays)" apps/desktop/src/renderer/design/views/BoardView.tsx` 命中 **0**。
- `grep -E "SparkOverlays|FormControls" ...` 命中 **0**。
- 业务侧 className(`tfp-input` / `tfp-textarea` / `tfp-select` / `board-search-input` / `board-recycle-btn` 等)全部保留,样式继续走 `BoardView.less`。

## 4. Followup

详见 `docs/spark-to-lobe-migration/deliverables/followups.md` → **A2 · BoardView**:

- 本文件用 `import { Input as AntdInput } from 'antd'` 走 `Input.Search`(§2.4 兜底)。`@lobehub/ui` 根导出的 `Input` 不附带 `.Search` 静态属性(因为是 `memo` 包装,不是 class component)。
- `Switch` 走 `@lobehub/ui/base-ui` 而非根导出 —— 这是 v5.15.15 的当前实现,与 §1.2 设计文档表述(`Switch from '@lobehub/ui'`)略有出入。如未来 lobe 把 Switch 提升到根导出,可统一 import 路径(1 行改动)。
- `Space` 不在 `@lobehub/ui`(v5.15.15),保留 `import { Space } from 'antd'` 兜底。
- `AntdInput.Search` 的 `onChange` 签名从 `SparkSearchInput` 的 `(value: string)` 变为 `(e: ChangeEvent) => e.target.value`,调用点已统一改为 `(e) => setSearchQuery(e.target.value)`。

## 5. 自检

- [x] 业务代码中 0 处 `Spark*` 残留(`grep` 结果:0)
- [x] 业务代码中 0 处 `SparkOverlays` / `FormControls` import(`grep` 结果:0)
- [x] 所有 `<Select>` 改用 `options={[...]}` 数组,无 `<option>` 子元素残留
- [x] 所有 `<Select>` onChange 改为 `(v) => setX(v)` 或 `(v) => setX(v as Type)`(无 `e.target.value` 形态)
- [x] 所有 `SparkOverlays` 私有 prop(`visible/onCancel/position/droplist/content=tooltip/status/long`)已适配
- [x] `size="mini"` 全部改为 `size="small"`,`type="outline"`/`type="secondary"` 全部改为 `type="default"`,`status="danger"` 全部改为 `danger`
- [x] typecheck 0 错误(`BoardView.tsx` 自身)

## 6. 备注

- 本 worker 严格遵守 `file-ownership.md` 的 A2 边界,**未动** `ChatView` / `ProvidersView` / `SettingsView` / `WorkflowView` / `SkillStoreView` / `McpView` / `ScheduledTasksView` / `AgentsView` / `canvas/*` / `Sidebar*` / `TweaksPanel` / `SkillsPickerModal` / `ClickableFilePath` / `MarkdownCodeBlock` / `PromptDialog` / `overlays.tsx` / `ui-system.test.tsx` / `FormControls.tsx` / `SparkOverlays.tsx` 等其他文件。
- 本 worker **未**在代码中留 `// TODO` 注释。
- 本 worker **未**修改任何 CSS / `.less` 文件。
