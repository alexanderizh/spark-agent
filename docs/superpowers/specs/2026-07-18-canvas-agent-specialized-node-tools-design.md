# 画布 Agent 专用节点工具轻量兼容设计

> 状态: 已落地 | 最后核对: 2026-08-10

## 背景

无限画布已经具备剧本、角色、场景、道具、特效、分镜、关键帧和视频片段等影视语义，但这些语义主要通过现有 `CanvasNode.type`、`node.data.pipelineRole`、影视资产 `metadata.kind` 和 `project.metadata.film.shotGroups` 组合表达。画布 UI 的右键流水线会使用专用 Prompt 和参数创建操作节点，而画布 Agent 当前主要接触 `canvas_create_text_node`、`canvas_insert_generated_text` 和 `canvas_create_operation_node` 等通用工具。

当前 Agent 动作配方只传递基础 `operation`、输入节点和部分产物角色，没有稳定携带 UI 已有的专用 Prompt、任务角色、分镜配置和输出格式。模型结果又会作为普通 Markdown 文本直接落入画布，导致剧本和分镜虽然标题或角色看起来正确，正文格式却无法满足现有编辑器、解析器和影视中心的数据要求。

## 目标

- 将现有画布语义节点作为专用 `spark_canvas` 工具提供给画布 Agent。
- 专用工具的输入 schema、字段说明和示例直接复用当前 UI 与解析器已经支持的数据格式。
- UI 手动操作与 Agent 操作复用同一套流水线契约，避免两条路径继续漂移。
- 专用结果加载前必须通过现有解析器或专用校验；无效结果不能伪装成合法剧本或分镜节点。
- 保持现有节点、资产、任务和分镜存储模型兼容，不新增底层节点类型，不强制迁移历史数据。

## 非目标

- 不新增 `CanvasNodeType`。
- 不引入新的 `contentContract`、`schemaVersion` 等持久化标记。
- 不重做现有画布编辑器、右键菜单或影视中心 UI。
- 不把所有普通文本都强制改成结构化数据。
- 不在本次改造中替换现有 Provider、文本任务运行时或媒体模型协议。

## 现有数据模型保持不变

专用工具只负责按现有组合正确创建数据，不改变底层存储模型。

| 语义节点            | 现有底层节点              | 现有语义字段或关联                                                      |
| ------------------- | ------------------------- | ----------------------------------------------------------------------- |
| 普通文本            | `type: "text"`            | `data.format: "plain" \| "markdown"`                                    |
| Prompt              | `type: "prompt"`          | `data.format: "prompt"`                                                 |
| 章节                | `type: "text"`            | `data.pipelineRole: "chapter"`，可关联 `asset.metadata.kind: "chapter"` |
| 剧本                | `type: "text"`            | `data.pipelineRole: "screenplay"`，关联 `asset.metadata.kind: "script"` |
| 角色/场景/道具/特效 | `type: "text" \| "image"` | 对应 `pipelineRole`，关联同 kind 影视资产                               |
| 分镜脚本            | `type: "text"`            | `data.pipelineRole: "shot"`，正文可由 `parseShotTable()` 解析           |
| 单镜节点            | `type: "text"`            | `pipelineRole: "shot"`、`shotGroupId`、`shotSegmentId`                  |
| 设定图卡            | `type: "image"`           | `data.pipelineRole: "design_card"`                                      |
| 关键帧              | `type: "image"`           | `data.pipelineRole: "keyframe"`，可带分镜回链                           |
| 视频片段            | `type: "video"`           | `data.pipelineRole: "clip"`，可带分镜回链                               |
| 360 全景图          | `type: "image"`           | `data.panorama360.projection: "equirectangular"`                        |

## 总体设计

### 1. 专用工具是薄适配层

新增专用工具，但不复制一套节点存储实现。每个工具只做四件事：

