# 画布媒体节点 UX 透明化 + 配置补足 + MCP 链路统一

> 状态: 已落地 | 最后核对: 2026-07-05

> 验收修正: 画布核心链路与 MCP/skill 链路已落地：`CanvasMediaInputHint` 已统一 composer/panel/inline 的图片角色与用量提示，画布参数枚举会展示当前模型不支持的旧值，MCP `generate_image`/`generate_video` 已改为宽松参数 schema 并要求通过 `describe_model` 查询真实约束。完整音频参考 UI 明确后置，不阻塞本阶段验收；`describe_model` 仍保留 `reference_audio` 的能力描述。实施时未把 `rolePolicy` 逐条写入 manifest，而是在 `packages/protocol/src/media-config.ts` 通过 `inferRolePolicy` 集中推断，并由画布 UI 与 MCP `describe_model` 共同消费。另已校正一个原计划偏差：`input.maxImages` 只表示图片输入上限，不应用来表达 `video.extend` 的视频段数量；视频数量未来应另建 `maxVideos`/`maxAudio` 等字段。

## 背景与目标

用户在画布里拖了多张图到视频节点，但「哪些图实际被用到、用作了什么角色（首帧/尾帧/参考图）、当前模型支持多少张」全都不透明；切换模型后图片上限和参数字段不会动态变，超额图片被静默丢弃。本方案要让画布媒体节点的配置传参**完全由 manifest 驱动**，并在 UI 层做透明化 + 拦阻；同时把 spark_media MCP 工具 schema 也改为 manifest 驱动，消除两条链路的体验割裂。

## 现状盘点（已调研，作为改动基线）

- **已适配 61 个媒体模型**（`packages/protocol/src/media-model-manifest.ts:1251` `BUILTIN_MEDIA_MODEL_MANIFESTS`）
- **输入上限语义缺口**：`maxImages` 只能描述图片数量；`xai:grok-imagine-video` 的 video.edit/extend 与 Seedance video.extend 仅接收视频，不应补 `maxImages`。`omni:gemini-omni-flash-preview` 的 video.edit 若未来确认支持视频+参考图，应通过 `acceptedMimeTypes` + `maxImages` 表达图片上限；视频/音频数量需要新增 `maxVideos`/`maxAudio`，不能复用 `maxImages`。
- **画布 7 个 UX 缺口**：缩略图 role 徽章、切模型 toast、composer/panel/inline 角色 hint、capability 标识、hint 文案统一、MCP 宽松 schema 已落地；preset 的 inputConstraints 快照仍是可选低优先增强，不作为本阶段阻塞项。
- **Seedance 2.0 官方参数缺口**：`prompt_extend`、`tools.web_search` 未纳入 manifest schema；官方 role 还支持 `reference_video` / `reference_audio`（多模态参考），manifest 只标注了图片
- **文档落后**：Seedance 1.x / Seedream 4.0/5.0 Lite 文档未列；PixVerse 文档有代码无

## 改动方案（4 阶段，按依赖顺序）

### 阶段 1：manifest 配置补足（protocol 层，无 UI 风险，先行）

**目标**：让 manifest 成为「图片角色/上限/参数」的唯一真源，后续 UI 和 MCP 都从它读。

#### 1.1 校正输入上限字段语义
`packages/protocol/src/media-model-manifest.ts`：
- `xai:grok-imagine-video` video.edit/extend：保持只声明 `video/mp4`，不补 `maxImages`。
- `volcengine:doubao-seedance-2-0-*` video.extend：保持只声明 `video/mp4`，不补 `maxImages`；最多视频段数未来用单独字段表达。
- `omni:gemini-omni-flash-preview` video.edit：当前只声明视频输入；若官方确认可带参考图，再补图片 MIME 与 `maxImages`。
- 未来扩展：在 `MediaManifestCapability.input` 中新增 `maxVideos` / `maxAudios`，并让画布与 MCP 分别展示视频/音频上限。

