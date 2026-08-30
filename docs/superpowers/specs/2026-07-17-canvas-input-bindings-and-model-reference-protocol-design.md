# 画布统一输入绑定与模型引用协议设计

> 状态: 已落地 | 最后核对: 2026-07-17

## 背景

任务配置面板当前同时维护提示词文档、媒体选择 ID、视频帧角色 ID。上方参考资源宫格、提示词 Tag、提交校验和最终 Provider 请求分别读取不同状态，导致删除提示词 Tag 后界面与请求可能不一致。

当前编译器还把图片、文本和结构化引用按混合快照顺序编号为 `ref-n`，但 Provider 只收到独立的图片数组和 prompt，不会收到可供模型理解的 `relationManifest`。分镜文本则会被主动转换为 Markdown 表格，不利于模型稳定区分字段与引用边界。

## 目标

- 物理连线、`@`、提示词“+”菜单和资源宫格都读写同一套输入绑定。
- 删除任一入口中的资料时，所有投影视图和最终请求同步变化。
- 图片模型标签严格对应最终 Provider 数组顺序。
- 文本引用具有明确、成对的开始和结束边界。
- 分镜和普通表格转换为紧凑的“字段：值”记录，而不是 Markdown 表格。
- 兼容现有 `CanvasPromptDocument v2` 和旧任务数据。
- 不继续扩大接近 3000 行的 `CanvasOperationPanel.tsx`，新增逻辑放入独立纯模型和 Hook。

## 非目标

- 不删除或自动修改画布物理连线。
- 不新增资源拖拽排序；本期使用稳定的绑定顺序。
- 不改变 Provider 对首帧、尾帧、参考图等底层字段的既有要求。
- 不把内部 `relationManifest` 伪装成模型可见协议。

## 统一输入绑定

新增任务级 `CanvasInputBinding`：

```ts
type CanvasInputBinding = {
  id: string
  sourceNodeId: string
  origin: 'connection' | 'manual' | 'picker'
  kind: 'image' | 'video' | 'audio' | 'text' | 'structured' | 'file'
  relation: CanvasPromptRelation
  role?: 'input' | 'first_frame' | 'last_frame' | 'reference' | 'mask'
  enabled: boolean
  order: number
  promptBlockId?: string
}
```

同一 `(sourceNodeId, role)` 只产生一个实际 Provider 输入。提示词中可有多个指向该绑定的引用位置，但不会重复上传图片或重复拼接全文。相同节点承担不同角色时保留独立绑定。

`origin=connection` 的绑定被删除时写为停用，不删除边；`origin=manual/picker` 的绑定被删除时直接移除。重新选择资料会复用或重新启用稳定绑定。

## 交互与单一真值

任务配置面板把绑定投影为：

- “本次实际发送”资源区：展示所有启用绑定。媒体显示缩略图，文本显示资料 Chip。
- 提示词 Tag：显示与绑定关联的 inline 引用。
- 媒体角色控件：修改绑定的 role，而不是维护另一组 ID。
- 提交校验：只校验启用绑定编译出的最终 `inputFiles`。

添加行为：

- 物理连线创建或启用 `connection` 绑定。
- `@` 创建 `manual` 绑定并插入关联 Tag。
- “+”资源菜单与 `@` 使用相同动作。
- 宫格资源选择器创建 `picker` 绑定；需要 inline 语义时可插入关联 Tag。

删除行为：

- 删除 Tag 会删除或停用其绑定，因此宫格和最终请求同步移除。
- 删除宫格资料会删除或停用绑定，并清除所有关联 Tag。
- 删除全部图片后，宫格立即为空；只有最终命中的模型能力要求图片时才阻止提交。

## 编译与模型引用协议

编译器分两阶段：

1. 解析启用绑定、操作节点/分组产物、角色和去重结果，形成最终有序输入。
2. 基于最终输入顺序分配模型可见编号并渲染 prompt。

参考图片按 `role=reference` 的最终数组顺序编号：

```text
[图片引用]
参考图 #1：生成角色身份板 · 苏烬（角色）
参考图 #2：出租屋场景（场景）
[/图片引用]
```