1. 用严格 JSON Schema 接收 Agent 参数。
2. 校验并归一化为现有节点、资产或分镜数据。
3. 调用现有 workspace actions 创建节点、影视资产、分镜和血缘。
4. 返回创建的 node、asset、shot group 和 shot segment id。

普通便签仍使用通用文本工具；影视语义内容必须使用专用工具。

### 2. UI 与 Agent 共用流水线动作契约

现有 `CANVAS_PIPELINE_OPS` 只描述动作名称、operation 和产物角色，无法独立还原 UI 创建操作节点时使用的完整配置。扩展该目录或在旁边增加纯逻辑契约模块，使每个流水线动作同时提供：

- 稳定 `actionId`；
- 输入角色与产物角色；
- 底层 `operation`；
- `taskPipelineRole` 和 `outputPipelineRole`；
- 专用 system prompt 构建器；
- 默认 `modelParams`；
- 分镜专用 `shotScriptConfig`；
- 结果校验器和物化策略。

UI 右键入口和 Agent 专用操作工具都调用同一个执行函数，不再分别拼接参数。

### 3. 模型格式示例进入实际生成请求

格式示例不能只存在于 `canvas-studio/SKILL.md`。专用操作节点必须把格式要求放入真正发给下游文本模型的 system prompt。

- 剧本生成使用现有场次剧本格式：场号、内外景、地点、时间、出场人物、动作描述、角色对白和旁白。
- 分镜生成使用现有 `parseShotTable()` 可识别的 `{"shots": [...], "summary": {...}}` JSON。解析前会修复代码围栏、前后说明、尾逗号、注释、智能/单引号、未加引号字段名和字符串裸换行等低风险瑕疵；Markdown 表格由程序根据结构化结果生成，不再要求模型同时维护 JSON 和 Markdown 两份内容。
- 角色、场景、道具和特效抽取继续使用 `canvasEntityExtract.ts` 已有的 JSON 实体格式和字段别名。

### 4. 先校验，再物化为现有画布数据

文本模型返回结果后，根据操作节点的专用动作契约选择校验器。

- 剧本：检查至少存在可识别场次标题；兼容“第1场｜内景｜地点｜时间”、Markdown 标题和 INT./EXT. 等写法，出场人物、动作、对白等缺失字段留空供编辑。无法识别场次时任务保留原始响应并标记格式错误，但若模型返回了文本，仍创建不带 `pipelineRole: "screenplay"` 的普通文本回显节点。
- 分镜：先对 JSON 做低风险语法修复，再使用 `parseShotTable()` 解析 `shots`、平铺 `segments` 或 `groups[].segments[]`；镜头对象缺失文本字段时补空字符串并保留为可编辑镜头，`summary` 仅作提示信息，不阻断可解析结果。没有可恢复镜头时不写入 `shotGroups`，但仍保留模型原文回显。
- 实体抽取：使用现有实体解析器；没有合法实体时不创建影视资产。
- 校验通过后，由代码生成现有 Markdown 展示文本，并一次性补齐节点角色、影视资产、生产状态和来源边。

模型原始文本保存在独立的 `modelOutputText` 诊断字段中；Provider/Session runtime 摘要保存在 `rawResponse`。即使结构校验失败，二者也不能互相覆盖；有文本时同时生成普通文本回显节点，便于用户继续编辑和使用，也便于排查 Provider 截断、无效 JSON、错误 schema 或字段缺失。修复器无法安全还原的截断或严重损坏 JSON 不会被静默补全。

该约束同时适用于普通文本任务和 renderer 侧跟踪的实体工作流。角色、场景、道具、特效在解析之前先记录完整模型输出；解析失败时沿失败终态写回，不得只保存错误摘要。四类实体 workflow 共用同一个类型解析入口和物化路径。

任务记录是执行时快照：运行后不再随操作节点草稿变化。原任务重试读取任务快照，当前节点重试读取节点配置；分镜时长配置也必须写入任务。历史 `operationNodeId` 按 `used_as_input.target` 或 `generated.source` 恢复，不能关联到产物节点。

