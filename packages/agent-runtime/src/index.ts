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
  generateCanvasText,
  type GenerateCanvasTextParams,
  type GenerateCanvasTextResult,
} from './services/canvas-text-generator.js'
export { MediaRouterService } from './services/media/media-router.service.js'
export { MediaModelCatalogService } from './services/media/media-model-catalog.service.js'
export type {
  MediaModelCatalogItem,
  MediaProviderModelItem,
} from './services/media/media-model-catalog.service.js'
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
  normalizeMediaError,
  type NormalizeMediaErrorInput,
  type NormalizedMediaError,
} from './services/media/media-error-normalizer.js'
export { ApimartMediaAdapter } from './services/media/adapters/apimart-media.adapter.js'
export { XaiMediaAdapter } from './services/media/adapters/xai-media.adapter.js'
export { ModelService } from './services/model.service.js'
export { McpService, MANAGED_MCP_SCOPE, PLAYWRIGHT_MCP_NAME } from './services/mcp-server.service.js'
export { SkillService } from './services/skill.service.js'
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
export type {
  CreateRuleParams,
  ListRulesParams,
  UpdateRuleFields,
} from './services/rules.service.js'
export { SessionService } from './services/session.service.js'
export { PlatformBridgeService } from './services/platform-bridge.service.js'
export { GitHubConnectorService } from './services/github-connector.service.js'
export type { PlatformBridgeDeps } from './services/platform-bridge.service.js'
export { DebugLogServer, getDebugLogServer } from './services/debug-log-server.service.js'
export type { DebugEntry, DebugLogLevel, DebugHypothesis } from './services/debug-log-server.service.js'
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
} from './services/session.service.js'
export {
  createCanvasMcpServer,
  canvasAllowedToolNames,
} from './services/canvas-mcp-server.js'
export type {
  CanvasToolSchema,
  CanvasToolCallBridge,
  CreateCanvasMcpServerOptions,
} from './services/canvas-mcp-server.js'
export { TeamDispatchService } from './services/team-dispatch.service.js'
export type { TeamDispatchRunContext, TeamMemberExecutionResult } from './services/team-dispatch.service.js'
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
export { ClaudeSDKExecutor, isSDKAvailable, SDKNotAvailableError } from './sdk/index.js'
export { mapPermissionMode, mergeToolPermissions } from './sdk/index.js'
export type {
  SDKExecutorConfig,
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
