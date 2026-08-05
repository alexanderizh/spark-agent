# 多媒体参数契约与画布画幅失效联合复核报告（2026-08-04）

> 状态: 已落地 | 最后核对: 2026-08-05（落地进展见文末附录）

## 一、结论

两份原文不是同一个问题，但确实属于同一条“媒体参数契约没有保持一致”的链路：

1. “画幅/时长选择失效”是一个已经被源码和回归测试复现的具体运行时缺陷，发生在 H3 画布提交链路。
2. “Schema 治理审计”描述的是更大的系统性问题：manifest schema、defaults、paramPolicy、adapter 消费字段和输入角色之间缺少可验证的一致性约束。
3. H3 缺陷是这类系统性问题的一个典型实例，但不能把全局治理问题简化成一个 compiler bug，也不能把审计报告中的估算数字当成已证实事实。

当前最准确的判断是：

> H3 的用户参数失效真实存在，止血修复已经在 c65b657d5 落地；公共 compiler 的 defaults 未做 canonical 归一化也真实存在，并且会产生同义字段并存。但 H3 的最终故障是“compiler defaults 归一化缺口 + H3 仍使用原生字段名 + 专用 adapter 旧实现只读取原生字段”的组合问题。全局审计中的部分问题真实，部分表述过度，部分数字需要作废并重新统计。

## 二、复核范围与证据等级

本次复核只读源码、当前测试和 Git 历史，没有修改业务代码。核对了：

- media-request-compiler.ts 的 alias、defaults 合并、schema 过滤和 provider 映射。
- 画布提交前 prune、IPC 传递和 Router/adapter 调用路径。
- MiniMax H3 manifest、schema、validator、专用 adapter 与回归测试。
- MiniMax、Bailian、Google、OpenAI、Agnes 的代表性 schema/adapter 对照。
- 当前内置 manifest 的精确统计：159 个 manifest、335 个 capability、126 个显式 strict:true、209 个未声明 paramPolicy、134 个 additionalProperties:false。

“已证实”表示当前源码可以直接证明；“待核对”表示需要再对供应商官方文档或真实 provider 请求确认；“不成立/需改写”表示原文结论超过了源码证据。

## 三、H3 画幅/时长失效：问题真实存在

### 3.1 当前链路

画布提交时先根据 schema 字段和自定义参数构造 raw 参数，再调用 pruneModelParamsForCanvas。相关代码在：

- CanvasInlineAiComposer.tsx:780-811：合并 schema 参数与 customParams，并调用 prune。
- apps/desktop/src/main/ipc/index.ts:3519-3533：调用 compiler，并把 result.providerParams 返回为 prunedModelParams。
- apps/desktop/src/main/ipc/index.ts:3662-3675：创建媒体任务时把已裁剪的 modelParams 传入 runtime，并由画布选项跳过二次严格校验。

H3 的 i2v manifest 仍使用 provider 原生字段：

    paramSchema: minimaxH3VideoSchema
    defaults: { duration: 5, resolution: '2K', ratio: 'adaptive', aigc_watermark: false }

schema 在 packages/protocol/src/media-model-shared-manifest-parts.ts:326-346 声明的是 duration、ratio，不是 durationSeconds、aspectRatio。

### 3.2 compiler 的确定性缺陷

packages/agent-runtime/src/services/media/media-request-compiler.ts 当前逻辑是：

    const canonicalFromRaw = normalizeCanonicalParams(rawParams)
    const defaults = mergeDefaults(providerDefaults, capability.defaults)
    const merged = { ...defaults, ...canonicalFromRaw }

其中：

- CANONICAL_ALIASES_FALLBACK 在 :94-106 把 ratio 改成 aspectRatio，把 duration 改成 durationSeconds。
- normalizeCanonicalParams 在 :209-215 只处理输入 raw。
- mergeDefaults 在 :217-222 只是浅合并，不处理 defaults。
- toProviderParams 在 :470-475 只按显式 aliases 做一次映射。

