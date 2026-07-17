# 画布文本输出预算与模型能力自适应设计

> 状态: 实施中 | 最后核对: 2026-07-18

## 背景

画布文本任务当前把 Provider 上下文窗口的 85% 当作候选单次输出上限。当 Provider 没有配置 `maxOutputTokens` 时，200K 默认上下文会派生出 `max_tokens=170000`，即使模型的单次最大输出只有 128K、64K 或更低。

上下文窗口表示模型在一次请求中可容纳的输入和输出总量；`max_tokens` / `max_output_tokens` / `max_completion_tokens` 表示单次输出上限。两者不能通过固定比例互相推导。

另一个旧兜底是 `DEFAULT_MAX_TOKENS = 4096`，对画布内的常规生成、改写、剧本和分镜任务过低，容易导致内容过早停止。

## 目标

- 删除“上下文窗口 × 85% = 默认输出”的推导。
- 把画布文本调用的底层绝对默认值从 4K 提高到 16K。
- 按任务语义选择 16K / 32K / 64K 常规输出档位，保留用户显式请求最高 128K 的能力。
- Provider 未配置最大输出时，通过有界降档重试和模型级能力缓存学习安全值。
- 错误文本解析只作为加速学习的可选信号，不假设各渠道返回相同格式。
- 保留上下文剩余空间校验，但它只负责防止输入加输出越界。

## 非目标

- 不在本期把长剧本改造为分章、分场生成流程。
- 不在本期实现通用自动续写和长文本合并。
- 不通过发起额外的计费生成请求主动探测模型能力。
- 不保证从只有泛化 HTTP 400 的不透明渠道中推断出真实上限。

## 输出档位

底层生成器的 `DEFAULT_MAX_TOKENS` 设为 `16_384`。所有没有通过画布预算器的文本调用也不会退回 4K。

画布任务的默认期望输出为：

| 档位 | Tokens | 适用任务 |
| --- | ---: | --- |
| 常规最低档 | 16,384 | 提示词优化、摘要、说明和其他轻量文本 |
| 标准档 | 32,768 | 通用文本生成、改写、扩写 |
| 长文本档 | 65,536 | 剧本、分镜 JSON、长表格和明确的超长内容任务 |
| 显式超长档 | 131,072 | 用户或预设明确提出的超长输出，不作为普通默认 |

档位表示本次任务“期望最多生成多少”，不表示模型一定会生成到该长度。

## 预算模型

预算器分离三个概念：

1. `desiredMaxTokens`：根据用户覆盖或任务档位得到的期望输出。
2. `knownOutputCap`：从已学习缓存、Provider 配置或内置能力表得到的模型输出上限。
3. `remainingContextTokens`：当前输入占用后仍可用的上下文空间。

上下文安全余量固定使用 `16_384` tokens，不再使用 15% 比例：

```text
remainingContextTokens = contextWindow - promptTokensEstimate - 16_384

effectiveMaxTokens = min(
  desiredMaxTokens,
  knownOutputCap ?? desiredMaxTokens,
  remainingContextTokens
)
```

当 `remainingContextTokens <= 0` 时，请求在本地失败并明确提示输入已占满上下文，不再把输出强制改为 1 token 后发给 Provider。当剩余空间低于 16K 但仍为正数时，允许为避免上下文越界而使用低于常规最低档的实际值，并记录来源为 `context_remaining`。

## 模型输出能力来源

`knownOutputCap` 按以下优先级解析：

1. 当前 `providerProfileId + endpoint + model + apiKind` 对应的已学习安全值。
2. Provider Profile 显式配置的 `maxTokens`。
3. 内置模型能力表中的最大输出。
4. 未知；直接使用任务的 `desiredMaxTokens` 作为首次尝试值。

用户的 `requestedMaxTokens` 是任务期望值，不是模型能力证明，不得覆盖已学习或显式配置的更小模型上限。

## 输出上限错误归一化

新增纯函数错误分类器，同时检查：

- 结构化字段：`error.param`、`error.code`、`error.type`、顶层 `param/code/type`。
- 参数名：`max_tokens`、`max_output_tokens`、`max_completion_tokens`及常见驼峰形式。
- 语义特征：只在同时出现输出 token 参数和“超过、最大值、上限、above maximum、less than or equal”等含义时归类为上限错误。
- 数字提取：仅当数字与上述参数或上限语义在同一局部片段时，才将其视为精确上限。

分类器返回：

```ts
type OutputLimitError =
  | { kind: 'output_limit'; exactLimit: number; evidence: string }
  | { kind: 'output_limit'; evidence: string }
  | { kind: 'other' }
```