专用功能 system prompt 是输出 schema 的唯一契约。通用 `text_generate`/`text_rewrite` 操作预设只能提供通用节点的默认 Prompt，不得拼接进分镜、剧本、分集或实体抽取契约；Agent 人设、Skill 和项目风格只能补充能力与风格，不能改变专用任务类型和输出 schema。历史节点若已经出现通用 Prompt 前缀污染，提交或重试时按专用契约标记剥离该前缀。

专用节点还必须持有不可被模型 Contract 裁剪掉的功能身份。`workflow`/`responseFormat` 等画布控制参数与 Provider wire 参数分层处理；专用 preset 在创建、编辑、当前节点重试和 API 提交边界都重新锁定自己的 workflow。兼容旧数据时，`taskPipelineRole`、`outputPipelineRole` 和 workflow 任一可靠信号均可恢复专用 target，其中 `shot` 角色优先于残留的实体抽取 workflow，防止分镜节点再次进入角色抽取分支。

诊断展示也必须区分“画布提交配置”和“实际模型调用”。最终调用快照记录直连 HTTP 的 URL/body/响应元数据，或 Session Runtime 的 SDK/CLI 地址与最终调用参数；只有该快照可以标记为最终请求。画布 System/User Prompt 合并为调用前快照并默认折叠，冻结输入、血缘、画布参数和去除重复输出后的 runtime 数据同样按需展开。

## 专用工具范围

### 内容与影视资产工具

| 工具                            | 输入重点                                    | 物化结果                                            |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| `canvas_create_chapter_node`    | 标题、正文、来源节点                        | chapter 资产与 `pipelineRole: "chapter"` 文本节点   |
| `canvas_create_screenplay_node` | 标题、场次剧本文本、来源节点                | script 资产与 `pipelineRole: "screenplay"` 文本节点 |
| `canvas_create_character_node`  | 名称、描述、角色 attributes、Prompt、引用图 | character 资产与角色节点                            |
| `canvas_create_scene_node`      | 名称、描述、场景 attributes、Prompt、引用图 | scene 资产与场景节点                                |
| `canvas_create_prop_node`       | 名称、描述、道具 attributes、Prompt、引用图 | prop 资产与道具节点                                 |
| `canvas_create_effect_node`     | 名称、描述、特效 attributes、Prompt、引用图 | effect 资产与特效节点                               |
| `canvas_create_storyboard_node` | 标题、分组和镜头数组、来源节点              | 分镜文本节点、`ShotGroup[]`、`ShotSegment[]` 和血缘 |
| `canvas_create_shot_node`       | group id、单镜字段、来源节点                | ShotSegment 与带回链的单镜文本节点                  |

### 媒体语义工具

| 工具                             | 输入重点                         | 物化结果                                         |
| -------------------------------- | -------------------------------- | ------------------------------------------------ |
| `canvas_insert_design_card_node` | 图片来源、影视资产 id、标题      | `pipelineRole: "design_card"` 图片节点和资产引用 |
| `canvas_insert_keyframe_node`    | 图片来源、group/segment id、帧位 | `pipelineRole: "keyframe"` 图片节点和分镜回链    |
| `canvas_insert_clip_node`        | 视频来源、group/segment id、时长 | `pipelineRole: "clip"` 视频节点和分镜回链        |
| `canvas_insert_panorama_node`    | 2:1 图片来源、场景资产 id        | 带 `panorama360` 标记的图片节点                  |

### 专用操作节点工具

提供统一的 `canvas_create_pipeline_operation_node`，要求传入现有 `CANVAS_PIPELINE_OPS` 的 `actionId`，而不是让 Agent 自己组合底层 operation 和角色字段。工具根据动作契约自动构造完整节点配置。

首期必须覆盖：

