export { ProviderService } from './services/provider.service.js'
export {
  resolveProviderApiKey,
  resolveProviderApiKeyForProfile,
  setManagedCredentialRecoveryHandler,
  type ManagedCredentialRecoveryHandler,
  type ManagedCredentialRecoveryRequest,
} from './services/provider-credential-resolver.js'
export {
  CanvasTextProviderError,
  CanvasTextTimeoutError,
  generateCanvasText,
  resolveCanvasTextRequestTimeoutMs,
  type GenerateCanvasTextParams,
  type GenerateCanvasTextResult,
} from './services/canvas-text-generator.js'
export { MediaRouterService } from './services/media/media-router.service.js'
export { XAI_MAX_FILE_BYTES, XaiFilesClient } from './services/media/xai-files.client.js'
export type { XaiFileObject, XaiFilesPage } from './services/media/xai-files.client.js'
export {
  BAILIAN_FILES_DEFAULT_BASE_URL,
  BailianFilesClient,
  resolveBailianFilesBaseUrl,
} from './services/media/bailian-files.client.js'
export { MinimaxHailuoFilesClient } from './services/media/minimax-hailuo-files.client.js'
export type { MinimaxFileObject } from './services/media/minimax-hailuo-files.client.js'
export {
  VOLCENGINE_ARK_FILES_DEFAULT_BASE_URL,
  VOLCENGINE_ARK_PLATFORM_FILE_MAX_BYTES,
  VOLCENGINE_ARK_TOS_VIDEO_MAX_BYTES,
  VolcengineArkFilesClient,
  resolveVolcengineArkFilesBaseUrl,
} from './services/media/volcengine-ark-files.client.js'
export {
  VOLCENGINE_ARK_VIDEO_TASKS_DEFAULT_BASE_URL,
  VolcengineArkVideoTaskClient,
  resolveVolcengineArkVideoTasksBaseUrl,
} from './services/media/video-channel-task-client.js'
export type { VideoChannelTaskProvider } from './services/media/video-channel-task-client.js'
export {
  BAILIAN_VIDEO_TASKS_DEFAULT_BASE_URL,
  BailianVideoTaskClient,
  resolveBailianVideoTasksBaseUrl,
} from './services/media/bailian-video-task-client.js'
export {
  MINIMAX_VIDEO_TASKS_DEFAULT_BASE_URL,
  MinimaxVideoTaskClient,
  minimaxVideoTaskErrorExtractor,
  resolveMinimaxVideoTasksBaseUrl,
} from './services/media/minimax-video-task-client.js'
export type {
  MediaUploader,
  MediaUploadInput,
  MediaUploadResult,
} from './services/media/media-uploader.js'
export { MediaModelCatalogService } from './services/media/media-model-catalog.service.js'
export type {
  MediaModelCatalogItem,
  MediaProviderModelItem,
} from './services/media/media-model-catalog.service.js'
export {
  CustomMediaProviderConfiguratorService,
  type CustomMediaProviderConfigureResult,
  type CustomMediaProviderDiagnosticInput,
  type CustomMediaProviderDiagnosticResult,
  type CustomMediaProviderDiscoverModelsInput,
  type CustomMediaProviderDraftInput,
  type CustomMediaProviderModelInput,
  type CustomMediaProviderStore,
  type CustomMediaProviderValidationResult,
} from './services/media/custom-media-provider-configurator.service.js'
export {
  resolveProfileMediaModels,
  synthesizeMediaManifestForRef,
  mediaProviderKindCandidates,
  mediaDomainForProfile,
} from './services/media/media-model-resolver.js'
export type {
  MediaProfileLike,
  ResolvedMediaModel,
  MediaModelResolveFilters,
} from './services/media/media-model-resolver.js'
export type {
  MediaProviderProfile,
  InvokeOptions as MediaInvokeOptions,
} from './services/media/media-router.service.js'
export type {
  MediaProviderContext,
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaGeneratedAsset,
  MediaProviderAdapter,
  MediaProviderError,
  MediaErrorCode,
  MediaInputFile,
  MediaArtifactType,
} from './services/media/media-adapter.types.js'
export { MediaArtifactService } from './services/media/media-artifact.service.js'
export { MediaTaskRuntimeService } from './services/media/media-task-runtime.service.js'
export { recoverMediaTask } from './services/media/media-task-recovery.service.js'
export type {
  MediaTaskRecoveryInput,
  MediaTaskRecoveryResult,
  MediaTaskRecoveryStatus,
} from './services/media/media-task-recovery.service.js'
export type {
  MediaTaskPollingDescriptor,
  MediaTaskPollingStrategy,
} from './services/media/media-task-polling.types.js'
export type {
  MediaTaskRecord,
  MediaTaskRouterLike,
  MediaTaskSubmitOptions,
  MediaTaskUpdateHandler,
} from './services/media/media-task-runtime.service.js'
export {
  compileMediaRequest,
  type CompileMediaRequestInput,
  type CompileMediaRequestResult,
  type CompilerInputFile,
} from './services/media/media-request-compiler.js'
export {
  compileInvocationRequest,
  executeMediaUploads,
  legacyInvocationRequest,
  type CompiledInvocationRequest,
  type InvocationCompilerContext,
  type MediaUploadExecutionContext,
} from './services/media/media-invocation-compiler.js'
export { buildVariables } from './services/media/adapters/template-media.adapter.js'
export {
  validateMediaRequest,
  type ValidateMediaRequestInput,
} from './services/media/media-request-validator.js'
export type {
  MediaRequestValidationResult,
  MediaValidationContext,
  MediaProviderValidator,
} from './services/media/validators/media-validator.types.js'
export {
  normalizeMediaError,
  type NormalizeMediaErrorInput,
  type NormalizedMediaError,
} from './services/media/media-error-normalizer.js'
export { ApimartMediaAdapter } from './services/media/adapters/apimart-media.adapter.js'
export { XaiMediaAdapter } from './services/media/adapters/xai-media.adapter.js'
export { ModelService } from './services/model.service.js'
export {
  McpService,
  MANAGED_MCP_SCOPE,
  PLAYWRIGHT_MCP_NAME,
} from './services/mcp-server.service.js'
export { SkillService } from './services/skill.service.js'
export {
  PluginManager,
  PluginPermissionError,
  type PluginManagerOptions,
} from './services/plugins/plugin-manager.service.js'
export { BUILTIN_PLUGIN_MANIFESTS } from './services/plugins/builtin-plugins.js'
export {
  inspectPluginDirectory,
  installPluginArchive,
  installPluginDirectoryAtomic,
} from './services/plugins/plugin-package.js'
export { RulesService } from './services/rules.service.js'
export { RuleCompositionEngine } from './services/rule-composition.engine.js'
export type {
  ComposeOptions,
  ComposedRule,
  CompositionResult,
  ConflictStrategy,
} from './services/rule-composition.engine.js'
export { RuntimeCompositionService } from './services/runtime-composition.service.js'
export type {
  RuntimeCompositionResult,
  RuntimePromptConfig,
  RuntimeScopeRefs,
  RuntimeSkillConfig,
  PromptLayerValue,
  RuntimeLayerScope,
} from './services/runtime-composition.service.js'
export {
  detectLocalSkills,
  importLocalSkillDirectory,
  defaultLocalSkillRoots,
} from './services/local-skill-importer.js'
export type { LocalSkillCandidate, LocalSkillSource } from './services/local-skill-importer.js'
export { PermissionService } from './services/permission.service.js'
export {
  buildComputerUseSystemPrompt,
  type ComputerUsePromptCapabilities,
} from './computer-use/computer-use-system-prompt.js'
export {
  buildComputerDecisionModelConfig,
  type ComputerDecisionModelConfig,
} from './computer-use/computer-decision-model.js'
export type {
  CreateRuleParams,
  ListRulesParams,
  UpdateRuleFields,
} from './services/rules.service.js'
export { SessionService } from './services/session.service.js'
export { PlatformBridgeService } from './services/platform-bridge.service.js'
export { GitHubConnectorService } from './services/github-connector.service.js'
export { RuntimeBroker } from './services/plugin-runtime/runtime-broker.js'
export { RuntimeRegistry } from './services/plugin-runtime/runtime-registry.js'
export { RuntimePolicy } from './services/plugin-runtime/runtime-policy.js'
export { RuntimeTokenService } from './services/plugin-runtime/token-service.js'
export { OAuthBroker } from './services/plugin-runtime/oauth-broker.js'
export { PluginRuntimeMcpBridge } from './services/plugin-runtime/plugin-runtime-mcp-bridge.js'
export { registerBuiltinRuntimeAdapters } from './services/plugin-runtime/builtin-runtimes.js'
export { RuntimeError } from './services/plugin-runtime/runtime-errors.js'
export type {
  ConnectorRuntimeAdapter,
  RuntimeContext,
  RuntimeConnectContext,
  RuntimeConnectResult,
} from './services/plugin-runtime/runtime-types.js'
export type { PlatformBridgeDeps } from './services/platform-bridge.service.js'
export { DebugLogServer, getDebugLogServer } from './services/debug-log-server.service.js'
export type {
  DebugEntry,
  DebugLogLevel,
  DebugHypothesis,
} from './services/debug-log-server.service.js'
export type {
  ApprovalHandler,
  SessionEventHandler,
  SessionQueueChangedHandler,
  QuestionHandler,
  HookTriggerHandler,
  SessionRenamedHandler,
  PlatformConfigChangedHandler,
  CanvasMcpProvider,
  BrowserAutomationMcpProvider,
  ComputerUseMcpProvider,
} from './services/session.service.js'
export { createCanvasMcpServer, canvasAllowedToolNames } from './services/canvas-mcp-server.js'
export type {
  CanvasToolSchema,
  CanvasToolCallBridge,
  CreateCanvasMcpServerOptions,
} from './services/canvas-mcp-server.js'
export { TeamDispatchService } from './services/team-dispatch.service.js'
export type {
  TeamDispatchRunContext,
  TeamMemberExecutionResult,
} from './services/team-dispatch.service.js'
export { WorkspaceService, detectProjectKind } from './services/workspace.service.js'
export type { UpdateWorkspaceParams } from './services/workspace.service.js'
export { GitWorktreeService } from './services/git-worktree.service.js'
export type { RawWorktree, AddWorktreeParams } from './services/git-worktree.service.js'
export { generateWorktreeName, sanitizeBranchSlug } from './services/worktree-name-generator.js'
export type { GenerateWorktreeNameParams } from './services/worktree-name-generator.js'
export {
  AgentEventEmitter,
  isCommand,
  parseCommand,
  parseCommandWithSubcommand,
  CommandRegistry,
  createBuiltinRegistry,
} from './core/index.js'
export type {
  EventListener,
  ParsedCommand,
  CommandDefinition,
  CommandContext,
  CommandResult,
  CommandDeps,
  CommandLayer,
  CommandGroup,
  CommandScope,
  CommandRisk,
  CommandPaletteMeta,
  CommandListItem,
} from './core/index.js'
export { SkillRegistryService } from './services/skill-registry/index.js'
export {
  fetchSparkInstallManifest,
  findSparkInstallArtifact,
  resolveArtifactUrl,
  resolveArtifactUrlString,
} from './services/skill-registry/artifact-manifest.js'
export type {
  SparkInstallArtifact,
  SparkInstallManifest,
} from './services/skill-registry/artifact-manifest.js'
export { installBinaryArchive } from './services/skill-registry/tarball-installer.js'
export type {
  BinaryArchiveInstallParams,
  BinaryArchiveInstallResult,
} from './services/skill-registry/tarball-installer.js'
export { SettingsService } from './services/settings.service.js'
export { UsageLedgerService } from './services/usage-ledger.service.js'
export type {
  RecordUsageParams,
  UsageSummary,
  ModelUsageGroup,
  DailyUsageGroup,
  UsageLedgerRow,
} from './services/usage-ledger.service.js'
export { ScheduledTaskService } from './services/scheduled-task.service.js'
export type {
  ScheduledTaskItem,
  TaskExecutionItem,
  ExecutionStats,
  TaskExecutorFn,
  NotificationConfig as ScheduledTaskNotificationConfig,
  TriggerType,
  ConcurrencyPolicy,
  RetryBackoff,
  TaskStatus as ScheduledTaskStatus,
  ExecutionStatus as TaskExecutionStatus,
} from './services/scheduled-task.service.js'
export { HookService } from './services/hook.service.js'
export type { HookTriggerFn } from './services/hook.service.js'
export type {
  SkillRegistryAdapter,
  SkillRegistryAdapterConfig,
} from './services/skill-registry/adapter.js'
export { SkillLoader } from './skills/skill-loader.js'
export type { SkillInfo } from './skills/skill-loader.js'
export type {
  SkillDefinition,
  SkillParameter,
  SkillCategory,
  SkillExecutionContext,
} from './skills/types.js'
export { buildSkillSystemPrompt } from './skills/types.js'
export { BUILTIN_SKILLS, getBuiltinSkill } from './skills/builtin/index.js'
export { McpClient } from './mcp/index.js'
export type {
  McpServerInfo,
  McpToolDefinition,
  McpToolResult,
  McpConnectionStatus,
  McpTransportConfig,
  StdioTransportConfig,
  SseTransportConfig,
} from './mcp/index.js'

// Claude Agent SDK integration
export {
  ClaudeSDKExecutor,
  isSDKAvailable,
  SDKNotAvailableError,
  CodexRuntimeNotInstalledError,
  resolveBundledCodexCli,
  getCodexRuntimeRoot,
  resolveManagedCodexCli,
  readManagedCodexRuntimeState,
  codexTargetTriple,
} from './sdk/index.js'
export { mapPermissionMode, mergeToolPermissions } from './sdk/index.js'
export type {
  SDKExecutorConfig,
  SDKInvocationSnapshot,
  SDKMcpServerConfig,
  SDKPermissionConfig,
  SparkPermissionMode,
} from './sdk/index.js'

// Memory（记忆系统 V2）— 桌面端 IPC handler 用
export { MemoryStoreService } from './services/memory/memory-store.service.js'
export { MemoryWriterService } from './services/memory/memory-writer.service.js'
export { EmbeddingService } from './services/memory/embedding.service.js'

export { SparkMcpOAuthProvider } from './mcp/oauth/oauth-provider.js'
export type { McpOAuthStore, SparkOAuthTokens } from './mcp/oauth/oauth-store.js'
