# 电影级分镜提示词与数据契约

> 状态: 已落地 | 最后核对: 2026-07-20

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
3. 模型输出先经过严格语义校验：JSON 必须完整闭合，`summary` 必须与 `shots[]` 数量/时长一致，每镜时长不得超过任务配置，`actionBeats` 必须以连续 0.5s 时段覆盖整镜，核心电影控制字段不得为空。
4. `parseShotTable()` 将新 JSON、历史 JSON 或 Markdown 表格归一化为 `ParsedShotRow[]`；人工导入可选择抢救部分 JSON，模型任务明确关闭该容错，避免截断前缀被误判为成功。
5. `formatStoryboardRowsAsMarkdown()` 只负责 UI 展示与可编辑文本，不再要求模型同时维护两份输出。
6. `materializeStoryboardRows()` 把所有制作字段写入 `ShotSegment`；结果节点同时回写 `shotGroupId`，单镜结果额外回写 `shotSegmentId`，资产中心手动导入复用同一映射。
7. 分镜视频与首尾帧生成从 `ShotSegment` 读取镜头、构图、调度、光色、动作节拍、音效、转场、首尾帧与连续性约束；真实关键帧使用 `first_frame` / `last_frame`，角色和场景设定图只使用 `reference`。
8. 视频操作节点预填 `durationSeconds`；完整多镜分镜节点执行“生成视频”时，按物化后的每个 `ShotSegment` 创建独立视频任务节点。

## 完整性与上下文安全

- `summary.shotCount` 必须等于 `shots.length`，`summary.totalDurationSec` 必须等于逐镜时长合计；不一致直接拒绝落盘。
- 模型任务不接受截断 JSON 的局部抢救结果；原始输出和失败原因仍保留在任务诊断中，便于重试。
- token 预算同时统计可见用户输入和隐藏 system prompt，长剧本在请求前即可发现上下文不足。
- 多个分镜始终表示为顶层对象中的 `shots[]` 数组；数组元素保持扁平对象，便于节点、Skill 和 Agent 复用。

## 兼容性

- 不新增底层节点类型，不强制迁移历史分镜。
- 新字段全部可选，旧分镜继续展示、编辑、拆分和生成。
- Markdown 导入器继续接受旧列，也识别新的构图、角色参考、动作节拍、音效、转场、首帧、尾帧与连续性列。
- 手动拆镜时继承摄影、构图、调度、光色、角色参考、连续性与反向约束；原镜时码不可直接复用到子段，因此多段拆分后的 `actionBeats`、`soundEffects` 和 `transition` 需重新生成/校准，仅首段保留原 `firstFrame`、尾段保留原 `lastFrame`。
