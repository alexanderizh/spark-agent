/**
 * spark-auto 危险性评估分类器（宿主侧）。
 *
 * spark 引擎的 auto 权限档对「参数含命令串」的工具调用做危险筛查：正则快速
 * 通道（引擎自持 danger-rules）拦已知高危，灰色地带命令经本服务交给 LLM 模型
 * 判定（对标 claude SDK auto-mode classifier / codex guardian auto_review）。
 * 判定 dangerous → 引擎返回 ask → 落入既有审批弹卡链路人工确认。
 *
 * 降级策略：**fail-closed** —— 模型不可用/超时/响应格式异常一律映射为
 * dangerous（弹卡注明「安全审查服务暂不可用」），故障期安全不缩水；例外是
 * 轮次本身已被取消（signal aborted），此时返回 unavailable 交还引擎兜底，
 * 不再为一条已取消的轮次弹卡。
 *
 * 依赖注入对 db/session.service 零依赖：工厂只吃 `ModelService['complete']`
 * 绑定（自动获得模型回退链：settings 抽取键 → 当前会话对话模型）。
 */
import { createLogger } from '@spark/shared'
import type { DangerClassifier, DangerClassifierInput, DangerVerdict } from '@spark/agent'
import { z } from 'zod'

import { extractJsonText, isDeterministicHttpFailure, safeJsonParse } from './auto-router.service.js'
import type { ModelService } from './model.service.js'

const log = createLogger('spark-danger-classifier')

/** LLM 响应截断与安全上限（命令超长时只送前段，防 prompt 灌爆）。 */
const COMMAND_PREVIEW_LIMIT = 4_000
/** 单次评估最多两轮尝试（complete 内部还有 1 次瞬时重试）。 */
const MAX_ATTEMPTS = 2
/** 单次 HTTP 超时（灰区命令的评估延迟预算：P50 约 1-3s，上限 8s）。 */
const DEFAULT_TIMEOUT_MS = 8_000
/** fail-closed 弹卡时用户看到的理由。 */
const FAIL_CLOSED_REASON = '安全审查服务暂不可用，请人工确认'

const DangerReviewVerdictSchema = z.object({
  verdict: z.enum(['safe', 'dangerous']),
  reason: z.string().max(200).default(''),
})

const SYSTEM_PROMPT = `你是命令安全审查员，判断即将在用户机器上执行的工具调用命令是否危险。
判为 dangerous 的判据（任一命中即危险）：
- 不可逆删除：rm -rf、find ... -delete、批量清理文件
- 破坏版本库：git reset --hard、git clean -f/-x、force push、改写历史
- 提权与系统级改动：sudo、写系统目录、dd/mkfs 写设备、修改 crontab/launchd/systemd
- 下载即执行：curl/wget 管道给 sh、运行远程脚本
- 资源耗尽：fork 炸弹、无界循环写入
- 越界写：向工作目录之外的路径写入或覆盖
判为 safe 的典型：只读查询（ls/cat/git status/grep）、常规构建与测试（npm/pnpm/cargo）、
在工作目录内新建或编辑文件。
拿不准时倾向 dangerous。只输出一个 JSON 对象，不要输出任何其他文字：
{"verdict":"safe","reason":"一句话中文理由，50字以内"}
（verdict 只能是 safe 或 dangerous；reason 说明判定依据。）`

function buildUserPayload(input: DangerClassifierInput): string {
  const command =
    input.command.length <= COMMAND_PREVIEW_LIMIT
      ? input.command
      : `${input.command.slice(0, COMMAND_PREVIEW_LIMIT)}…（超长截断）`
  return `工作目录：${input.cwd}\n工具：${input.tool}\n命令：\n${command}`
}

/** 宿主侧分类器构造依赖（对 db/session.service 零依赖，便于单测注入）。 */
export interface SparkDangerClassifierDeps {
  complete: ModelService['complete']
  /** 宿主会话 id：用于日志关联与 LLM 网关身份头（`spark-danger:<id>`）。 */
  sessionId: string
  /** 单次 HTTP 超时；缺省 8s。 */
  timeoutMs?: number
}

/**
 * 构造 spark-auto 危险分类器。强契约：不向调用方 reject——所有失败路径都收敛
 * 为 DangerVerdict（aborted → unavailable；其余 → fail-closed dangerous）。
 */
export function createSparkDangerClassifierFromComplete(
  deps: SparkDangerClassifierDeps,
): DangerClassifier {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    async classify(input: DangerClassifierInput): Promise<DangerVerdict> {
      if (input.signal.aborted) {
        return { kind: 'unavailable', reason: 'turn already aborted' }
      }
      const t0 = Date.now()
      // 日志只带命令长度不带全文，防止敏感命令落盘。
      log.info('danger review started', {
        sessionId: deps.sessionId,
        tool: input.tool,
        commandLen: input.command.length,
      })
      const payload = buildUserPayload(input)
      let failureStage = 'http'
      let failureDetail = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (input.signal.aborted) {
          return { kind: 'unavailable', reason: 'turn aborted during review' }
        }
        const attemptPayload =
          attempt === 1
            ? payload
            : `${payload}\n\n（上一次回复不是合法 JSON，请只输出 {"verdict":"safe","reason":"..."} 格式的 JSON 对象。）`
        const result = await deps.complete(attemptPayload, {
          systemPrompt: SYSTEM_PROMPT,
          maxTokens: 128,
          timeoutMs,
          maxRetries: 1,
          abortSignal: input.signal,
          // 稳定会话标识：Agent 网关缺 x-opencode-session 直接 400。
          sessionId: `spark-danger:${deps.sessionId}`,
        })
        if (!result.available) {
          failureStage = 'http'
          failureDetail = result.reason
          // 确定性 4xx（鉴权/权限/模型不存在）：重试必然同样失败，立即收口。
          if (isDeterministicHttpFailure(result.reason)) {
            log.warn('danger review hit deterministic http failure; skip retry', {
              sessionId: deps.sessionId,
              tool: input.tool,
              attempt,
              failureStage,
            })
            break
          }
          continue
        }
        const jsonText = extractJsonText(result.text)
        if (jsonText == null) {
          failureStage = 'schema'
          failureDetail = `响应中未找到 JSON（返回 ${(result.text ?? '').slice(0, 80)}）`
          continue
        }
        const parsed = DangerReviewVerdictSchema.safeParse(safeJsonParse(jsonText))
        if (!parsed.success) {
          failureStage = 'schema'
          failureDetail = `JSON 不符合判定 schema：${jsonText.slice(0, 120)}`
          continue
        }
        const verdict: DangerVerdict =
          parsed.data.verdict === 'dangerous'
            ? { kind: 'dangerous', reason: parsed.data.reason || '模型判定命令存在风险' }
            : { kind: 'safe' }
        log.info('danger review settled', {
          sessionId: deps.sessionId,
          tool: input.tool,
          attempt,
          verdict: parsed.data.verdict,
          reason: parsed.data.reason,
          latencyMs: Date.now() - t0,
          source: 'llm',
        })
        return verdict
      }
      if (input.signal.aborted) {
        return { kind: 'unavailable', reason: 'turn aborted during review' }
      }
      // fail-closed：评估不可用 → 视为危险弹卡人工确认（故障期安全不缩水）。
      log.warn('danger review degraded to fail-closed ask', {
        sessionId: deps.sessionId,
        tool: input.tool,
        fallbackStage: failureStage,
        degradedTo: 'ask(fail-closed)',
        failureDetail: failureDetail.slice(0, 160),
      })
      return { kind: 'dangerous', reason: FAIL_CLOSED_REASON }
    },
  }
}
