import {
  CustomToolDraftSchema,
  toCustomToolSummary,
  type CustomToolDraft,
  type CustomToolRecord,
  type CustomToolSummary,
  type CustomToolTestRunResult,
  type CustomToolWorkspace,
} from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'
import type { CustomToolService } from './custom-tool.service.js'

export interface CustomToolValidationIssue {
  path: string
  message: string
}

export type CustomToolValidationResult =
  | { valid: true; spec: CustomToolDraft }
  | { valid: false; issues: CustomToolValidationIssue[] }

export interface CustomToolAuthoringGuide {
  protocolVersion: 1
  adapters: Array<{
    id: 'http' | 'code' | 'provider-vision' | 'mcp-import'
    available: boolean
    purpose: string
    executionBoundary: string
  }>
  workflow: string[]
  safeguards: string[]
  httpExample: CustomToolDraft
  codeExample: CustomToolDraft
}

const DIRECT_AUTHORING_TYPES = new Set<CustomToolDraft['type']>(['http', 'code', 'provider-vision'])

function canonicalSecretRef(toolId: string, name: string): string {
  return `custom-tool:${toolId}:${name}`
}

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): CustomToolValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

function validateDraft(spec: unknown): CustomToolValidationResult {
  const parsed = CustomToolDraftSchema.safeParse(spec)
  if (!parsed.success) {
    return { valid: false, issues: validationIssues(parsed.error) }
  }

  const issues: CustomToolValidationIssue[] = []
  if (!DIRECT_AUTHORING_TYPES.has(parsed.data.type)) {
    issues.push({
      path: 'type',
      message: `Tool Studio 当前不直接执行 ${parsed.data.type} 类型；请改用原生 code 工具或受管 HTTP 组合`,
    })
  }
  for (const [name, ref] of Object.entries(parsed.data.secretRefs ?? {})) {
    if (ref !== canonicalSecretRef(parsed.data.id, name)) {
      issues.push({
        path: `secretRefs.${name}`,
        message: 'Agent 接口只接受规范化密钥引用，不接受密钥值或自定义存储位置',
      })
    }
  }
  return issues.length > 0 ? { valid: false, issues } : { valid: true, spec: parsed.data }
}

function parseDraft(spec: unknown): CustomToolDraft {
  const result = validateDraft(spec)
  if (result.valid) return result.spec
  const issue = result.issues[0]
  throw new CustomToolError(
    'INVALID_INPUT',
    issue == null
      ? '自定义工具定义不合法'
      : `自定义工具定义不合法${issue.path ? `（${issue.path}）` : ''}：${issue.message}`,
  )
}

function sanitizeSecretRefs<T extends CustomToolDraft>(draft: T): T {
  const names = Object.keys(draft.secretRefs ?? {})
  if (names.length === 0) return draft
  return {
    ...draft,
    secretRefs: Object.fromEntries(names.map((name) => [name, canonicalSecretRef(draft.id, name)])),
  } as T
}

function sanitizeWorkspace(workspace: CustomToolWorkspace): CustomToolWorkspace {
  return {
    ...workspace,
    tool: sanitizeSecretRefs(workspace.tool),
    draft: sanitizeSecretRefs(workspace.draft),
    published: workspace.published == null ? null : sanitizeSecretRefs(workspace.published),
  }
}