使用当前真实 H3 manifest、输入 { ratio: '3:4', duration: 10 } 做只读编译检查，得到：

    {
      "duration": 5,
      "resolution": "2K",
      "ratio": "adaptive",
      "aigc_watermark": false,
      "aspectRatio": "3:4",
      "durationSeconds": 10
    }

也就是说，同义键并存不是推测，而是当前 compiler 的确定性输出。由于 H3 没有 paramPolicy，这两个 canonical 别名字段还会收到 compat_passthrough 警告并保留。

### 3.3 为什么旧版 H3 adapter 会发错

H3 专用 adapter 在 c65b657d5 之前只读取 raw.ratio 和 raw.duration。当画布把 compiler 输出写回任务后：

    {
      ratio: 'adaptive',
      aspectRatio: '3:4',
      duration: 5,
      durationSeconds: 10
    }

旧 adapter 读取到的就是默认值 adaptive 和 5，所以最终请求体中的画幅和时长不随用户选择变化。

这不是“所有 adapter 都直接拿到 compiler 内部对象”，而是当前画布路径把 compiler 的 providerParams 作为任务 modelParams 继续传递给专用 adapter。这个边界必须在后续设计中明确。

### 3.4 止血修复状态

c65b657d5 已修改 buildMinimaxV2VideoParams：

- 对 manifest aliases 做归一。
- 读取 aspectRatio ?? aspect_ratio ?? ratio。
- 读取 durationSeconds ?? duration。
- 对 resolution 保持 768P/2K 枚举兜底。

当前测试已覆盖“compiler 结果中四个字段并存”的现场。复核命令结果：

    media-request-compiler.test.ts       20 passed
    minimax-hailuo-media.adapter.test.ts 20 passed
    总计                                40 passed

回归用例确认 H3 最终请求体为 ratio: '3:4'、duration: 10。因此：

- H3 用户侧 bug：已确认存在，当前止血修复已覆盖。
- compiler defaults 不归一：仍存在，尚未根治。
- 当前未做桌面端真机/真实 provider E2E，本报告不宣称 E2E 已通过。

## 四、Schema 治理审计：哪些问题真实，哪些需要改写

### 4.1 P0：manifest 声明了能力，但 adapter 不支持——真实存在

MiniMax adapter 的 capabilities 集合只包含图片和视频，packages/agent-runtime/src/services/media/adapters/minimax-hailuo-media.adapter.ts:84-106 没有 audio.speech 或 audio.music。

但 manifest 声明了：

- minimax:speech-2.8-hd → audio.speech
- minimax:speech-2.8-turbo → audio.speech
- minimax:music-2.6 → audio.music

这三个 capability 进入 MiniMax adapter 会命中 capability_not_supported。

Bailian 也存在同类问题：bailian:qwen3-tts-flash 在 bailian-media-model-manifests.ts:1448-1484 声明 audio.speech，但 Bailian adapter 的能力列表只有图片和视频。因此原审计报告所说的“至少四个音频 capability 看起来可用、运行时报能力不支持”是成立的。

这是最高优先级的功能断裂，和参数警告/剔除不是一个优先级。

### 4.2 P1：声明与消费错位——多项真实，但原文个别描述过度

#### Google Veo seed：真实存在

veoSchema 在 google-media-model-manifests.ts:259-273 没有 seed；Google adapter 的 googleVideoParams 在 google-generative-ai-media.adapter.ts:665-682 会读取 seed，随后 filterByManifestSchema 按 schema 过滤。

Veo 还使用 strict:true。因此 seed 在当前 manifest contract 下不会进入最终请求。共享文件中的 googleVeoVideoSchema 虽然声明了 seed，但当前 Veo manifest 没有使用它。这是“声明了共享 schema，但实际 manifest 没用”的死配置/错接问题。

#### OpenAI image.edit mask：模型参数入口确实是死的

OpenAI image.edit schema 在 openai-media-model-manifests.ts:86-100 声明了 mask: string，但官方 adapter 的 openAiImageParams 在 openai-official-media.adapter.ts:304-325 没有读取 mask。