#### 1.2 集中推断 capability input rolePolicy
新增类型与推断函数（`packages/protocol/src/media-config.ts`）：
```ts
export type MediaInputRolePolicy = {
  /** 该 capability 支持的图片角色 */
  imageRoles?: Array<'first_frame' | 'last_frame' | 'reference_image'>
  /** 该 capability 支持的视频角色 */
  videoRoles?: Array<'reference_video' | 'input_video'>
  /** 该 capability 支持的音频角色 */
  audioRoles?: Array<'reference_audio'>
  /** 未手动指定 role 时的默认分配规则（用于 UI hint） */
  defaultRoleAssignment?: 'first_then_last_then_reference' | 'all_reference' | 'none'
}
```
不把 `rolePolicy` 批量写入 61 个 manifest；默认由 `inferRolePolicy(capability)` 根据 `capability.id`、`input.required`、`input.maxImages` 推断：
- `video.image_to_video` → `{ imageRoles: ['first_frame','last_frame'], defaultRoleAssignment: 'first_then_last_then_reference' }`
- `video.edit` → `{ imageRoles: ['first_frame','last_frame','reference_image'], videoRoles: ['input_video'], defaultRoleAssignment: 'first_then_last_then_reference' }`
- `video.generate`（Seedance 2.0 多模态）→ `{ imageRoles: ['reference_image'], videoRoles: ['reference_video'], audioRoles: ['reference_audio'], defaultRoleAssignment: 'all_reference' }`
- `video.extend` → `{ videoRoles: ['input_video'], defaultRoleAssignment: 'none' }`
- `image.edit` / `image.variations` → `{ imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }`

替换 `CanvasOperationPanel.tsx` 的硬编码 `operationSupportsVideoFrameRoles`，改为读 `capabilitySupportsFrameRoles(selectedCapability)` / `capabilitySupportsImageRoles(selectedCapability)`。

#### 1.3 补 Seedance 2.0 关键参数
`volcengineSeedanceVideoSchema` (`:687-725`) 加：
- `promptExtend: { type: 'boolean', title: '提示词扩展', default: false }` + alias `prompt_extend`
- `webSearch: { type: 'boolean', title: '联网搜索', default: false }`（注意：当前 `searchEnabled` 已有，但要确认 adapter 是否真把它翻译成 `tools:[{type:'web_search'}]`，需查 `volcengine-ark-media.adapter.ts`）

> 验证点：抓官方文档 `https://www.volcengine.com/docs/82379/1520757` 确认参数名（fetch 返回空，需在实现阶段用 apidog.com/blog/seedance-2-0-api 或 GitHub seedance-2.0 仓库的 references/api-workflow.md 交叉验证）。

#### 1.4 补 sourceUrls 深链
- 13 个 `apimart:*` 模型：把 `https://docs.apimart.ai/cn` 替换为 `docs/multimedia-model-platform-adapters-design.md:83-84` 已记录的深链（如 `https://docs.apimart.ai/cn/api-reference/videos/veo3/generation`）
- 5 个 `kling:*` 模型：补 i2v/edit 专属文档 URL
- 3 个 `agnes:*` 模型：补图片/视频 API 专属页（如无深链则保留 overview 但在 UI hint 里说明）
- 2 个 bailian（image-pro / qwen3-tts）：补 API 文档深链

#### 1.5 更新文档
- `docs/multimedia-model-providers.md`：补 Seedance 1.x / Seedream 4.0/5.0 Lite 模型行；移除 PixVerse；补 OpenAI/Google/Omni/Midjourney 参数覆盖表行；刷新「最后核对」日期
- `docs/multimedia-model-platform-adapters-design.md`：补全模型清单；补 rolePolicy 设计说明；刷新日期

**验收**：`pnpm --filter @spark/protocol typecheck` 通过；manifest 单测（如有）通过。

---

### 阶段 2：画布 UI 透明化（renderer 层）

**目标**：用户一眼看到「当前命中哪个 capability、每张图什么角色、图片用量 N/M、默认分配规则」。

#### 2.1 CanvasMediaInputThumb 加 role 徽章 + 未用态
`apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputThumb.tsx`：
- props 加 `role?: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio' | 'unused'`
- props 加 `usageStatus?: 'used' | 'unused' | 'overflow'`（overflow = 超出 maxImages 会被丢弃）
- 缩略图右上角加角色徽章（首帧=「首」、尾帧=「尾」、参考=「参」、视频参=「视」、音频参=「音」）
- `usageStatus='unused'` 时缩略图灰度 + 右下角小标「未使用」
- `usageStatus='overflow'` 时缩略图加红色边框 + 右下角「将被丢弃」
- Popover content 也显示 role 和 usageStatus

调用方改动（`CanvasOperationPanel.tsx:1210-1264` composer、`:1856-1876` panel）：
- 计算 `mediaInputs` 每张图的角色（从 firstFrameNodeId/lastFrameNodeId/referenceFrameNodeIds 反查）
- 未被选中的图标 `usageStatus='unused'`
- 超出 maxImages 的参考图标 `usageStatus='overflow'`