function redactTestOutput(text: string, secrets: string[]): string {
  let redacted = text
  const values = [...new Set(secrets.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  )
  for (const value of values) {
    redacted = redacted.split(value).join('[redacted]')
  }
  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, 'sk-[redacted]')
    .replace(
      /\b(authorization|api[_-]?key|secret|token|password|pwd)(\s*[:=]\s*)(?:Bearer\s+)?([^\s,;"'}]+)/gi,
      '$1$2[redacted]',
    )
}

async function redactTestResult(
  tools: CustomToolService,
  result: CustomToolTestRunResult,
  workspace: CustomToolWorkspace | undefined,
  draft: CustomToolDraft | undefined,
): Promise<CustomToolTestRunResult> {
  if (workspace == null) {
    return { ...result, text: redactTestOutput(result.text, []) }
  }
  const effectiveDraft = draft ?? workspace.draft
  const executionRecord: CustomToolRecord = { ...workspace.tool, ...effectiveDraft }
  const secrets = Object.values(await tools.resolveSecrets(executionRecord))
  return { ...result, text: redactTestOutput(result.text, secrets) }
}

function requireConfirmation(value: boolean | undefined, action: string): void {
  if (value !== true) {
    throw new CustomToolError('DENIED', `${action}需要用户明确确认`)
  }
}

/**
 * Agent-facing authoring facade.
 *
 * It deliberately exposes no secret-write API. Agents may declare secretRef
 * slots, while the actual values must still be entered through the trusted
 * desktop Keychain form. Mutating operations reuse the same CustomToolService
 * instance as the renderer so runtime hot reload and UI streams stay coherent.
 */
export class CustomToolAuthoringService {
  constructor(private readonly tools: CustomToolService) {}

  guide(): CustomToolAuthoringGuide {
    return {
      protocolVersion: 1,
      adapters: [
        {
          id: 'http',
          available: true,
          purpose: '声明式接入任意 HTTP API；支持输入 Schema、模板、密钥引用和响应映射。',
          executionBoundary: '由 SparkWork 宿主执行并统一治理 SSRF、重定向、超时和响应大小。',
        },
        {
          id: 'code',
          available: true,
          purpose: '使用 TypeScript 开发任意纯逻辑，并通过 sdk.tools.call 组合已发布工具。',
          executionBoundary:
            '运行在独立 Worker 进程；不接收 Keychain、宿主环境、文件或子进程权限。当前信任等级为 trusted-local，不用于执行来源不可信的代码。',
        },
        {
          id: 'provider-vision',
          available: true,
          purpose: '已有 Provider Vision 兼容模板；只是普通参考用例，不是默认创建入口。',
          executionBoundary: '复用已有 Provider 与 Keychain，宿主只在确定性视觉路由中读取附件。',
        },
        {
          id: 'mcp-import',
          available: true,
          purpose: '兼容已有外部 MCP 生态；它是可选导入适配器，不是自定义工具的默认运行时。',
          executionBoundary: '外部 MCP 继续走平台既有 MCP 权限与进程边界。',
        },
      ],
      workflow: [
        '先读取 custom_tools_list，避免重复创建或覆盖已有工具。',
        '生成完整定义并调用 custom_tools_validate；不要猜测 API、鉴权或副作用。',
        '调用 custom_tools_create_draft 保存禁用草稿；草稿不会进入 Agent 稳定工具面。',
        '需要真实调用时先向用户说明目标、费用和副作用，再调用 custom_tools_test。',
        '用户确认后发布；首次发布会进入稳定工具面，后续发布沿用当前启用状态。',
        '发布后通过下一轮工具清单或真实会话验证；需要停用时调用 set_enabled。',
      ],
      safeguards: [
        '管理工具不接受密钥值；只声明 secretRefs，密钥必须在扩展中心安全表单填写。',
        '测试、发布、启用、回滚和删除分别要求显式确认字段。',
        '任意代码不要放进 Electron Main、Renderer 或 Agent Runtime；必须使用 type=code。',
        '代码工具只能通过 permissions.toolIds 声明依赖，并用 sdk.tools.call(toolId, input) 组合能力。',
        '未完成平台级默认断网前，代码工具必须标记 trust=trusted-local，不得执行第三方不可信代码。',
      ],
      httpExample: {
        id: 'weather_lookup',
        title: '天气查询',
        description: '根据城市名称查询当前天气；仅在用户明确询问实时天气时调用。',
        type: 'http',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '城市名称，例如上海' },
          },
          required: ['city'],
        },
        spec: {
          request: {
            method: 'GET',
            urlTemplate: 'https://api.example.com/weather?city={{city}}',
          },
          response: { format: 'text' },
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
        timeoutMs: 30_000,
      },
      codeExample: {
        id: 'score_calculator',
        title: '评分计算器',
        description: '根据用户提供的分项分数执行确定性的本地计算并返回结构化结果。',
        type: 'code',
        inputSchema: {
          type: 'object',
          properties: {
            values: { type: 'array', items: { type: 'number' }, description: '待计算的分数' },
          },
          required: ['values'],
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
        timeoutMs: 30_000,
        spec: {
          runtime: {
            kind: 'trusted-worker',
            language: 'typescript',
            source:
              'export default async function(input: { values: number[] }) {\n  const total = input.values.reduce((sum, value) => sum + value, 0)\n  return { total, average: input.values.length === 0 ? 0 : total / input.values.length }\n}',
            entryExport: 'default',
          },
          permissions: { toolIds: [] },
          limits: { memoryMb: 128, maxOutputBytes: 1_048_576 },
          trust: 'trusted-local',
        },
      },
    }
  }

  list(query?: string): CustomToolSummary[] {
    return this.tools.list(query)
  }

  async get(id: string): Promise<CustomToolWorkspace> {
    return sanitizeWorkspace(await this.tools.getWorkspace(id))
  }

  validate(spec: unknown): CustomToolValidationResult {
    return validateDraft(spec)
  }

  async createDraft(spec: unknown): Promise<CustomToolWorkspace> {
    return sanitizeWorkspace(await this.tools.createDraft(parseDraft(spec)))
  }

  async saveDraft(id: string, spec: unknown): Promise<CustomToolWorkspace> {
    const draft = parseDraft(spec)
    if (draft.id !== id) {
      throw new CustomToolError('INVALID_INPUT', '工具 ID 创建后不可修改')
    }
    return sanitizeWorkspace(await this.tools.saveDraft(id, draft))
  }

  async test(params: {
    id?: string
    spec?: unknown
    input: Record<string, unknown>
    confirmExecute?: boolean
  }): Promise<CustomToolTestRunResult> {
    requireConfirmation(params.confirmExecute, '真实测试运行')
    const draftSpec = params.spec == null ? undefined : parseDraft(params.spec)
    if (params.id == null && draftSpec == null) {
      throw new CustomToolError('INVALID_INPUT', '测试需要 id 或 spec')
    }
    if (params.id != null && draftSpec == null) {
      const workspace = await this.tools.getWorkspace(params.id)
      const result = await this.tools.testRun({
        toolId: params.id,
        draftSpec: workspace.draft,
        input: params.input,
      })
      return redactTestResult(this.tools, result, workspace, workspace.draft)
    }
    const result = await this.tools.testRun({
      ...(params.id != null ? { toolId: params.id } : {}),
      ...(draftSpec != null ? { draftSpec } : {}),
      input: params.input,
    })
    const workspace = params.id == null ? undefined : await this.tools.getWorkspace(params.id)
    return redactTestResult(this.tools, result, workspace, draftSpec)
  }

  async publish(
    id: string,
    expectedDraftVersion: number | undefined,
    confirmPublish: boolean | undefined,
  ): Promise<CustomToolWorkspace> {
    requireConfirmation(confirmPublish, '发布工具')
    return sanitizeWorkspace(await this.tools.publish(id, expectedDraftVersion))
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    confirmEnable: boolean | undefined,
  ): Promise<CustomToolSummary> {
    if (enabled) requireConfirmation(confirmEnable, '启用工具')
    return toCustomToolSummary(await this.tools.setEnabled(id, enabled))
  }

  async rollback(
    id: string,
    version: number,
    confirmRollback: boolean | undefined,
  ): Promise<CustomToolWorkspace> {
    requireConfirmation(confirmRollback, '回滚工具')
    return sanitizeWorkspace(await this.tools.rollback(id, version))
  }

  async delete(id: string, confirmDelete: boolean | undefined): Promise<{ success: true }> {
    requireConfirmation(confirmDelete, '删除工具')
    await this.tools.delete(id)
    return { success: true }
  }
}