- `chapter.to_screenplay`
- `screenplay.to_shot_script`
- `screenplay.extract_characters`
- `screenplay.extract_scenes`
- `screenplay.extract_props`
- `screenplay.extract_effects`
- `character.three_view`
- `scene.scene_image`
- `prop.prop_image`
- `effect.effect_image`
- `shot.to_keyframes`
- `shot.to_video`
- `keyframe.to_video`
- `screenplay.split_episodes`
- `scene.panorama_360`

`canvas_get_available_actions` 返回专用工具名或 `canvas_create_pipeline_operation_node` 的完整 `actionId` 配方，不再为影视动作推荐裸 `canvas_create_operation_node`。

## 格式约定

### 剧本节点

剧本继续使用现有 Markdown 文本，不新增持久化 JSON 文档。专用工具要求文本至少包含一个可识别场次，推荐格式：

```markdown
# 场1 内景 茶馆 日

出场人物：林岚、老板

林岚推门进入茶馆，雨水顺着外套滴落。

林岚：还有空房吗？

老板：楼上最后一间。
```

创建成功后，程序自动设置：

```ts
{
  type: 'text',
  data: {
    format: 'markdown',
    pipelineRole: 'screenplay',
    productionState: 'draft',
    text: screenplayText,
  },
}
```

同时创建或复用 `metadata.kind: "script"` 的影视资产，节点通过 `assetId` 关联该资产。

### 分镜节点

模型与专用工具使用当前解析器支持的 JSON：

```json
{
  "shots": [
    {
      "index": 1,
      "title": "雨夜进入茶馆",
      "durationSec": 4,
      "shotSize": "全景",
      "angle": "平视",
      "movement": "缓慢推进",
      "composition": "林岚落在右上交点，前景雨帘占 20%",
      "blocking": "林岚距镜头 220cm，右手距门把 8cm",
      "description": "林岚推门进入茶馆，雨水从外套滴落",
      "actionBeats": "0.0–0.5s：右手接近门把；0.5–1.0s：压下门把；1.0–4.0s：推门进入",
      "dialogue": "林岚：还有空房吗？",
      "characterNames": ["林岚", "老板"],
      "characterReferences": "林岚=雨夜造型图；老板=茶馆工作造型图",
      "soundEffects": "0.5s：门铃轻响；1.0s：木门摩擦声",
      "transition": "入：硬切；出：动作匹配硬切",
      "firstFrame": "茶馆门关闭，林岚右手悬停在门把前 8cm",
      "lastFrame": "门开 45°，林岚右脚落在门内",
      "continuity": "右手保持握门把，运动方向从左至右",
      "shotPrompt": "雨夜茶馆内景，全景，镜头缓慢推进",
      "negativePrompt": "多余人物、错误服装、文字水印"
    }
  ],
  "summary": {
    "shotCount": 1,
    "totalDurationSec": 4
  }
}
```

程序使用 `parseShotTable()` 归一化，然后：

`shots[]` 维持扁平可选字段，不引入嵌套摄影/声音对象。内置分镜模型契约只输出一份 JSON；Markdown 展示文本由程序根据结构化结果生成。`composition/characterReferences/actionBeats/soundEffects/transition/firstFrame/lastFrame/continuity` 用于电影级视频控制，旧 JSON 和旧 Markdown 表格继续容错读取。

1. 按 `groupName` 或调用参数创建/复用 `ShotGroup`。
2. 把每行写成 `ShotSegment`。
3. 生成当前分镜编辑器可读取的 Markdown 展示文本。
4. 创建完整分镜文本节点或按需创建单镜节点。
5. 写入 `shotGroupId`、`shotSegmentId` 和来源边。

## 必须修复的现有数据缺口

### Agent 动作配方缺少专用配置

当前 `canvasAgentCapabilities.ts` 的工具配方没有携带专用 system prompt 和 `taskPipelineRole`。分镜操作因此无法命中 `screenplay.to_shot_script` 预设，剧本与分镜都可能退化为通用文本生成。

