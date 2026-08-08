/**
 * Agent-facing custom multimedia Provider configuration service.
 *
 * The Platform Management MCP bridge delegates to this service instead of
 * writing provider_profiles directly. This keeps manifest validation, request
 * previews, Keychain persistence and real diagnostics on the same production
 * paths used by the Provider UI and canvas runtime.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MEDIA_CAPABILITY_IDS,
  MediaModelManifestSchema,
  createBasicCustomMediaManifest,
  createCustomMediaManifestId,
  migrateMediaModelManifestToV2,
  validateMediaModelManifestSemantics,
  type CanvasOperationType,
  type MediaCapabilityId,
  type MediaInvocationRequest,
  type MediaModelManifest,
  type ProviderMediaModelRef,
  type ProviderProfile,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import type { ProviderService } from '../provider.service.js'
import type {
  MediaGenerateInput,
  MediaInputFile,
  MediaProviderError,
} from './media-adapter.types.js'
import { buildVariables } from './adapters/template-media.adapter.js'
import { compileInvocationRequest, legacyInvocationRequest } from './media-invocation-compiler.js'
import { compileMediaRequest } from './media-request-compiler.js'
import { MediaRouterService, type MediaProviderProfile } from './media-router.service.js'

const log = createLogger('custom-media-provider-configurator')
const MAX_MODELS = 100
const MAX_PREVIEWS = 100
const MAX_DIAGNOSTIC_TEXT = 4_000
const UNIQUE_CUSTOM_MANIFEST_ID = /^custom:[a-z0-9._-]+:[a-z0-9-]{8,}$/

export type CustomMediaProviderStore = Pick<
  ProviderService,
  'createProvider' | 'updateProvider' | 'listProviders' | 'getProviderApiKey' | 'fetchModels'
>

export interface CustomMediaProviderModelInput {
  modelId: string
  displayName?: string
  enabled?: boolean
  defaults?: Record<string, unknown>
  manifest: unknown
}

export interface CustomMediaProviderDraftInput {
  providerId?: string
  name?: string
  providerProtocol?: 'openai' | 'anthropic'
  apiEndpoint: string
  defaultModel: string
  models: CustomMediaProviderModelInput[]
  apiKey?: string
  isDefault?: boolean
}

export interface CustomMediaConfigIssue {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
  modelId?: string
}

export interface CustomMediaRequestPreview {
  modelId: string
  manifestId: string
  capabilityId: MediaCapabilityId
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
  warnings: string[]
}

export interface CustomMediaProviderValidationResult {
  valid: boolean
  issues: CustomMediaConfigIssue[]
  previews: CustomMediaRequestPreview[]
  summary: {
    modelCount: number
    capabilityCount: number
    domains: string[]
    sourceUrls: string[]
  }
}

export interface CustomMediaProviderConfigureResult {
  created: boolean
  provider: {
    id: string
    name: string
    defaultModel: string
    modelIds: string[]
    apiEndpoint?: string
    hasApiKey: boolean
    mediaProvider: string | null
    mediaCapabilities: MediaCapabilityId[]
    manifestIds: string[]
  }
  validation: CustomMediaProviderValidationResult
  nextSteps: string[]
}

export interface CustomMediaProviderDiscoverModelsInput {
  providerId?: string
  providerProtocol?: 'openai' | 'anthropic'
  apiEndpoint?: string
  apiKey?: string
  modelsUrl?: string
  isFullUrl?: boolean
}

export interface CustomMediaProviderDiagnosticInput {
  providerId: string
  checkModels?: boolean
  modelsUrl?: string
  isFullModelsUrl?: boolean
  execute?: {
    modelId: string
    capabilityId: MediaCapabilityId
    prompt?: string
    negativePrompt?: string
    modelParams?: Record<string, unknown>
    inputFiles?: MediaInputFile[]
    /** Paid/provider-mutating request guard. Must be explicitly true. */
    confirmExecute: boolean
  }
}

export interface CustomMediaProviderDiagnosticResult {
  providerId: string
  healthy: boolean
  stages: Array<{
    stage: 'configuration' | 'credential' | 'models' | 'invoke'
    ok: boolean
    message: string
    data?: unknown
  }>
  recommendations: string[]
}

interface ParsedModel {
  index: number
  input: CustomMediaProviderModelInput
  manifest: MediaModelManifest
}

interface DraftAnalysis {
  endpoint: string
  models: ParsedModel[]
  capabilities: MediaCapabilityId[]
  domains: string[]
  sourceUrls: string[]
  issues: CustomMediaConfigIssue[]
  previews: CustomMediaRequestPreview[]
}

interface MediaRouterLike {
  invoke(
    input: MediaGenerateInput,
    options: Parameters<MediaRouterService['invoke']>[1],
  ): ReturnType<MediaRouterService['invoke']>
}

export class CustomMediaProviderConfiguratorService {
  constructor(
    private readonly providers: CustomMediaProviderStore,
    private readonly router: MediaRouterLike = new MediaRouterService(),
  ) {}