adapter 支持的是另一条输入文件路径：当 inputFiles 中存在 role: 'mask' 时，在 :97-105 组装 multipart 的 mask 文件。因此：

- UI 的 mask 文本参数不是有效的遮罩传递方式；
- 文件角色 mask 仍然是有效路径；
- 原文“mask 字段死掉”成立，但应明确它是参数字段与输入角色模型不一致，不是 OpenAI 所有 mask 能力都失效。

#### Agnes width/height：消费字段未声明，真实存在

Agnes video schema 在 media-model-shared-manifest-parts.ts:461-490 没有 width、height；Agnes adapter 的视频请求却直接构造顶层 width、height，并在 extraAllowed 白名单中接收这两个字段。

因此这是“adapter 可消费、UI/schema 没有正式入口”的声明缺口。它是否被具体 provider 接受，还需要按 Agnes 当前官方接口复核，不能仅凭 adapter 消费就断言 provider 合法。

#### MiniMax callback_url：代码契约缺口真实，provider 合法性待核对

MiniMax H3 adapter 在 minimax-hailuo-media.adapter.ts:560-561 读取 callback_url/callbackUrl，但 H3 schema 没有声明该字段。V1 路径也存在类似读取。

可以确认的是“adapter 消费字段未进入 manifest contract”；不能仅凭这段源码确认所有 MiniMax 模型都支持 callback_url。后续应按模型和官方文档分别决定：正式声明、禁止，或从 adapter 移除。

#### Bailian HappyHorse r2v capability id：语义错误真实存在，但“完全走不到 reference 分支”不准确

happyhorse-1.1-r2v、happyhorse-1.0-r2v 的 manifest 在 bailian-media-model-manifests.ts:1271-1287、:1331-1347 写成了 video.image_to_video，而模型名和文档 URL 明确是 reference-to-video。

这会影响 capability 选择、输入角色和画布 UI 语义。不过 Bailian adapter 的 buildVideoMedia 同时检查 model id 是否含 r2v，因此当前专用 adapter 仍可能走 reference 分支。准确结论是“公共 capability contract 错误，功能可能被隐藏/误路由”，不是“adapter 一定永远走不到 reference 分支”。

#### HappyHorse 的 prompt_extend/audio_setting：需按模型拆分，不能全归为一个 bug

HappyHorse schema 没有 prompt_extend，视频 adapter 的通用 videoParameters 却会从输入中 pick prompt_extend 和 audio_setting。这证明存在跨模型参数泄漏风险；但 audio_setting 对 HappyHorse video edit、prompt_extend 对 Wan 等模型可能是合法字段。

应改为按 manifest/model capability 精确声明和过滤，不能用一个 Bailian 视频通用 pick 列表覆盖全部模型。

### 4.3 customParams：风险真实，但“无条件直发 provider”不准确

buildCustomModelParams 在 CanvasInlineAiComposer.tsx:2330-2355 只做类型转换和对象赋值，重复 key 后者覆盖前者，本身没有 schema 语义校验。

但有 manifest 的画布提交会继续经过 pruneModelParamsForCanvas 和 compiler：

- strict capability 会丢弃未知字段；
- additionalProperties:true 或无 policy 的 capability 会兼容透传标量；
- 专用 adapter 还可能只 pick 自己认识的字段，未知字段随后被忽略。

因此真实风险是：customParams 可以把未声明字段送入 contract pipeline，且重复 key 可覆盖正式控件；最终是否到 provider 取决于 policy 和 adapter。不能笼统说“任意字段都直接发给所有 provider”。

### 4.4 P2：死代码/重复 manifest——部分真实

已确认：