#### 2.2 顶部 capability 标识 + 图片用量 N/M
`CanvasOperationPanel.tsx`：
- 在模型 selector 下方加一行：「当前能力：{selectedCapability.label}（{selectedCapability.id}）· 图片用量 {selectedFrameCount}/{videoFrameMaxImages}」
- 用量条用 antd Progress 或自绘条形（绿→黄→红，超 maxImages 变红）
- panel 模式位置 `:1973-1979`；composer 模式位置 `:1362-1381` 下方
- 当 `selectedFrameCount > videoFrameMaxImages` 时整行变红 + 文案「已选 N 张，超出上限 M 张，M 张将被丢弃」

#### 2.3 三处 hint 文案统一
抽公共组件 `CanvasMediaInputHint`（新文件 `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputHint.tsx`）：
- 输入：`rolePolicy`、`videoFrameMaxImages`、`selectedFrameCount`、`mode`（composer/panel/inline）
- 输出统一文案：「当前模型最多使用 {M} 张图片。{若 rolePolicy.defaultRoleAssignment='first_then_last_then_reference'} 未手动指定时，第一张作为首帧、第二张作为尾帧、其余作为参考图。{end if} 已选 {N} 张。」
- 替换三处：
  - `CanvasOperationPanel.tsx:1844-1851`（panel）
  - `CanvasOperationPanel.tsx:1382-1456` 上方（composer，当前缺失，新增）
  - `CanvasInlineAiComposer.tsx:782-787`（inline）

#### 2.4 capability 切换时的参数字段说明
`CanvasOperationPanel.tsx:1457-1502`（composer）/ `:1996+`（panel）字段渲染处：
- 每个 enum 字段在 hover 时显示「当前模型支持：{enumValues.join(',')}」tooltip
- 当某字段因模型不支持而被裁掉（如 Seedance Fast 不支持 1080p/4k）时，显示 disabled 选项 + 删除线 + tooltip「当前模型不支持」

**验收**：手动在画布上切换 Seedance 2.0 / Fast / Mini / 1.5 Pro，观察用量条、徽章、hint 是否正确变化；`CanvasOperationPanel.test.ts` 加用例。

---

### 阶段 3：画布 UI 拦阻（renderer 层）

**目标**：切换模型/operation 导致 maxImages 收缩时，主动告知 + 清空超额，不再静默丢弃。

#### 3.1 useEffect 监听 maxImages 收缩
`CanvasOperationPanel.tsx` 新增 useEffect（在 `:677` 附近现有 useEffect 群后）：
- 依赖：`videoFrameMaxImages`、`firstFrameNodeId`、`lastFrameNodeId`、`referenceFrameNodeIds`
- 当 `videoFrameMaxImages` 变小且当前已选超过新上限时：
  - 弹 antd `message.warning`：「模型已切换为 {displayName}，最多支持 {M} 张图。已选 {N} 张里 {N-M} 张将被移除。」
  - 按优先级保留：firstFrame > lastFrame > reference（与 `normalizeVideoFrameNodeIds` 一致）
  - 清空超额的 `referenceFrameNodeIds`（setState）
  - 若仍超额，清 `lastFrameNodeId`
  - 若仍超额，清 `firstFrameNodeId`（极端情况）

#### 3.2 提交前校验
`CanvasOperationPanel.tsx` 提交逻辑（`:918-926` runInputNodeIds 构造处）：
- 提交前再校验一次 `explicitFrameNodeIds.length <= videoFrameMaxImages`
- 若不符（理论不应发生，防御性），弹 error 并阻止提交

#### 3.3 无图片角色时的空状态
- 当 capability 不支持图片输入（`capabilitySupportsImageRoles=false`）时，media strip 显示空状态文案「当前能力不支持图片输入，仅文本提示词」

**验收**：在画布上选 Seedance 2.0（maxImages=2 for image_to_video）→ 选 2 张图 → 切到 1.0 Pro（maxImages=2，不变）→ 切到 Seedance 1.5 Pro image_to_video（maxImages=2）→ 切到 text_to_video（maxImages=9 but rolePolicy=all_reference）→ 切回 image_to_video，观察 toast 和清空行为。

---

### 阶段 4：MCP/skill 链路统一（agent-runtime 层）

**目标**：spark_media MCP 的 `generate_video`/`generate_image` 工具 schema 也由 manifest 驱动，系统 prompt 强制 agent 告知图片上限。