  createGuide(input?: {
    modelId?: string
    domain?: 'image' | 'video' | 'audio'
    mode?: 'sync' | 'async_polling'
  }): Record<string, unknown> {
    const domain = input?.domain ?? 'image'
    const modelId = input?.modelId?.trim() || 'replace-with-real-model-id'
    const mode = input?.mode ?? (domain === 'video' ? 'async_polling' : 'sync')
    return {
      workflow: [
        '向用户确认渠道名称、API Base URL、模型 ID、需要的媒体能力和官方文档 URL。',
        '使用 spark_search.web_search / fetch_url 读取官方文档，不要凭模型记忆猜字段。',
        '每个真实模型建立一个独立 manifest，并把查阅过的 URL 写入 docs.sourceUrls。',
        '先调用 providers_media_validate；修完全部 error 后再调用 providers_media_configure。',
        '配置后调用 providers_media_diagnose；真实生成请求必须先取得用户明确同意。',
      ],
      requiredInformation: [
        'providerName',
        'apiEndpoint',
        'authentication',
        'modelIds or /models endpoint',
        'capabilities',
        'request method/path/content type/body',
        'response or task-id/status/result paths',
        'parameter enum/range/defaults',
        'official documentation URLs',
      ],
      supportedCapabilities: MEDIA_CAPABILITY_IDS,
      baseTemplates: ['custom', 'openai-compatible', 'async-json', 'toapis-image'],
      invariants: [
        'manifest.id 必须包含随机实例后缀；不同渠道可以使用相同 modelId，但不能复用 manifest.id。',
        'manifest.providerKind 应为 custom，adapterMode 应为 template。',
        'API Key 只传给 configure/diagnose，工具不会在返回值或日志中回显明文。',
        '文档没有声明的参数、枚举、轮询状态和结果路径不得臆造。',
      ],
      starterManifest: createStarterManifest(modelId, domain, mode),
    }
  }

  async validate(
    input: CustomMediaProviderDraftInput,
  ): Promise<CustomMediaProviderValidationResult> {
    const analysis = await this.analyze(input)
    await this.validateManifestIdOwnership(input, analysis)
    return validationResult(analysis)
  }