改造后，Agent 动作配方只返回专用流水线 action id，由统一契约补全配置。

### 分镜创建接口声明与持久化不一致

`canvas_create_shot_segment` 的工具 schema 已声明 `durationSec`、关键帧和风格预设等字段，但 `canvasApi.createShotSegment()` 当前只持久化标题、描述、对白、旁白、资产引用和 `shotPrompt`，其余字段会被丢弃。

改造必须让 `createShotSegment()` 保存 `ShotSegment` 已声明的全部合法字段，并为景别、角度、运镜、光照、镜头参数、色调、调度、表演、服装和反向提示词补充可选字段，使 `ParsedShotRow` 与 `ShotSegment` 之间不再丢数据。

### 文本任务完成后缺少语义物化

当前文本任务完成路径统一创建普通 Markdown 资产与文本节点，只根据 `outputPipelineRole` 打标签。改造后应按专用动作选择校验与物化策略，只有校验通过的结果才能获得 screenplay、shot、character、scene、prop 或 effect 语义。

## 兼容策略

- 历史节点不迁移、不自动重写、不新增必填字段。
- 没有专用语义的普通文本继续使用现有创建和编辑流程。
- 历史剧本节点继续按 `pipelineRole: "screenplay"` 显示；专用工具仅保证后续新建内容格式正确。
- 历史分镜文本继续使用当前容错解析器展示和拆分；无法解析时保持原文，不删除节点。
- UI 手动入口的操作方式不变，只把内部创建逻辑改为调用统一流水线契约。
- 通用 `canvas_create_operation_node` 保留给基础图像、文本、视频和音频任务；影视流水线动作不再通过它拼装。
- 通用 `canvas_create_text_node` 和 `canvas_insert_generated_text` 保留给普通文本，但工具描述和画布 Skill 必须明确它们不能创建剧本、分镜或影视资产节点。
- 已有节点统一通过 `canvas_update_node` 修改标题、可见正文和扩展数据；工具完成后重新读取画布热存储快照。底层数据更新必须不可变替换节点对象并使用单调递增版本，避免 React 继续复用被原地修改的旧内存引用。`canvas_update_node_data` 仅作为兼容入口保留。

## 模块边界

新增逻辑进入独立模块，避免继续扩大超长文件：

- `canvasPipelineActionContracts.ts`：可执行流水线动作契约与完整操作节点配置。
- `canvasSpecializedNodeSchemas.ts`：专用工具 JSON Schema 和格式示例。
- `canvasSpecializedNodeTools.ts`：专用工具描述符与薄 handler。
- `canvasStoryboardMaterialization.ts`：分镜行、影视资产引用与 ShotGroup/ShotSegment 的组合物化。
- `canvasTextOutputValidation.ts`：剧本、分镜和实体结果校验与归一化。

现有大文件只做薄接线：

- `canvas.tools.ts` 聚合并导出新增工具描述符。
- `canvas.api.ts` 在文本任务完成时调用结果校验/物化 helper，并修正分镜字段持久化。
- 现有 UI 手动入口保持不变；Agent 动作发现层把影视动作转换为共享 actionId 契约，契约复用现有 Prompt 构建器和 pipeline 定义。

## 实际落地说明

- 已注册 13 个专用 Agent 工具，全部复用现有 `CanvasNode.type`、`pipelineRole`、影视资产 kind 和分镜 metadata，没有新增节点类型或持久化版本字段。
- `canvas_get_available_actions` 只在 Agent 工具返回层把 `pipeline/recommended_flow` 配方改写为 `canvas_create_pipeline_operation_node`；UI 使用的原始能力目录和手动节点入口不变。
- 剧本和分镜文本任务在创建语义产物前校验；无效结果分别保留模型原文与运行时诊断并标记任务失败。分镜通过后由程序生成 Markdown 并写入 ShotGroup/ShotSegment。
- 文本任务终态回调具备幂等保护，避免重复事件重复追加分镜；媒体语义工具会在写入前校验媒体类型和分镜回链。
- 通用文本与通用操作工具仍然保留，但 Agent 指引明确禁止用它们伪装剧本、分镜或影视资产。