- googleImageParamPolicy、googleImageSchema、googleVeoVideoSchema 在 shared 文件中定义，但当前源码没有被实际 manifest 使用。
- googleOmniVideoSchema 并非无人引用，它被 omni-media-model-manifests.ts 使用；原审计把四个 export 都列为无人引用不准确。
- google-generative-ai:gemini-omni-flash-preview 与 omni:gemini-omni-flash-preview 以及 APIMart 同名模型 id 并存。当前 manifest catalog 至少存在同 modelId 的多来源条目，是否重复展示要结合 resolver/provider profile 过滤确认，但重复配置本身真实。
- packages/protocol/src/media-model-manifest.ts 当前 3456 行，超过项目 3000 行约束，后续继续追加 manifest 有维护风险。

Seedream alias 过滤、Seedance 1.x priority 等问题本次只做了文本检索，没有逐 capability 对照 provider 文档，暂不升格为已确认缺陷。

## 五、审计报告原有统计的处理

原审计报告中的“约 243 capability、约 145 strict、约 95 裸奔”不能继续作为本项目事实使用。对当前内置清单直接统计得到：

| 项目                                  | 当前源码统计 |
| ------------------------------------- | -----------: |
| 内置 manifest                         |          159 |
| capability                            |          335 |
| 显式 paramPolicy.strict === true      |          126 |
| 未声明 paramPolicy                    |          209 |
| schema additionalProperties === false |          134 |

差异可能来自旧索引、把 provider/profile capability 与 manifest capability 混算、共享常量展开方式不同，或审计时的估算口径不同。后续治理必须以可重复脚本按 manifest → capability 逐条输出，不再使用手工估算总数。

## 六、根因模型

当前问题不是一个层面的“schema 漏字段”，而是四个契约层没有形成闭环：

    UI/schema 字段
        ↓
    raw modelParams
        ↓  alias / defaults / policy
    公共 compiler
        ↓
    canvas prune 或 adapter preflight
        ↓
    专用 adapter / template adapter
        ↓
    provider 原生请求体

主要断点：

1. alias 归一只处理 raw，不处理 defaults，导致同义键并存。
2. fallback alias 是全局启发式规则；ratio、duration 等 provider 原生字段与 canonical 别名发生语义冲突。
3. capability 没有强制要求“schema 字段、defaults、aliases、adapter 消费字段”一致。
4. 专用 adapter 与 template/compiler 的边界不统一：有的 adapter 消费 canonical，有的消费 provider 原生字段，有的自己再做 aliases。
5. customParams 是没有领域语义的逃生舱，在兼容模式下会扩大未知字段透传面。
6. manifest 和 adapter 的能力集合没有做启动期一致性校验，造成音频能力“可展示但不可执行”。

## 七、风险

### P0 风险：能力展示与真实执行不一致

音频四个 capability 是直接报错型问题，影响用户对平台可用性的基本判断。

### P1 风险：参数“看似成功”但实际被覆盖、丢弃或忽略

画幅、时长、seed、mask、width/height、callback_url 都可能出现：

- UI 有控件但 provider 没收到；
- provider 收到默认值而不是用户值；
- schema 认为合法但 adapter 不消费；
- adapter 会消费但 UI/schema 没有可见入口；
- 兼容透传把其他模型字段送入当前模型。

### P1 风险：贸然全局 strict 或全局剔除

在未完成 capability 级契约核对前直接严格剔除，会把当前依赖兼容透传的合法字段一起删除；直接上“未声明字段警告”，又会把 adapter 已经消费但 schema 未声明的合法/候选字段全部误报，最终让用户忽略警告。

### P2 风险：维护规模和回归成本

335 个 capability 不能依赖人工记忆。3456 行主 manifest 继续增长会让 schema、defaults、adapter、测试之间更难做完整审查。

## 八、最佳改进方案

### 阶段 0：先恢复事实基线

1. 保留 H3 止血修复和当前回归测试。
2. 增加一个只读 manifest contract audit 脚本，输出每个 capability 的：
   - schema properties；
   - defaults keys；
   - capability aliases；
   - paramPolicy；
   - invocation/template 使用字段；
   - 专用 adapter 消费字段；
   - 双向 diff。
3. 把“源码已证实”“官方文档已证实”“待核对”三种状态写进审计输出。

