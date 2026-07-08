/**
 * @module worktree-name-generator
 *
 * 调用 provider（LLM）根据任务描述生成一个简短、语义化的 git 分支 slug，
 * 用作隔离 worktree 的分支名。失败时返回 null，由调用方决定回退策略。
 *
 * 与 session-title-generator 同构（同样的 HTTP 调用方式），但产出的是
 * git 友好的英文 kebab-case slug（如 `add-login-form`），而非中文标题。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('worktree-name-generator')

const TASK_PROMPT_MAX_CHARS = 600
const REQUEST_TIMEOUT_MS = 8_000
const SLUG_MAX_CHARS = 40

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export interface GenerateWorktreeNameParams {
  /** Provider 类型（'anthropic' | 'openai' | ...） */
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  model: string
  /** 用户的任务描述（通常是首条消息） */
  taskText: string
}

/**
 * 生成 git 分支 slug（不含 `spark/` 前缀）。失败返回 null。
 */
export async function generateWorktreeName(params: GenerateWorktreeNameParams): Promise<string | null> {
  const task = clip(params.taskText, TASK_PROMPT_MAX_CHARS)
  if (task.length === 0) return null

  const prompt = buildPrompt(task)
  try {
    const raw = isAnthropic(params.providerType)
      ? await callAnthropic(params, prompt)
      : await callOpenAICompatible(params, prompt)
    if (raw == null) return null
    const slug = sanitizeBranchSlug(raw)
    return slug.length === 0 ? null : slug
  } catch (err) {
    log.warn(`Failed to generate worktree name: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * 把任意文本规整为合法的 git 分支 slug：小写、仅 [a-z0-9-]、去首尾连字符、限长。
 * 导出以便调用方做本地回退（无 LLM 时从任务文本直接取 slug）。
 */
export function sanitizeBranchSlug(raw: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length === 0) return ''
  return slug.length <= SLUG_MAX_CHARS ? slug : slug.slice(0, SLUG_MAX_CHARS).replace(/-+$/g, '')
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

function buildPrompt(taskText: string): string {
  return [
    'Generate a short git branch name for the following development task.',
    'Requirements:',
    '- 2 to 4 English words, kebab-case (lowercase, words joined by hyphens)',
    '- Describe the task concisely (e.g. add-login-form, fix-cache-bug)',
    '- ASCII letters/digits/hyphens only; no slashes, no prefix, no quotes',
    '- Output ONLY the branch name, nothing else',
    '',
    `[Task]\n${taskText}`,
  ].join('\n')
}

async function callAnthropic(params: GenerateWorktreeNameParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  const url = `${endpoint}/v1/messages`
  const body = {
    model: params.model,
    max_tokens: 32,
    messages: [{ role: 'user', content: prompt }],
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    log.debug(`Anthropic worktree-name request failed: HTTP ${res.status}`)
    return null
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content?.find((item) => item.type === 'text')?.text
  return typeof text === 'string' ? text : null
}

async function callOpenAICompatible(params: GenerateWorktreeNameParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  const url = `${endpoint}/chat/completions`
  const body = {
    model: params.model,
    max_tokens: 32,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    log.debug(`OpenAI-compatible worktree-name request failed: HTTP ${res.status}`)
    return null
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content
  return typeof text === 'string' ? text : null
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  return (custom?.trim() || fallback).replace(/\/+$/, '')
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars)
}
