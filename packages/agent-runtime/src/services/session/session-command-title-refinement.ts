import { SessionRepository, type SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { generateSessionTitle } from '../session-title-generator.js'
import { resolveSessionTitleTarget } from './session-title-target.js'
import {
  deriveSessionTitle,
  isTitlePrefixOfMessage,
  shouldDeriveSessionTitle,
  shouldDeriveSessionTitleOrRemote,
  stripRemoteCreatedTitle,
  withRemoteCreatedTitleSuffix,
} from './session-pure-utils.js'

const log = createLogger('session-command-title-refinement')

export interface InitializeCommandSessionTitleParams {
  db: SparkDatabase
  sessionId: string
  userMessage: string
  onSessionRenamed?: (sessionId: string, title: string) => void
}

/**
 * 首条命令若会继续启动 Agent turn，先用命令中的任务正文即时命名，再异步调用
 * 当前会话 Provider 做语义精炼。控制命令不会调用此入口。
 *
 * 智能路由会话（2026-09-29）：解析链走 resolveSessionTitleTarget，从 router
 * 配置挑标题模型，不再因 router 行无直连凭据而静默放弃精炼。
 */
export function initializeCommandSessionTitle(params: InitializeCommandSessionTitleParams): void {
  const userMessage = params.userMessage.trim()
  if (userMessage.length === 0) return

  const sessionRepo = new SessionRepository(params.db)
  const session = sessionRepo.get(params.sessionId)
  if (session == null || !shouldDeriveSessionTitleOrRemote(session.title)) return

  // 远程创建的会话保留「 · 远程创建」后缀
  const derivedTitle = withRemoteCreatedTitleSuffix(session.title, deriveSessionTitle(userMessage))
  sessionRepo.updateTitle(params.sessionId, derivedTitle)
  params.onSessionRenamed?.(params.sessionId, derivedTitle)

  void refineCommandSessionTitleAsync({
    ...params,
    userMessage,
    derivedTitle,
    sessionRepo,
  })
}

async function refineCommandSessionTitleAsync(
  params: InitializeCommandSessionTitleParams & {
    derivedTitle: string
    sessionRepo: SessionRepository
  },
): Promise<void> {
  try {
    const session = params.sessionRepo.get(params.sessionId)
    if (session == null) return

    // 与 extractSessionTitle 同一套解析：普通渠道取会话模型 → Provider 默认模型，
    // 智能路由从 router 配置挑标题模型。任何一环不可用都静默放弃精炼，
    // 保留 initializeCommandSessionTitle 写入的本地派生标题。
    const resolved = await resolveSessionTitleTarget({ db: params.db, session })
    if (!resolved.ok) return

    const refinedTitle = await generateSessionTitle({
      providerType: resolved.target.providerType,
      apiKey: resolved.target.apiKey,
      ...(resolved.target.apiEndpoint != null ? { apiEndpoint: resolved.target.apiEndpoint } : {}),
      ...(resolved.target.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
      model: resolved.target.model,
      userMessage: params.userMessage,
      assistantMessage: '',
    })
    if (refinedTitle == null || refinedTitle.length === 0) return

    const current = params.sessionRepo.get(params.sessionId)
    if (current == null) return
    // 异步请求期间用户可能手动改名；仅覆盖本入口的派生标题或默认标题
    // （远程创建的标题先剥掉后缀再判断，比较口径与写入口径一致）。
    const currentBase = stripRemoteCreatedTitle(current.title)
    if (
      currentBase !== stripRemoteCreatedTitle(params.derivedTitle) &&
      !isTitlePrefixOfMessage(currentBase, params.userMessage) &&
      !shouldDeriveSessionTitle(currentBase)
    ) {
      return
    }
    const nextTitle = withRemoteCreatedTitleSuffix(current.title, refinedTitle)
    if (nextTitle === current.title) return

    params.sessionRepo.updateTitle(params.sessionId, nextTitle)
    params.onSessionRenamed?.(params.sessionId, nextTitle)
  } catch (err) {
    log.warn(
      `Failed to refine command session title: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 从命令参数中提取面向用户的任务正文，避免把内部 follow-up prompt 用作标题。 */
export function resolveCommandTitleSource(params: {
  commandName: string
  args: string[]
  description: string
}): string {
  const normalizedCommandName = params.commandName.toLowerCase()
  const taskArgs =
    normalizedCommandName === 'skill' &&
    (params.args[0]?.toLowerCase() === 'run' || params.args[0]?.toLowerCase() === 'use')
      ? params.args.slice(2)
      : params.args
  const task = taskArgs.join(' ').trim()
  if (task.length > 0) return task
  if (normalizedCommandName === 'spark-app-create') return '创建子应用'
  return params.description.trim() || params.commandName
}