### 阶段 1：修 P0 能力断裂

MiniMax 和 Bailian 音频应二选一：

- 在 adapter 真正实现前，从 manifest/provider preset 中移除并明确标记不可用；
- 或实现对应 audio adapter，并补请求、错误、产物和能力路由测试。

不能继续让 manifest 作为“可用能力目录”展示一个必然抛 capability_not_supported 的能力。

### 阶段 2：统一 canonical contract，根治 H3

推荐的落地形态：

1. 内部统一使用 aspectRatio、durationSeconds、generateAudio 等 canonical key。
2. H3 schema 改用 canonical key，defaults 也改为 canonical key。
3. H3 capability 显式配置：

   aliases: {
   aspectRatio: 'ratio',
   durationSeconds: 'duration',
   aigcWatermark: 'aigc_watermark',
   }

4. compiler 对 provider defaults、capability defaults、用户 raw 使用同一个 canonical normalization 流程，再按优先级合并：

   provider defaults < capability defaults < explicit user params

5. canonical → provider alias 只在最后发生一次，输出中不得同时存在 ratio 与 aspectRatio、duration 与 durationSeconds。
6. 对没有显式 alias 的旧/自定义 manifest，不要强行把 provider 原生字段套入全局 fallback alias；应保留兼容模式并给出明确诊断。

方案 B“defaults 也归一化”是必要修复，但不能只改一行。必须同步补 H3 manifest aliases，并验证所有使用 ratio、duration、output_format 等字段的 capability，否则可能把现有 provider 原生字段误改成另一套语义。

### 阶段 3：让 adapter 与 compiler 只有一个参数契约

选择并固定一种边界：

- 要么 Router 编译一次，把 canonical/provider params 作为显式上下文传给 adapter；
- 要么每个专用 adapter 在内部统一调用 compiler，并只消费 compiler 输出的规范结构。

禁止同一字段在 UI、compiler、adapter 各自维护一套 fallback 读取顺序。H3 当前的多别名防御可以保留作为兼容层，但不应成为长期架构。

### 阶段 4：按 capability 收紧 policy

收紧顺序应是：

1. 先完成 P0 capability 对齐；
2. 再修 schema ↔ adapter 的 P1 双向 diff；
3. 为确实支持的兼容字段补 schema/aliases/passthrough allow；
4. 最后按 capability 开启 strict:true；
5. 首期只做可解释的 warning/drop 诊断，不做全局无条件剔除。

### 阶段 5：治理 customParams 与 manifest 规模

- 同名 custom key 与正式控件冲突时，在 UI 显示覆盖提示并记录来源。
- 未声明字段在兼容模式下保留，但明确标注“兼容透传，未由 manifest 验证”。
- strict 模式下展示 droppedParams 和原因，避免用户误以为参数生效。
- 将 media-model-manifest.ts 按厂商/协议拆分，保留统一聚合入口。
- 对重复 modelId 以 providerProfileId + manifestId 作为选择键，避免跨 provider 歧义。

## 九、交付与后续任务边界

本次仅合并和修正文档，没有修改业务代码，也没有改变 c65b657d5。

建议后续拆成三个独立变更：

1. fix(media): remove or implement unsupported audio capabilities
2. fix(media-compiler): normalize defaults and canonicalize H3 contract
3. chore(media): generate capability contract audit and split manifest catalog

每个变更都应有聚焦测试，并在复杂跨模块修改完成后更新 docs/ 文档、重新分析 GitNexus 索引；当前会话没有可用的 GitNexus MCP，因此本次按项目降级规则使用源码、测试和 Git 历史核对。

## 十、复核依据索引

