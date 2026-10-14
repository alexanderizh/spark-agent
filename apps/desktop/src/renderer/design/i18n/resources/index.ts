/**
 * i18n 模块化翻译资源汇总
 *
 * 约定：
 * - 每个模块导出一个 `I18nResource`（`{ zh, en }`），key 前缀即模块名。
 * - **新增文案一律加到对应模块文件**；`locales.ts` 中的大字典仅为历史保留的 legacy 资源，
 *   不再继续追加，避免单文件膨胀。
 * - key 命名：`<module>.<area>.<item>`；短文案用类型后缀标识（Btn/Label/Tab/Title/
 *   Placeholder/Hint/Desc/Error 等），供 `scripts/check-i18n.mjs` 做英文长度强校验。
 */
import { AGENTS_VIEW_RESOURCE } from './agents-view'
import { CANVAS_API_RESOURCE } from './canvas-api'
import { CANVAS_AGENT_MODAL_RESOURCE } from './canvas-agent-modal'
import { CANVAS_ACCEPTANCE_WORKFLOW_RESOURCE } from './canvas-acceptance-workflow'
import { CANVAS_AGENT_PRESETS_RESOURCE } from './canvas-agent-presets'
import { AUTH_RESOURCE } from './auth'
import { BOARD_VIEW_RESOURCE } from './board-view'
import { CANVAS_ENTITY_EXTRACT_RESOURCE } from './canvas-entity-extract'
import { CANVAS_FILM_ASSET_RESOURCE } from './canvas-film-asset'
import { CANVAS_IMAGE_ANNOTATION_RESOURCE } from './canvas-image-annotation'
import { CANVAS_INLINE_AI_RESOURCE } from './canvas-inline-ai'
import { CANVAS_NODE_RESOURCE } from './canvas-node'
import { CANVAS_PROJECT_DETAIL_RESOURCE } from './canvas-project-detail'
import { CANVAS_OPERATION_PRESET_RESOURCE } from './canvas-operation-preset'
import { CANVAS_PROMPT_LIBRARY_RESOURCE } from './canvas-prompt-library'
import { CANVAS_TASK_QUEUE_RESOURCE } from './canvas-task-queue'
import { CANVAS_PROVIDER_FILES_RESOURCE } from './canvas-provider-files'
import { CANVAS_OPERATION_PANEL_RESOURCE } from './canvas-operation-panel'
import { CANVAS_WORKFLOW_LIBRARY_RESOURCE } from './canvas-workflow-library'
import { CANVAS_WORKSPACE_FILM_RESOURCE } from './canvas-workspace-film'
import { CANVAS_WORKSPACE_RESOURCE } from './canvas-workspace'
import { CHAT_RESOURCE } from './chat'
import { CHAT_INSPECTOR_RESOURCE } from './chat-inspector'
import { CHAT_VIEW_RESOURCE } from './chat-view'
import { COMPOSER_V2_RESOURCE } from './composer-v2'
import { MCP_VIEW_RESOURCE } from './mcp-view'
import { MANNEQUIN_RESOURCE } from './mannequin'
import { QUICK_CREATE_VIEW_RESOURCE } from './quick-create-view'
import { QUICK_CREATE_TASK_HISTORY_RESOURCE } from './quick-create-task-history'
import { MEMORY_PANEL_RESOURCE } from './memory-panel'
import { ONBOARDING_RESOURCE } from './onboarding'
import { PERFORMANCE_RESOURCE } from './performance'
import { PROVIDERS_VIEW_RESOURCE } from './providers-view'
import { SETTINGS_RESOURCE } from './settings'
import { WORKFLOW_VIEW_RESOURCE } from './workflow-view'
import { SETTINGS_VIEW_RESOURCE } from './settings-view'
import { SCHEDULED_TASKS_RESOURCE } from './scheduled-tasks'
import { SIDEBAR_RESOURCE } from './sidebar'
import { SKILL_STORE_RESOURCE } from './skill-store'
import { TWEAKS_RESOURCE } from './tweaks'

export interface I18nResource {
  zh: Record<string, string>
  en: Record<string, string>
}

export const MODULE_RESOURCES: readonly I18nResource[] = [
  AUTH_RESOURCE,
  AGENTS_VIEW_RESOURCE,
  CANVAS_API_RESOURCE,
  CANVAS_AGENT_MODAL_RESOURCE,
  CANVAS_ACCEPTANCE_WORKFLOW_RESOURCE,
  CANVAS_AGENT_PRESETS_RESOURCE,
  SIDEBAR_RESOURCE,
  SCHEDULED_TASKS_RESOURCE,
  SKILL_STORE_RESOURCE,
  TWEAKS_RESOURCE,
  CHAT_RESOURCE,
  CANVAS_WORKFLOW_LIBRARY_RESOURCE,
  CANVAS_WORKSPACE_FILM_RESOURCE,
  CANVAS_WORKSPACE_RESOURCE,
  CANVAS_FILM_ASSET_RESOURCE,
  CANVAS_IMAGE_ANNOTATION_RESOURCE,
  CANVAS_INLINE_AI_RESOURCE,
  CANVAS_NODE_RESOURCE,
  CANVAS_PROJECT_DETAIL_RESOURCE,
  CANVAS_OPERATION_PRESET_RESOURCE,
  CANVAS_PROMPT_LIBRARY_RESOURCE,
  CANVAS_TASK_QUEUE_RESOURCE,
  CANVAS_PROVIDER_FILES_RESOURCE,
  CANVAS_OPERATION_PANEL_RESOURCE,
  CANVAS_ENTITY_EXTRACT_RESOURCE,
  BOARD_VIEW_RESOURCE,
  CHAT_VIEW_RESOURCE,
  CHAT_INSPECTOR_RESOURCE,
  ONBOARDING_RESOURCE,
  MEMORY_PANEL_RESOURCE,
  MCP_VIEW_RESOURCE,
  MANNEQUIN_RESOURCE,
  QUICK_CREATE_VIEW_RESOURCE,
  QUICK_CREATE_TASK_HISTORY_RESOURCE,
  COMPOSER_V2_RESOURCE,
  PERFORMANCE_RESOURCE,
  SETTINGS_RESOURCE,
  SETTINGS_VIEW_RESOURCE,
  PROVIDERS_VIEW_RESOURCE,
  WORKFLOW_VIEW_RESOURCE,
]

function merge(resources: readonly I18nResource[], lang: 'zh' | 'en'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const resource of resources) Object.assign(out, resource[lang])
  return out
}

export const MODULE_ZH: Record<string, string> = merge(MODULE_RESOURCES, 'zh')
export const MODULE_EN: Record<string, string> = merge(MODULE_RESOURCES, 'en')
