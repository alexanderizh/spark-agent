# 电影级分镜提示词与数据契约

> 状态: 已落地 | 最后核对: 2026-07-21

## 目标

「剧本 → 分镜脚本」内置提示词必须输出能直接驱动 AI 视频生成的镜头契约，同时保持数据结构扁平、易解析、向后兼容。

## 输出契约

- 模型只输出 `{"shots":[...],"summary":{...}}` 一份 JSON，不再重复输出 Markdown。
- `shots[]` 保留现有扁平字段，新增 `composition`、`characterReferences`、`actionBeats`、`soundEffects`、`transition`、`firstFrame`、`lastFrame` 和 `continuity` 字符串字段。
- `actionBeats` 用 0.5s 时码覆盖整镜，末尾时码必须等于 `durationSec`。
- `blocking` 同时承载入画范围、站位、走位与角色—镜头/物体/角色的 cm 级距离。
- `firstFrame` 与 `lastFrame` 是可独立生成的确定画面，`continuity` 锁定轴线、视线、道具手位、造型、光向和动作接点。

## 数据流

1. `canvasAgentPromptPresets.ts` 生成 JSON-only 分镜 system prompt；上游剧本只通过节点连接编译一次，不再重复嵌入 system prompt。
2. 任务提交同时对 user prompt 与 system prompt 应用 `shotScriptConfig.maxClipSec`，禁止把 `{maxClip}` 裸占位符发送给模型。
3. 模型输出先经过语义校验：JSON 必须完整闭合，并且能从 `shots[]` 解析出至少一个镜头；分镜结果是可编辑建议稿，缺少景别、机位、构图、转场、首尾帧、提示词等制作字段不会导致任务失败。当模型漏掉 `actionBeats` 但 `durationSec` 合法时，程序按画面描述生成 0.5s 兜底节拍。
4. `parseShotTable()` 将新 JSON、历史 JSON 或 Markdown 表格归一化为 `ParsedShotRow[]`；人工导入可选择抢救部分 JSON，模型任务明确关闭该容错，避免截断前缀被误判为成功。
5. `formatStoryboardRowsAsMarkdown()` 只负责 UI 展示与可编辑文本，不再要求模型同时维护两份输出。
6. `materializeStoryboardRows()` 把所有制作字段写入 `ShotSegment`；结果节点同时回写 `shotGroupId`，单镜结果额外回写 `shotSegmentId`，资产中心手动导入复用同一映射。
7. 分镜视频与首尾帧生成从 `ShotSegment` 读取镜头、构图、调度、光色、动作节拍、音效、转场、首尾帧与连续性约束；真实关键帧使用 `first_frame` / `last_frame`，角色和场景设定图只使用 `reference`。
8. 视频操作节点预填 `durationSeconds`；完整多镜分镜节点执行“生成视频”时，按物化后的每个 `ShotSegment` 创建独立视频任务节点。

## 完整性与上下文安全

- 若模型提供 `summary.shotCount` 或 `summary.totalDurationSec`，且与 `shots[]` 明显不一致，视为疑似截断或汇总混乱并拒绝落盘；未提供 summary 不阻止加载可编辑分镜。
- 模型任务不接受截断 JSON 的局部抢救结果；制作质量字段缺失不阻止加载，`actionBeats` 这类可由镜头时长和画面描述推导的字段会做兜底补齐，原始输出和失败原因仍保留在任务诊断中，便于重试。
- token 预算同时统计可见用户输入和隐藏 system prompt，长剧本在请求前即可发现上下文不足。
- 多个分镜始终表示为顶层对象中的 `shots[]` 数组；数组元素保持扁平对象，便于节点、Skill 和 Agent 复用。

## 兼容性

- 不新增底层节点类型，不强制迁移历史分镜。
- 新字段全部可选，旧分镜继续展示、编辑、拆分和生成。
- Markdown 导入器继续接受旧列，也识别新的构图、角色参考、动作节拍、音效、转场、首帧、尾帧与连续性列。
- 手动拆镜时继承摄影、构图、调度、光色、角色参考、连续性与反向约束；原镜时码不可直接复用到子段，因此多段拆分后的 `actionBeats`、`soundEffects` 和 `transition` 需重新生成/校准，仅首段保留原 `firstFrame`、尾段保留原 `lastFrame`。