## 错误处理

- 专用工具缺少必填字段时返回包含字段路径的错误，不创建任何语义节点。
- Agent 引用不存在的 source node、asset、shot group 或 segment 时立即失败。
- 剧本或分镜解析失败时保留任务原始响应和错误摘要；有文本时创建普通文本回显产物，但不创建带专用 `pipelineRole` 的产物。
- 批量创建分镜时先完成全部校验，再开始写入，避免部分镜头成功、部分镜头失败。
- 影视资产按 kind 与规范化名称去重；命中现有资产时复用并返回 `reused: true`。
- 媒体专用工具验证实际媒体类型；全景图额外验证可读取尺寸时接近 2:1，否则返回警告或拒绝标记为全景。

## 测试策略

### 契约测试

- 每个专用工具 schema 包含必填字段、字段说明和示例。
- `canvas_get_available_actions` 对影视动作返回专用 action id，不返回裸通用配方。
- UI 右键动作和 Agent 动作解析为相同 operation、Prompt、角色和默认参数。

### 数据物化测试

- 剧本工具同时创建 script 资产和 screenplay 文本节点，并建立来源关系。
- 分镜工具把合法 JSON 同步物化为分镜文本节点、shot groups 和 shot segments。
- 分镜所有镜头字段从解析器到 `ShotSegment` 不丢失。
- 角色、场景、道具和特效工具创建正确 kind 资产及 pipelineRole 节点。
- 关键帧和视频工具正确回链 shot group/segment。

### 失败与兼容测试

- 非法剧本、空 shots、超出最大时长和无效资产引用不会创建专用节点。
- 旧剧本、旧分镜和普通 Markdown 节点继续打开、编辑、拆分和执行原有右键动作。
- 原有手动右键流水线与 Agent 专用工具创建的操作节点配置完全一致。
- 通用文本和通用媒体操作不受专用工具限制。

### 回归测试

- 画布 MCP schema 注册与 Electron host attach。
- 文本任务创建、运行、完成、失败和重试。
- 影视资产插入、分镜编辑、分镜拆分、关键帧和视频生成。
- `typecheck`、定向 Vitest、迁移静态校验、lint 和桌面构建。

## 风险与控制

本改造风险等级为高。直接影响节点能力发现、操作节点创建、文本任务结果、影视资产和分镜持久化，且相关调用分布在多个超长文件中。

控制措施：

- 先建立纯逻辑契约和测试，再接入 UI 与 Agent。
- 首先交付剧本与分镜闭环，再扩展其他专用节点工具。
- 新旧路径并存一个版本，验证稳定后再弱化 Agent 对通用工具的使用。
- 不批量迁移历史数据，不在本次改造中改变底层节点类型。
- GitNexus MCP 未暴露时，按仓库规则使用 `rg` 调用点、定向测试、`git diff` 和 Git 历史核对影响范围。

## 验收标准

- 画布 Agent 能直接看到并调用专用剧本、分镜、角色、场景、道具、特效、关键帧和视频节点工具。
- Agent 不需要自己推断 `pipelineRole`、影视资产 kind、分镜回链或操作节点底层参数。
- Agent 与手动右键创建同一流水线动作时，操作节点的 Prompt、角色、配置和输出策略一致。
- 剧本生成结果符合现有场次剧本格式后才加载为 screenplay 节点。
- 分镜生成结果能由现有解析器完整读取，并同步写入 `ShotGroup/ShotSegment`，声明字段不丢失。
- 格式无效的结果不会被加载成合法专用节点，原始响应仍可诊断。
- 历史节点和普通文本、图片、视频节点的手动操作保持可用。