  async configure(
    input: CustomMediaProviderDraftInput,
  ): Promise<CustomMediaProviderConfigureResult> {
    const analysis = await this.analyze(input)
    await this.validateManifestIdOwnership(input, analysis)
    const validation = validationResult(analysis)
    const errors = analysis.issues.filter((issue) => issue.severity === 'error')
    if (errors.length > 0) {
      throw new Error(
        `Custom media provider validation failed: ${errors
          .slice(0, 8)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      )
    }

    const modelIds = unique(analysis.models.map((model) => model.input.modelId.trim()))
    const defaultModel = input.defaultModel.trim()
    const refs: ProviderMediaModelRef[] = analysis.models.map(({ input: model, manifest }) => ({
      manifestId: manifest.id,
      modelId: model.modelId.trim(),
      enabled: model.enabled !== false,
      ...(model.defaults ? { defaults: model.defaults } : {}),
      ...(model.displayName?.trim() ? { displayName: model.displayName.trim() } : {}),
      adapterMode: 'template',
      manifest,
    }))
    const hasImage = analysis.domains.includes('image')
    const modelType = profileModelType(analysis.domains)
    const existing = input.providerId ? await this.findProvider(input.providerId) : null
    if (input.providerId && !existing) throw new Error(`Provider not found: ${input.providerId}`)
    const providerProtocol =
      input.providerProtocol ?? (existing?.provider === 'anthropic' ? 'anthropic' : 'openai')
    const common = {
      provider: providerProtocol,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      defaultModel,
      modelIds,
      apiEndpoint: analysis.endpoint,
      modelType,
      imageProvider: hasImage ? 'custom' : null,
      imageApiType: hasImage ? ('auto' as const) : null,
      mediaProvider: 'custom' as const,
      mediaApiType: 'auto' as const,
      mediaCapabilities: analysis.capabilities,
      mediaModelRefs: refs,
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    }

    const created = !input.providerId
    let profile: ProviderProfile
    if (input.providerId) {
      profile = await this.providers.updateProvider({ id: input.providerId, ...common })
    } else {
      const name = input.name?.trim()
      if (!name) throw new Error('Provider name is required when creating a provider')
      profile = await this.providers.createProvider({
        ...common,
        name,
        apiKey: input.apiKey ?? '',
      })
    }

    log.info(
      `custom media provider configured action=${created ? 'create' : 'update'} ` +
        `providerId=${profile.id} models=${modelIds.length} capabilities=${analysis.capabilities.length} ` +
        `hasApiKey=${Boolean(profile.keystoreRef)}`,
    )
    return {
      created,
      provider: toSafeProvider(profile, refs),
      validation,
      nextSteps: [
        profile.keystoreRef
          ? '调用 providers_media_diagnose 检查模型发现与真实请求。'
          : 'Provider 已保存但尚无 API Key；补充 Key 后才能发起真实请求。',
        '在模型管理页确认模型及能力显示，再在画布执行一次对应能力验收。',
      ],
    }
  }

  async discoverModels(input: CustomMediaProviderDiscoverModelsInput): Promise<{
    models: unknown[]
    count: number
    providerId?: string
  }> {
    let provider: ProviderProfile | null = null
    if (input.providerId) {
      provider = await this.findProvider(input.providerId)
      if (!provider) throw new Error(`Provider not found: ${input.providerId}`)
    }
    const models = await this.providers.fetchModels({
      ...(input.providerId ? { id: input.providerId } : {}),
      provider: input.providerProtocol ?? provider?.provider ?? 'openai',
      ...(input.apiEndpoint !== undefined
        ? { apiEndpoint: input.apiEndpoint }
        : provider?.apiEndpoint !== undefined
          ? { apiEndpoint: provider.apiEndpoint }
          : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.modelsUrl !== undefined ? { modelsUrl: input.modelsUrl } : {}),
      ...(input.isFullUrl !== undefined ? { isFullUrl: input.isFullUrl } : {}),
    })
    return {
      models,
      count: models.length,
      ...(input.providerId ? { providerId: input.providerId } : {}),
    }
  }

  async diagnose(
    input: CustomMediaProviderDiagnosticInput,
  ): Promise<CustomMediaProviderDiagnosticResult> {
    const stages: CustomMediaProviderDiagnosticResult['stages'] = []
    const recommendations: string[] = []
    const profile = await this.findProvider(input.providerId)
    if (!profile) throw new Error(`Provider not found: ${input.providerId}`)
    const refs = profile.mediaModelRefs ?? []
    const models = refs
      .filter((ref) => ref.manifest != null)
      .map((ref) => ({
        modelId: ref.modelId ?? ref.manifest!.modelId,
        ...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}),
        ...(ref.enabled !== undefined ? { enabled: ref.enabled } : {}),
        ...(ref.defaults !== undefined ? { defaults: ref.defaults } : {}),
        manifest: ref.manifest!,
      }))
    const validation = await this.validate({
      providerId: profile.id,
      name: profile.name,
      providerProtocol: profile.provider === 'anthropic' ? 'anthropic' : 'openai',
      apiEndpoint: profile.apiEndpoint ?? '',
      defaultModel: profile.defaultModel,
      models,
    })
    stages.push({
      stage: 'configuration',
      ok: validation.valid,
      message: validation.valid
        ? `配置合同有效：${validation.summary.modelCount} 个模型，${validation.summary.capabilityCount} 项能力`
        : `配置合同存在 ${validation.issues.filter((issue) => issue.severity === 'error').length} 个错误`,
      data: validation,
    })
    if (!validation.valid) recommendations.push('先修复 configuration 阶段返回的合同错误。')

    const apiKey = await this.providers.getProviderApiKey(profile.id)
    const credentialOk = apiKey.length > 0
    stages.push({
      stage: 'credential',
      ok: credentialOk,
      message: credentialOk ? 'API Key 已在系统 Keychain 中配置' : 'API Key 未配置或无法读取',
    })
    if (!credentialOk) recommendations.push('在 Provider 配置中补充 API Key 后重试。')

    if (input.checkModels) {
      try {
        const result = await this.discoverModels({
          providerId: profile.id,
          ...(input.modelsUrl !== undefined ? { modelsUrl: input.modelsUrl } : {}),
          ...(input.isFullModelsUrl !== undefined ? { isFullUrl: input.isFullModelsUrl } : {}),
        })
        stages.push({
          stage: 'models',
          ok: true,
          message: `/models 获取成功，共 ${result.count} 个模型`,
          data: result,
        })
      } catch (error) {
        const message = errorMessage(error)
        stages.push({ stage: 'models', ok: false, message })
        recommendations.push(recommendationForFailure(message))
      }
    }

    if (input.execute) {
      if (input.execute.confirmExecute !== true) {
        stages.push({
          stage: 'invoke',
          ok: false,
          message: '真实请求未执行：confirmExecute 必须为 true，且应先取得用户明确同意。',
        })
        recommendations.push('告知用户真实生成可能产生费用，确认后再执行诊断请求。')
      } else if (!credentialOk || !validation.valid) {
        stages.push({
          stage: 'invoke',
          ok: false,
          message: '真实请求未执行：配置或凭据预检未通过。',
        })
      } else {
        stages.push(await this.executeDiagnostic(profile, apiKey, input.execute))
      }
    }

    return {
      providerId: profile.id,
      healthy: stages.every((stage) => stage.ok),
      stages,
      recommendations: unique(recommendations.filter(Boolean)),
    }
  }

  private async analyze(input: CustomMediaProviderDraftInput): Promise<DraftAnalysis> {
    const issues: CustomMediaConfigIssue[] = []
    const previews: CustomMediaRequestPreview[] = []
    const endpoint = validateBaseEndpoint(input.apiEndpoint, issues)
    if (!input.providerId?.trim() && !input.name?.trim()) {
      issues.push(
        issue('error', 'provider_name_required', 'name', '新建 Provider 时渠道名称不能为空。'),
      )
    }
    const rawModels = Array.isArray(input.models) ? input.models : []
    if (rawModels.length === 0) {
      issues.push(issue('error', 'models_required', 'models', '至少配置一个多媒体模型。'))
    }
    if (rawModels.length > MAX_MODELS) {
      issues.push(
        issue(
          'error',
          'too_many_models',
          'models',
          `单个 Provider 最多配置 ${MAX_MODELS} 个模型。`,
        ),
      )
    }

    const models: ParsedModel[] = []
    const seenManifestIds = new Set<string>()
    for (const [index, model] of rawModels.slice(0, MAX_MODELS).entries()) {
      const modelPath = `models.${index}`
      const modelId = String(model?.modelId ?? '').trim()
      if (!modelId) {
        issues.push(
          issue('error', 'model_id_required', `${modelPath}.modelId`, '模型 ID 不能为空。'),
        )
        continue
      }
      if (!isRecord(model.manifest)) {
        issues.push(
          issue(
            'error',
            'manifest_required',
            `${modelPath}.manifest`,
            '模型必须包含完整 manifest。',
            modelId,
          ),
        )
        continue
      }
      let migrated: unknown
      try {
        migrated = migrateMediaModelManifestToV2(model.manifest as unknown as MediaModelManifest)
      } catch (error) {
        issues.push(
          issue(
            'error',
            'manifest_migration_failed',
            `${modelPath}.manifest`,
            errorMessage(error),
            modelId,
          ),
        )
        continue
      }
      const parsed = MediaModelManifestSchema.safeParse(migrated)
      if (!parsed.success) {
        for (const schemaIssue of parsed.error.issues.slice(0, 30)) {
          issues.push(
            issue(
              'error',
              'manifest_schema_invalid',
              `${modelPath}.manifest.${schemaIssue.path.join('.')}`.replace(/\.$/, ''),
              schemaIssue.message,
              modelId,
            ),
          )
        }
        continue
      }
      const manifest = parsed.data
      for (const semanticIssue of validateMediaModelManifestSemantics(manifest)) {
        issues.push(
          issue(
            'error',
            semanticIssue.code,
            `${modelPath}.manifest.${semanticIssue.path.join('.')}`.replace(/\.$/, ''),
            semanticIssue.message,
            modelId,
          ),
        )
      }
      if (seenManifestIds.has(manifest.id)) {
        issues.push(
          issue(
            'error',
            'duplicate_manifest_id',
            `${modelPath}.manifest.id`,
            `manifest.id ${manifest.id} 在当前 Provider 中重复。`,
            modelId,
          ),
        )
      }
      seenManifestIds.add(manifest.id)
      if (manifest.modelId.trim() !== modelId) {
        issues.push(
          issue(
            'error',
            'manifest_model_id_mismatch',
            `${modelPath}.manifest.modelId`,
            `Manifest modelId 必须与模型清单 ID 一致；当前为 ${manifest.modelId}。`,
            modelId,
          ),
        )
      }
      if (!UNIQUE_CUSTOM_MANIFEST_ID.test(manifest.id)) {
        issues.push(
          issue(
            input.providerId ? 'warning' : 'error',
            'manifest_id_not_channel_unique',
            `${modelPath}.manifest.id`,
            '新建自定义模型必须使用 custom:<model-slug>:<随机实例后缀>，避免不同渠道同名模型冲突。',
            modelId,
          ),
        )
      }
      if (manifest.providerKind !== 'custom' || manifest.adapterMode !== 'template') {
        issues.push(
          issue(
            'error',
            'custom_template_adapter_required',
            `${modelPath}.manifest.adapterMode`,
            '自定义渠道必须使用 providerKind=custom 且 adapterMode=template。',
            modelId,
          ),
        )
      }
      validateDocumentationEvidence(manifest, modelPath, modelId, Boolean(input.providerId), issues)
      validateManifestRequestUrls(manifest, endpoint, modelPath, modelId, issues)
      models.push({ index, input: model, manifest })
    }

    const modelIds = unique(models.map((model) => model.input.modelId.trim()))
    if (modelIds.length !== models.length) {
      issues.push(
        issue(
          'error',
          'duplicate_model_id',
          'models',
          '同一 Provider 内每个 modelId 只能对应一个完整 manifest；请把多项能力合并到该 manifest。',
        ),
      )
    }
    if (input.defaultModel?.trim() && !modelIds.includes(input.defaultModel.trim())) {
      issues.push(
        issue(
          'error',
          'default_model_missing',
          'defaultModel',
          '默认模型必须存在于 models 列表中。',
        ),
      )
    }
    const defaultModelEntry = models.find(
      (model) => model.input.modelId.trim() === input.defaultModel?.trim(),
    )
    if (defaultModelEntry?.input.enabled === false) {
      issues.push(
        issue(
          'error',
          'default_model_disabled',
          `models.${defaultModelEntry.index}.enabled`,
          '默认模型必须处于启用状态。',
          defaultModelEntry.input.modelId.trim(),
        ),
      )
    }
    if (!input.defaultModel?.trim()) {
      issues.push(issue('error', 'default_model_required', 'defaultModel', '默认模型不能为空。'))
    }

    for (const model of models) {
      for (const capability of model.manifest.capabilities) {
        if (previews.length >= MAX_PREVIEWS) break
        if (!isSupportedCapability(capability.id)) {
          issues.push(
            issue(
              'error',
              'unsupported_capability',
              `models.${model.index}.manifest.capabilities`,
              `应用运行时不支持能力 ${capability.id}。`,
              model.input.modelId.trim(),
            ),
          )
          continue
        }
        try {
          previews.push(
            await compilePreview(
              endpoint,
              model.input.modelId.trim(),
              model.manifest,
              capability.id,
            ),
          )
        } catch (error) {
          issues.push(
            issue(
              'error',
              'request_preview_failed',
              `models.${model.index}.manifest.invocation`,
              errorMessage(error),
              model.input.modelId.trim(),
            ),
          )
        }
      }
    }

    return {
      endpoint,
      models,
      capabilities: unique(
        models.flatMap((model) =>
          model.manifest.capabilities
            .map((capability) => capability.id)
            .filter(isSupportedCapability),
        ),
      ),
      domains: unique(models.flatMap((model) => model.manifest.domains)),
      sourceUrls: unique(models.flatMap((model) => model.manifest.docs.sourceUrls)),
      issues,
      previews,
    }
  }

  private async validateManifestIdOwnership(
    input: CustomMediaProviderDraftInput,
    analysis: DraftAnalysis,
  ): Promise<void> {
    if (analysis.models.length === 0) return
    const currentProviderId = input.providerId?.trim()
    const owners = new Map<string, string>()
    for (const provider of await this.providers.listProviders({ includeDisabled: true })) {
      if (provider.id === currentProviderId) continue
      for (const ref of provider.mediaModelRefs ?? []) {
        owners.set(ref.manifestId, provider.id)
      }
    }
    for (const model of analysis.models) {
      const ownerId = owners.get(model.manifest.id)
      if (!ownerId) continue
      const legacyUpdate =
        Boolean(currentProviderId) && !UNIQUE_CUSTOM_MANIFEST_ID.test(model.manifest.id)
      analysis.issues.push(
        issue(
          legacyUpdate ? 'warning' : 'error',
          'manifest_id_conflicts_with_provider',
          `models.${model.index}.manifest.id`,
          `manifest.id 已被 Provider ${ownerId} 使用；请生成新的渠道实例 ID。`,
          model.input.modelId.trim(),
        ),
      )
    }
  }

  private async executeDiagnostic(
    profile: ProviderProfile,
    apiKey: string,
    execution: NonNullable<CustomMediaProviderDiagnosticInput['execute']>,
  ): Promise<CustomMediaProviderDiagnosticResult['stages'][number]> {
    const manifest = profile.mediaModelRefs
      ?.filter((ref) => ref.enabled !== false && ref.manifest != null)
      .find(
        (ref) =>
          (ref.modelId ?? ref.manifest!.modelId) === execution.modelId &&
          ref.manifest!.capabilities.some((capability) => capability.id === execution.capabilityId),
      )?.manifest
    if (!manifest) {
      return {
        stage: 'invoke',
        ok: false,
        message: `模型 ${execution.modelId} 未配置能力 ${execution.capabilityId}。`,
      }
    }
    const outputDir = await mkdtemp(join(tmpdir(), 'spark-media-adapter-debug-'))
    const provider: MediaProviderProfile = {
      id: profile.id,
      name: profile.name,
      defaultModel: profile.defaultModel,
      ...(profile.modelIds.length > 0 ? { modelIds: profile.modelIds } : {}),
      apiEndpoint: profile.apiEndpoint ?? '',
      mediaProvider: 'custom',
      mediaApiType: profile.mediaApiType ?? 'auto',
      ...(profile.mediaCapabilities !== undefined
        ? { mediaCapabilities: profile.mediaCapabilities }
        : {}),
      ...(profile.mediaModelRefs !== undefined
        ? {
            mediaModelManifests: profile.mediaModelRefs
              .filter((ref) => ref.enabled !== false && ref.manifest != null)
              .map((ref) => ref.manifest!),
          }
        : {}),
      ...(profile.mediaDefaults !== undefined ? { mediaDefaults: profile.mediaDefaults } : {}),
      apiKey,
    }
    try {
      const result = await this.router.invoke(
        {
          operation: operationForCapability(execution.capabilityId),
          capability: execution.capabilityId,
          ...(execution.prompt !== undefined ? { prompt: execution.prompt } : {}),
          ...(execution.negativePrompt !== undefined
            ? { negativePrompt: execution.negativePrompt }
            : {}),
          ...(execution.modelParams !== undefined ? { modelParams: execution.modelParams } : {}),
          ...(execution.inputFiles !== undefined ? { inputFiles: execution.inputFiles } : {}),
          outputDir,
        },
        {
          providers: [provider],
          providerProfileId: profile.id,
          modelId: execution.modelId,
          manifestId: manifest.id,
          capability: execution.capabilityId,
        },
      )
      return {
        stage: 'invoke',
        ok: true,
        message: '真实多媒体请求成功。',
        data: sanitizeDiagnosticValue(
          {
            providerProfileId: result.providerProfileId,
            model: result.output.model,
            mode: result.output.mode,
            requestId: result.output.requestId,
            assets: result.output.assets,
            requestCall: result.output.requestCall,
            rawResponse: result.output.rawResponse,
            droppedParams: result.output.droppedParams,
            contractWarnings: result.output.contractWarnings,
            contractIssues: result.output.contractIssues,
          },
          0,
          [apiKey],
        ),
      }
    } catch (error) {
      const typed = error as Partial<MediaProviderError>
      const message = redactKnownSecrets(errorMessage(error), [apiKey])
      log.warn(
        `custom media diagnostic invoke failed providerId=${profile.id} model=${execution.modelId} ` +
          `capability=${execution.capabilityId} code=${typed.code ?? 'unknown'} error=${truncate(message)}`,
      )
      return {
        stage: 'invoke',
        ok: false,
        message,
        data: sanitizeDiagnosticValue(
          {
            code: typed.code,
            statusCode: typed.statusCode,
            normalized: typed.normalized,
            requestCall: typed.requestCall,
          },
          0,
          [apiKey],
        ),
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch((error: unknown) => {
        log.warn(
          `custom media diagnostic cleanup failed providerId=${profile.id} error=${truncate(errorMessage(error))}`,
        )
      })
    }
  }

  private async findProvider(id: string): Promise<ProviderProfile | null> {
    return (
      (await this.providers.listProviders({ includeDisabled: true })).find(
        (provider) => provider.id === id,
      ) ?? null
    )
  }
}

function createStarterManifest(
  modelId: string,
  domain: 'image' | 'video' | 'audio',
  mode: 'sync' | 'async_polling',
): MediaModelManifest {
  if (domain !== 'audio') {
    return {
      ...createBasicCustomMediaManifest({ modelId, modelType: domain, mode }),
      contractVersion: 2,
      adapterMode: 'template',
    }
  }
  const id = createCustomMediaManifestId(modelId)
  const requestTemplate = { model: '{{modelId}}', input: '{{text}}' }
  return {
    id,
    baseTemplate: 'custom',
    contractVersion: 2,
    adapterMode: 'template',
    providerKind: 'custom',
    modelId,
    displayName: modelId,
    domains: ['audio'],
    capabilities: [
      {
        id: 'audio.speech',
        label: '文本转语音',
        input: { required: ['prompt'] },
        output: { types: ['audio'], mimeTypes: ['audio/mpeg'] },
        paramSchema: { type: 'object', additionalProperties: true, properties: {} },
        paramPolicy: { strict: false, passthrough: { enabled: true, allowScalarsOnly: true } },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/audio/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate,
      request: {
        method: 'POST',
        endpoint: '/audio/generations',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template: requestTemplate },
      },
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: [] },
  }
}

async function compilePreview(
  apiEndpoint: string,
  modelId: string,
  manifest: MediaModelManifest,
  capabilityId: MediaCapabilityId,
): Promise<CustomMediaRequestPreview> {
  const capability = manifest.capabilities.find((item) => item.id === capabilityId)
  if (!capability) throw new Error(`Capability not found: ${capabilityId}`)
  const modelParams = capability.defaults ?? {}
  const compiled = compileMediaRequest({
    manifest,
    capability,
    modelId,
    input: { prompt: 'Spark adapter validation prompt', modelParams },
    mode: 'canvas',
  })
  const request =
    manifest.invocation.request ??
    legacyInvocationRequest({
      endpoint: manifest.invocation.endpoint,
      method: manifest.invocation.method,
      headers: manifest.invocation.headers,
      requestTemplate: manifest.invocation.requestTemplate,
      contentType: manifest.invocation.contentType,
    })
  const previewRequest =
    request.body?.kind === 'json'
      ? {
          ...request,
          body: {
            ...request.body,
            template: isRecord(request.body.template)
              ? mergePreviewProviderParams(request.body.template, compiled.providerParams)
              : request.body.template,
          },
        }
      : request
  const variables = buildVariables(
    {
      operation: operationForCapability(capabilityId),
      capability: capabilityId,
      prompt: 'Spark adapter validation prompt',
      modelParams,
      outputDir: '',
    },
    capability,
    modelId,
    compiled.providerParams,
    compiled.canonicalParams,
  )
  const prepared = await compileInvocationRequest(previewRequest, {
    apiEndpoint,
    apiKey: '[REDACTED]',
    variables,
    inputFiles: [],
    defaultAuth:
      request.auth?.kind === 'inherit' ? { kind: 'bearer', credentialRef: 'apiKey' } : request.auth,
  })
  return {
    modelId,
    manifestId: manifest.id,
    capabilityId,
    method: prepared.method,
    url: redactUrl(prepared.url),
    headers: redactHeaders(prepared.headers),
    ...(prepared.body !== undefined ? { body: summarizeBody(prepared.body) } : {}),
    warnings: [
      ...compiled.warnings.map((warning) => warning.message),
      ...compiled.droppedParams.map((item) => `${item.name}: ${item.reason}`),
      ...compiled.validationIssues.map((item) => item.message),
    ],
  }
}

function validateBaseEndpoint(value: string, issues: CustomMediaConfigIssue[]): string {
  const endpoint = String(value ?? '')
    .trim()
    .replace(/\/+$/, '')
  if (!endpoint) {
    issues.push(issue('error', 'api_endpoint_required', 'apiEndpoint', 'API Base URL 不能为空。'))
    return ''
  }
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      issues.push(
        issue('error', 'api_endpoint_protocol', 'apiEndpoint', 'API Base URL 只允许 http/https。'),
      )
    }
    if (url.username || url.password) {
      issues.push(
        issue('error', 'api_endpoint_credentials', 'apiEndpoint', '不得把凭据写入 API URL。'),
      )
    }
    if (url.protocol === 'http:' && !isLocalOrPrivateHost(url.hostname)) {
      issues.push(
        issue(
          'warning',
          'unencrypted_api_endpoint',
          'apiEndpoint',
          '远程 HTTP 端点不会加密 API Key 和请求内容，生产环境应使用 HTTPS。',
        ),
      )
    }
  } catch {
    issues.push(issue('error', 'api_endpoint_invalid', 'apiEndpoint', 'API Base URL 格式无效。'))
  }
  return endpoint
}

function validateDocumentationEvidence(
  manifest: MediaModelManifest,
  modelPath: string,
  modelId: string,
  isUpdate: boolean,
  issues: CustomMediaConfigIssue[],
): void {
  const sourceUrls = manifest.docs.sourceUrls
  if (sourceUrls.length === 0) {
    issues.push(
      issue(
        isUpdate ? 'warning' : 'error',
        'documentation_evidence_missing',
        `${modelPath}.manifest.docs.sourceUrls`,
        '新建自定义渠道必须记录真实官方文档 URL；历史配置更新时可暂时保存，但应尽快补齐。',
        modelId,
      ),
    )
    return
  }
  for (const [index, sourceUrl] of sourceUrls.entries()) {
    try {
      const parsed = new URL(sourceUrl)
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error('unsafe documentation URL')
      }
      for (const key of parsed.searchParams.keys()) {
        if (/key|token|secret|signature|authorization/i.test(key)) {
          throw new Error('credential-like query parameter')
        }
      }
    } catch {
      issues.push(
        issue(
          'error',
          'documentation_url_invalid',
          `${modelPath}.manifest.docs.sourceUrls.${index}`,
          '文档来源必须是无凭据的 http/https URL。',
          modelId,
        ),
      )
    }
  }
}

function validateManifestRequestUrls(
  manifest: MediaModelManifest,
  apiEndpoint: string,
  modelPath: string,
  modelId: string,
  issues: CustomMediaConfigIssue[],
): void {
  const requests: Array<{ path: string; request: MediaInvocationRequest }> = []
  if (manifest.invocation.request) {
    requests.push({ path: 'invocation.request', request: manifest.invocation.request })
  }
  for (const [index, upload] of (manifest.invocation.uploads ?? []).entries()) {
    requests.push({ path: `invocation.uploads.${index}.request`, request: upload.request })
    if (upload.cleanup?.request) {
      requests.push({
        path: `invocation.uploads.${index}.cleanup.request`,
        request: upload.cleanup.request,
      })
    }
  }
  const response = manifest.invocation.response
  if (response.kind === 'task_poll') {
    if (response.poll) requests.push({ path: 'invocation.response.poll', request: response.poll })
    if (response.artifact) {
      requests.push({
        path: 'invocation.response.artifact.request',
        request: response.artifact.request,
      })
    }
  }
  for (const entry of requests) {
    const endpoint = entry.request.endpoint.trim()
    if (!endpoint) continue
    try {
      const resolved = new URL(endpoint, apiEndpoint || 'https://invalid.local')
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        issues.push(
          issue(
            'error',
            'request_endpoint_protocol',
            `${modelPath}.manifest.${entry.path}.endpoint`,
            '请求端点只允许 http/https 或相对路径。',
            modelId,
          ),
        )
      }
      if (resolved.username || resolved.password) {
        issues.push(
          issue(
            'error',
            'request_endpoint_credentials',
            `${modelPath}.manifest.${entry.path}.endpoint`,
            '不得把凭据写入请求 URL。',
            modelId,
          ),
        )
      }
      if (/^https?:\/\//i.test(endpoint) && apiEndpoint) {
        const base = new URL(apiEndpoint)
        if (resolved.origin !== base.origin) {
          issues.push(
            issue(
              'warning',
              'cross_origin_request',
              `${modelPath}.manifest.${entry.path}.endpoint`,
              `请求会离开 Provider Base URL，目标为 ${resolved.origin}；请确认官方文档明确要求。`,
              modelId,
            ),
          )
        }
      }
    } catch {
      issues.push(
        issue(
          'error',
          'request_endpoint_invalid',
          `${modelPath}.manifest.${entry.path}.endpoint`,
          '请求端点格式无效。',
          modelId,
        ),
      )
    }
  }
}

function validationResult(analysis: DraftAnalysis): CustomMediaProviderValidationResult {
  return {
    valid: !analysis.issues.some((issue) => issue.severity === 'error'),
    issues: analysis.issues,
    previews: analysis.previews,
    summary: {
      modelCount: analysis.models.length,
      capabilityCount: analysis.capabilities.length,
      domains: analysis.domains,
      sourceUrls: analysis.sourceUrls,
    },
  }
}

function toSafeProvider(
  profile: ProviderProfile,
  refs: ProviderMediaModelRef[],
): CustomMediaProviderConfigureResult['provider'] {
  return {
    id: profile.id,
    name: profile.name,
    defaultModel: profile.defaultModel,
    modelIds: profile.modelIds,
    ...(profile.apiEndpoint !== undefined ? { apiEndpoint: profile.apiEndpoint } : {}),
    hasApiKey: Boolean(profile.keystoreRef),
    mediaProvider: profile.mediaProvider ?? null,
    mediaCapabilities: profile.mediaCapabilities ?? [],
    manifestIds: refs.map((ref) => ref.manifestId),
  }
}

function profileModelType(domains: string[]): 'image' | 'video' | 'voice' | 'multimodal' {
  if (domains.length !== 1) return 'multimodal'
  if (domains[0] === 'image') return 'image'
  if (domains[0] === 'video') return 'video'
  if (domains[0] === 'audio') return 'voice'
  return 'multimodal'
}

function operationForCapability(capability: MediaCapabilityId): CanvasOperationType {
  switch (capability) {
    case 'image.generate':
      return 'text_to_image'
    case 'image.edit':
    case 'image.variations':
      return 'image_to_image'
    case 'audio.speech':
    case 'audio.music':
      return 'text_to_audio'
    case 'audio.transcription':
      return 'audio_transcribe'
    case 'video.generate':
    case 'video.reference_to_video':
      return 'text_to_video'
    case 'video.image_to_video':
      return 'image_to_video'
    case 'video.edit':
      return 'video_edit'
    case 'video.extend':
      return 'video_extend'
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|api[-_]?key|cookie|signature|token/i.test(key) ? '[REDACTED]' : value,
    ]),
  )
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|signature|authorization/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    return url.toString()
  } catch {
    return value
  }
}

function summarizeBody(body: string | Uint8Array): unknown {
  if (typeof body !== 'string') return `[binary body bytes=${body.byteLength}]`
  try {
    return sanitizeDiagnosticValue(JSON.parse(body) as unknown)
  } catch {
    return truncate(body)
  }
}

function sanitizeDiagnosticValue(value: unknown, depth = 0, secrets: string[] = []): unknown {
  if (depth > 8) return '[TRUNCATED_DEPTH]'
  if (typeof value === 'string') return truncate(redactKnownSecrets(value, secrets))
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Buffer.isBuffer(value)) return `[binary bytes=${value.byteLength}]`
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeDiagnosticValue(entry, depth + 1, secrets))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => {
          if (/authorization|api[-_]?key|cookie|secret|signature|token/i.test(key)) {
            return [key, '[REDACTED]']
          }
          if (/url/i.test(key) && typeof entry === 'string') {
            return [key, redactKnownSecrets(redactUrl(entry), secrets)]
          }
          return [key, sanitizeDiagnosticValue(entry, depth + 1, secrets)]
        }),
    )
  }
  return String(value)
}

function recommendationForFailure(message: string): string {
  const normalized = message.toLowerCase()
  if (/401|unauthorized|invalid.*token|无效.*令牌|鉴权/.test(normalized)) {
    return '检查 API Key、Authorization 方案以及 Base URL 是否属于同一渠道。'
  }
  if (/404|not found/.test(normalized)) {
    return '检查 Base URL 是否已包含 /v1，以及 modelsUrl/请求路径是否被重复拼接。'
  }
  if (/400|invalid.*parameter|invalid.*request|参数/.test(normalized)) {
    return '根据官方文档核对参数名、类型、枚举和请求 Content-Type。'
  }
  if (/timeout|timed out|超时/.test(normalized)) {
    return '检查轮询端点、状态映射、间隔和超时时间。'
  }
  return '查看失败阶段返回的脱敏请求摘要，并与官方文档逐项比对。'
}

function issue(
  severity: CustomMediaConfigIssue['severity'],
  code: string,
  path: string,
  message: string,
  modelId?: string,
): CustomMediaConfigIssue {
  return { severity, code, path, message, ...(modelId ? { modelId } : {}) }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function mergePreviewProviderParams(
  body: Record<string, unknown>,
  providerParams: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...body }
  for (const [key, value] of Object.entries(providerParams)) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return next
}

function redactKnownSecrets(value: string, secrets: string[]): string {
  let next = value
  for (const secret of secrets) {
    if (secret.length >= 4) next = next.split(secret).join('[REDACTED]')
  }
  return next
}

function isSupportedCapability(value: string): value is MediaCapabilityId {
  return (MEDIA_CAPABILITY_IDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isLocalOrPrivateHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  )
}

function errorMessage(error: unknown): string {
  return truncate(error instanceof Error ? error.message : String(error))
}

function truncate(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_TEXT
    ? value
    : `${value.slice(0, MAX_DIAGNOSTIC_TEXT)}…[truncated]`
}