必须保证 `参考图 #1` 对应 Provider `reference_images[0]`。首帧、尾帧等单独通道使用“首帧图”“尾帧图”，不混入参考图编号。Adapter 在编号完成后不得重新排序或静默过滤；输入无法解析时必须在发请求前失败。

内部 manifest 增加可审计定位信息：

```ts
type CanvasPromptModelReference = {
  channel: 'reference_images' | 'input_images' | 'first_frame' | 'last_frame' | 'text'
  ordinal?: number
  label: string
}
```

该字段用于运行历史与调试，模型理解仍以 prompt 中实际存在的标签为准。

## 文本序列化

所有文本引用都输出明确边界：

```text
[文本引用 T1 开始]
类型：分镜脚本
名称：分镜脚本

分镜 1
名称：烟雾与拒绝
角色：苏烬
场景：狭窄的出租房
时长（秒）：8
景别：特写
画面/动作：苏烬面对电脑屏幕缓慢吐出烟雾
[/文本引用 T1 结束]
```

序列化规则：

- JSON 分镜和 Markdown 分镜表先归一为 `ParsedShotRow[]`，再输出稳定字段顺序。
- 普通 Markdown 表格按原表头转换为“记录 N + 字段：值”。
- 只输出非空字段，保留单元格内换行。
- 普通文本保留正文，只增加类型、名称和边界。
- 无法可靠解析时保留原文，不做有损猜测。

## 兼容与持久化

保留 `CanvasPromptDocument v2` 作为用户编辑文档，新增可选 `inputBindings` 任务字段。读取旧数据时：

1. 从有效物理连线建立 connection 绑定。
2. 从未抑制的 reference/structured block 建立 manual 绑定。
3. 从旧 input role 状态补齐 role。
4. 以节点与角色去重，保持原文档顺序优先。

旧请求仍可不提供 `inputBindings`；编译入口在缺失时执行兼容归一化。新保存和新运行写入 bindings，使草稿恢复和重试不再重新猜测 UI 状态。

## 模块边界

- `packages/protocol/src/canvas-prompt.ts`：跨进程绑定和模型引用类型。
- `canvasInputBindings.ts`：绑定归一化、添加、删除、角色、去重和派生选择 ID。
- `useCanvasInputBindings.ts`：React 状态协调，避免逻辑进入大面板。
- `canvasModelInputPresentation.ts`：图片清单、文本边界、分镜和通用表格序列化。
- `canvasPromptCompiler.ts`：消费最终绑定并生成编号、inputFiles、manifest 和 prompt。
- `CanvasOperationPanel.tsx`：只负责把 UI 事件转交绑定动作。
- Provider adapters：保持编译后的顺序并增加请求体合约测试。

## 错误处理

- 节点或资源不存在：绑定标记失效并阻止提交，错误指向具体资料。
- 物理连接断开：connection 绑定停用，手动绑定不受影响。
- 超过模型输入上限：不静默裁剪，提交前展示实际数量和模型上限。
- 图片传输失败：编号尚未发给 Provider，整体提交失败，不产生错位请求。
- prompt 超过 Provider 限制：保留用户文本与引用边界，按既有校验返回明确错误，不静默截断。

## 测试与验收

- 三张图片通过连接、`@`、选择器混合加入时，宫格、Tag、bindings、inputFiles 和 Provider 数组一致。
- 删除中间图片后重新编号，prompt `#1/#2` 与请求数组同步。
- 删除全部图片后宫格为空，最终模型要求图片时才报错。
- 同一图片重复引用不重复上传；不同角色绑定分别保留。
- 文本、分镜 JSON、分镜表格和普通表格都具有明确边界和字段式输出。
- 保存草稿、关闭重开、重试任务后映射稳定。
- xAI 合约测试断言 prompt 中的图片编号与 `reference_images[]` 精确对应。

当前环境没有暴露 GitNexus MCP。实施按仓库降级规则使用直接调用点检索、相关测试、日志和 `git diff` 核对影响范围。