只有 `kind='output_limit'` 可触发自动降档。无法识别原因的泛化 HTTP 400 保持失败，不猜测、不掩盖真实错误。

## 有界降档重试

降档序列为：

```text
131,072 → 65,536 → 32,768 → 16,384 → 8,192 → 4,096
```

规则：

1. 若错误含可信精确上限，下一次直接使用 `min(exactLimit, desiredMaxTokens, remainingContextTokens)`。
2. 若只能确认输出上限错误，下一次使用降档序列中严格小于当前值的第一档。
3. 同一任务最多进行 5 次降档重试，且每次值必须严格减小，避免循环。
4. 降档只复用同一 Provider、endpoint、model、prompt 和其他参数，仅修改输出 token 上限。
5. 任何非上限错误立即结束重试链。

降档失败是参数校验阶段的快速 HTTP 4xx，不发起一次成功后再丢弃结果的额外生成。任务详情记录尝试值和降档原因。

## 能力缓存

缓存键：

```text
providerProfileId + normalizedEndpoint + model + apiKind
```

缓存值包含：

```ts
type LearnedOutputCapability = {
  safeMaxOutputTokens: number
  learnedFrom: 'exact_error_limit' | 'successful_downgrade'
  learnedAt: string
  expiresAt: string
}
```

- 只有在确认为输出上限错误后得到的精确值，或降档后成功的值，才写入缓存。
- 同一键后续观测到更低上限时只向下修正，适配 NewAPI 同模型后方渠道能力不一致的情况。
- 缓存默认有效期 7 天。Provider endpoint、模型列表或模型映射在本地发生变化时清理相关键。
- 缓存值是“已观测安全值”，不声称是模型真实理论最大值。到期后恢复按任务档位尝试，允许上游升级后重新学习更高能力。

## 运行诊断

任务 `rawResponse` 和主进程日志增加：

- `desiredMaxTokens`
- `effectiveMaxTokens`
- `maxTokensSource`
- `remainingContextTokens`
- `learnedOutputCap`
- `outputLimitRetryCount`
- `outputLimitAttempts`
- `outputLimitEvidence`

错误证据只保留脱敏、截断后的参数校验摘要，不记录 API Key、完整 prompt 或上游响应中的敏感字段。

## 模块边界

- `canvasTextTaskDiagnostics.ts`：任务期望档位、上下文剩余计算和诊断数据。
- 新建独立能力模块：错误归一化、降档序列、缓存键与读写，避免继续扩大已经很长的 `apps/desktop/src/main/ipc/index.ts`。
- `canvas-text-generator.ts`：底层绝对默认值提高到 16K，保持单次 Provider 调用与错误详情返回。
- 画布文本 IPC 编排层：调用预算器，执行有界降档并汇总诊断。
- Provider Profile 的手动 `maxTokens` 继续保留，作为明确的运维覆盖值。

## 错误处理

- 输入已占满上下文：本地失败，提示缩减输入或选用更大上下文模型。
- 可识别且可降档的输出上限错误：在后台任务内静默重试，任务节点保持运行中。
- 降至 4K 仍被拒绝：失败并显示各次尝试值，提示检查模型映射或手动 Provider 上限。
- 泛化 400、认证、额度、超时和其他错误：不触发 token 降档。

## 测试与验收

- 预算单测覆盖 16K / 32K / 64K / 128K 档位和用户显式覆盖。
- 验证上下文剩余计算为 `contextWindow - prompt - 16K`，不再出现 85% 派生输出。
- 底层生成器在缺省 `maxTokens` 时发送 16,384。
- 错误分类覆盖 Anthropic、OpenAI-compatible、NewAPI 嵌套错误、纯文本错误和无关 400。
- 可信精确上限使 170K 直接降到 128K；无数字上限错误使 64K 降到 32K。
- 非 token 错误不重试；重试次数和严格降序受测试保护。
- 降档成功后同一模型的下一个任务直接使用缓存值。
- Provider endpoint 或模型配置变更后相关缓存失效。
- 定向 Vitest、desktop 和 agent-runtime TypeScript 类型检查、ESLint 与 `git diff --check` 通过。

## 迁移与兼容

- 删除对 `CANVAS_TEXT_CONTEXT_RESERVE_RATIO = 0.15` 和 `context_window_derived` 作为输出默认来源的依赖，诊断字段迁移为固定安全余量和剩余上下文。
- 保留现有 `modelParams.maxTokens` / `modelParams.max_tokens` 输入兼容。
- 旧 Provider 不需要补写 `maxTokens`；首次遇到上限错误时自动学习。
- 平台官方 Provider 现有 128K 上限作为已知能力继续生效，但不再与 1M 上下文窗口混为同一概念。