#### 4.1 工具 schema 动态生成
`packages/agent-runtime/src/tools/media-generation-mcp-server.mjs`：
- `generate_video` / `generate_image` / `edit_image` 的 `inputSchema` 不再静态写死 enum
- 改为：保留通用字段（prompt/model/capability/inputImages/firstFrame/lastFrame/referenceImages/inputVideos/filename/extraJson）
- 模型相关字段（aspectRatio/resolution/durationSeconds/generate_audio 等）的 enum 改为「宽松接受 + 运行时按 manifest 裁剪」：
  - schema 里声明字段类型（string/integer/boolean）但 enum 留空或写超集
  - handler 调用 `pruneModelParamsByManifest`（已存在 `:37`）裁剪未知字段
  - 在字段 description 里写「实际可用值请调 describe_model 查询」
- 扩展现有 `describe_model`：返回 capability 原始 `input.maxImages`、`rolePolicy`、`paramSchema` 三件套，方便 agent 一次性拿到 UI 所需信息

#### 4.2 系统 prompt 强化
`packages/agent-runtime/src/services/session.service.ts` `buildMediaGenerationSystemPrompt`：
- 加一段强制指令：「调用 generate_video/generate_image/edit_image 前，必须先调 describe_model 获取当前模型的 maxImages、rolePolicy 和参数 schema，并在回复里明确告知用户：①当前模型支持多少张图 ②支持哪些角色（首帧/尾帧/参考图/参考视频/参考音频）③未指定时的默认分配规则。若用户提供的媒体数量超过 maxImages，必须主动提示并询问保留哪些。」

#### 4.3 preset 加 inputConstraints 快照（可选，低优先）
`apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts:88-97` `CanvasOperationPreset`：
- 加可选字段 `inputConstraints?: { maxImages: number; supportedRoles: string[] }`
- 保存 preset 时记录当前模型的约束快照（仅用于离线展示「该 preset 当初是基于 maxImages=N 的模型」）
- 加载 preset 时不依赖此字段（仍运行时查 manifest），仅作提示

**验收**：在对话里让 agent 调 spark_media 生成视频，确认 agent 主动告知图片上限和角色规则；`media-adapters.test.ts` 加动态 schema 用例。

---

## 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| rolePolicy 字段新增导致 protocol 版本不兼容 | 中 | 字段全可选，旧 manifest 不填也不报错；UI 回退到硬编码 |
| MCP schema 改为宽松 enum 后 agent 传非法值 | 中 | handler 已有 `pruneModelParamsByManifest` 裁剪；加运行时校验 + 错误返回 |
| 阶段 3 useEffect 误清空用户选择 | 高 | 严格依赖 `videoFrameMaxImages` 变化才触发；加 ref 记录上次值，仅在值真的变小时触发；先在测试覆盖 |
| Seedance 2.0 官方参数名 fetch 失败导致补错 | 中 | 实现阶段用 apidog.com/blog/seedance-2-0-api + GitHub seedance-2.0 仓库 + manifest 现有 alias 三方交叉验证 |
| 文档更新遗漏 | 低 | 每阶段结束顺手刷新 `docs/multimedia-model-providers.md` 和 design doc 的「最后核对」日期 |

回滚策略：4 个阶段相互独立，每阶段一个 PR，出问题可单独 revert。阶段 1（manifest）是其他阶段的基础，优先合并。

## 验证方式

- **阶段 1**：`pnpm --filter @spark/protocol typecheck` + manifest 单测
- **阶段 2/3**：`pnpm --filter desktop typecheck` + `CanvasOperationPanel.test.ts` + 手动画布冒烟（切换 Seedance 2.0/Fast/Mini/1.5 Pro/1.0 Pro 各模型 × image_to_video/video_edit/text_to_video 各 operation）
- **阶段 4**：`pnpm --filter @spark/agent-runtime test` + `media-adapters.test.ts` + 对话式冒烟（让 agent 调 spark_media 生成视频，确认它主动告知图片上限）
- **GitNexus**：每个阶段 commit 前跑 `gitnexus_detect_changes()` 确认影响范围；改 `CanvasOperationPanel` / `media-generation-mcp-server` / `media-model-manifest` 前先跑 `gitnexus_impact` 看 blast radius

## 实施顺序建议

1. **阶段 1**（manifest 配置补足）—— 先行，1 天，无 UI 风险，可独立合并
2. **阶段 2**（UI 透明化）—— 1.5 天，依赖阶段 1 的 rolePolicy
3. **阶段 3**（UI 拦阻）—— 0.5 天，依赖阶段 2
4. **阶段 4**（MCP 链路）—— 1 天，可与阶段 2/3 并行

总计约 4 天。建议阶段 1 单独 PR 先合，阶段 2+3 一个 PR，阶段 4 一个 PR。