- packages/agent-runtime/src/services/media/media-request-compiler.ts:94-106,135-137,209-222,470-475
- apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx:780-811
- apps/desktop/src/main/ipc/index.ts:3519-3533,3662-3675
- packages/protocol/src/media-model-manifest.ts:3366-3425
- packages/protocol/src/media-model-shared-manifest-parts.ts:319-380,461-490
- packages/agent-runtime/src/services/media/adapters/minimax-hailuo-media.adapter.ts:84-106,523-562
- packages/protocol/src/bailian-media-model-manifests.ts:1271-1347,1448-1484
- packages/agent-runtime/src/services/media/adapters/bailian-media.adapter.ts:16-60,250-300,585-625
- packages/protocol/src/google-media-model-manifests.ts:259-334,383-440
- packages/agent-runtime/src/services/media/adapters/google-generative-ai-media.adapter.ts:665-710
- packages/protocol/src/openai-media-model-manifests.ts:86-100,175-205
- packages/agent-runtime/src/services/media/adapters/openai-official-media.adapter.ts:97-105,304-325

---

## 附录：后续落地进展（2026-08-05 更新）

> 本节为 2026-08-05 追加。正文（一~十节）是 2026-08-04 的历史复核快照，保持原样；此处登记之后实际落地的修复，便于读者对照当前代码状态。状态行的「已落地」指复核结论本身成文，**不代表正文所有问题均已修复**——各项真实进展见下表。

| 第九节建议 / 报告条目 | 进展 | 对应改动 |
|---|---|---|
| 建议 2 normalize defaults and canonicalize H3 contract（§3.2 compiler 确定性缺陷） | **已落地** | commit `7feec56f8`：`mergeDefaults` 对 providerDefaults / capabilityDefaults 各走 `normalizeCanonicalParams`，根除「defaults 用原生 key、raw 经归一变 canonical 导致同义键并存」根因。commit `1e0aea4a0`：H3 与 bailian HappyHorse 的 schema 属性 + defaults 统一到 canonical key，使 schema 校验对这些字段从失效转为生效。 |
| 建议 3 generate capability contract audit | **已落地** | 新增 `media-manifest-parameter-audit.test.ts`，把 aliases 方向反转（硬卡 0）、defaults/schema 原生 fallback key、重复 modelId 固化为 CI 检查，baseline 只降不升；compiler 导出 `CANONICAL_ALIASES_FALLBACK` 作单一真相源。 |
| defaults 非必需高阶参数治理（§4.2） | **已落地** | commit `b4d3aaeaf`：火山 Seedance/Seedream、MiniMax、Bailian、OpenAI、APIMart、腾讯清理非必需 defaults（`seed:-1` 哨兵、`watermark`/`thinking_mode`/`prompt_extend` 等高阶开关），保留画幅/时长/分辨率/尺寸/数量等通用字段；Seedance seed schema 从 `minimum:-1` 收紧为 `minimum:0`。provider 自有默认兜底，移除字段仍在 schema 声明，用户手设能力完整。 |
| 建议 1 remove or implement unsupported audio capabilities（§4.1 P0） | **未处理 / 已降级** | 复核确认这 4 个音频能力由 template adapter 按 manifest 模板执行，不会抛 capability_not_supported；真实风险是模板路径缺 adapter 的错误映射，降级为 P1，留待后续。 |
| 阶段 4 按 capability 收紧 paramPolicy（全局 strict） | **未完成 / 已收为 baseline** | strict 的阻塞前置是「schema 属性仍用原生 fallback key（审计 baseline 当前 83 处）」，开启 strict 会丢这些字段。当前靠 non-strict 兼容透传 + 各专门 adapter 的 canonical→原生兜底读取维持工作，**不影响正常使用**；需先逐 provider 统一 schema key 后才能开 strict，属后续独立工程。 |
| §4.4 重复 modelId / dead code | **部分登记** | 重复 modelId（原厂与 APIMart 并存，10 处）已纳入审计 baseline 硬卡；Google 共享死配置常量未清理。 |

> `c65b657d5` 的 H3 adapter 多别名兜底（`aspectRatio ?? ratio` 等）作为防御性读取保留，与 Phase 1 的 compiler 根治互不冲突——前者兼容不经 compiler 的入口（custom manifest / 历史任务 / 画布直传 / adapter 直调），后者根治 compiler 路径的同义键并存。
