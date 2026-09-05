import { z } from 'zod'
import { spawn, type SpawnOptions } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SparkDatabase } from '@spark/storage'
import {
  AgentRepository,
  ProviderProfileRepository,
  ToolPackageStorageRepository,
} from '@spark/storage'
import { fetchJson } from '@spark/shared'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import { terminateProcessTree } from './tool-package-project-runner.js'
import {
  createToolPackageWorkflowCapabilities,
  type ToolPackageWorkflowCapabilityDeps,
} from './tool-package-workflow-capabilities.js'
import {
  createToolPackageBrowserCapabilities,
  type ToolPackageBrowserCapabilityDeps,
} from './tool-package-browser-capabilities.js'
import {
  createToolPackageComputerCapabilities,
  type ToolPackageComputerCapabilityDeps,
} from './tool-package-computer-capabilities.js'
import {
  createToolPackageMediaCapabilities,
  type ToolPackageMediaCapabilityDeps,
} from './tool-package-media-capabilities.js'

export interface ToolPackageFileUploadInput {
  path: string
  fileName?: string | undefined
  mimeType?: string | undefined
  purpose?: string | undefined
}

export interface ToolPackageFilePresentInput {
  files: Array<{ path: string; title?: string | undefined }>
}

export interface ToolPackageDialogOpenInput {
  title?: string | undefined
  defaultPath?: string | undefined
  mode?: 'file' | 'directory' | 'any' | undefined
  allowMultiple?: boolean | undefined
  filters?: Array<{ name: string; extensions: string[] }> | undefined
}

export interface ToolPackageDialogSaveInput {
  title?: string | undefined
  defaultPath?: string | undefined
  filters?: Array<{ name: string; extensions: string[] }> | undefined
}

export interface ToolPackageBuiltInCapabilityDeps
  extends
    ToolPackageWorkflowCapabilityDeps,
    ToolPackageBrowserCapabilityDeps,
    ToolPackageComputerCapabilityDeps,
    ToolPackageMediaCapabilityDeps {
  db: SparkDatabase
  uploadFile?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageFileUploadInput,
  ) => Promise<unknown>
  presentFiles?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageFilePresentInput,
  ) => Promise<unknown>
  trashFile?: (context: ToolHostCapabilityContext, input: { path: string }) => Promise<unknown>
  readClipboardText?: (context: ToolHostCapabilityContext) => Promise<string> | string
  writeClipboardText?: (
    context: ToolHostCapabilityContext,
    input: { text: string },
  ) => Promise<unknown> | unknown
  showNotification?: (
    context: ToolHostCapabilityContext,
    input: { title: string; body?: string | undefined },
  ) => Promise<unknown> | unknown
  openExternal?: (context: ToolHostCapabilityContext, input: { url: string }) => Promise<unknown>
  openDialog?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageDialogOpenInput,
  ) => Promise<unknown>
  saveDialog?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageDialogSaveInput,
  ) => Promise<unknown>
}

const ProviderSelectionSchema = z.object({
  providerId: z.string().min(1).max(160).optional(),
  model: z.string().min(1).max(300).optional(),
})

const ModelInvokeSchema = ProviderSelectionSchema.extend({
  prompt: z.string().min(1).max(200_000),
  system: z.string().max(100_000).optional(),
  maxTokens: z.number().int().min(1).max(32_768).default(4_096),
  temperature: z.number().min(0).max(2).optional(),
  responseFormat: z
    .object({
      type: z.literal('json'),
      /** Optional JSON Schema the model should conform to (OpenAI-compatible json_schema). */
      schema: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})

const AgentInvokeSchema = z.object({
  agentId: z.string().min(1).max(160),
  prompt: z.string().min(1).max(200_000),
  maxTokens: z.number().int().min(1).max(32_768).default(4_096),
  temperature: z.number().min(0).max(2).optional(),
})

const FileUploadSchema = z.object({
  path: z.string().min(1).max(4_096),
  fileName: z.string().min(1).max(500).optional(),
  mimeType: z.string().min(1).max(200).optional(),
  purpose: z.string().min(1).max(100).optional(),
})

const FilePresentSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(4_096),
        title: z.string().min(1).max(300).optional(),
      }),
    )
    .min(1)
    .max(50),
})

const HttpFetchSchema = z.object({
  url: z
    .string()
    .url()
    .max(4_000)
    .refine((value) => /^https?:\/\//i.test(value), 'http.fetch supports HTTP and HTTPS URLs'),
  method: z
    .string()
    .regex(/^[A-Z]+$/)
    .max(20)
    .default('GET'),
  headers: z.record(z.string().min(1).max(200), z.string().max(16_000)).optional(),
  body: z
    .string()
    .max(10 * 1024 * 1024)
    .optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  responseType: z.enum(['text', 'json', 'base64']).default('text'),
})

/**
 * argv-only command execution: no shell string, so injection is structurally
 * impossible. Each capability call requires per-call user confirmation.
 */
const ProcessExecSchema = z.object({
  command: z.array(z.string().max(8_192)).min(1).max(256),
  cwd: z.string().min(1).max(4_096).optional(),
  env: z.record(z.string().min(1).max(256), z.string().max(16_000)).optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .max(8 * 1024 * 1024)
    .default(1 * 1024 * 1024),
})

const StorageKeySchema = z.string().min(1).max(500)
const FilePathSchema = z.string().min(1).max(4_096)
const DialogFilterSchema = z.object({
  name: z.string().min(1).max(100),
  extensions: z.array(z.string().min(1).max(32)).max(100),
})
const DialogOpenSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  defaultPath: FilePathSchema.optional(),
  mode: z.enum(['file', 'directory', 'any']).default('file'),
  allowMultiple: z.boolean().default(false),
  filters: z.array(DialogFilterSchema).max(30).optional(),
})
const DialogSaveSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  defaultPath: FilePathSchema.optional(),
  filters: z.array(DialogFilterSchema).max(30).optional(),
})
const EmptyObjectSchema = z.object({})
const StorageGetSchema = z.object({ key: StorageKeySchema })
const StorageSetSchema = z.object({ key: StorageKeySchema, value: z.unknown() })
const StorageListSchema = z.object({
  prefix: z.string().max(500).default(''),
  limit: z.number().int().min(1).max(500).default(100),
})
const FileReadSchema = z.object({
  path: FilePathSchema,
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024)
    .default(2 * 1024 * 1024),
})
const FileWriteSchema = z.object({
  path: FilePathSchema,
  content: z.string().max(20 * 1024 * 1024),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  createParents: z.boolean().default(false),
})
const FilePathInputSchema = z.object({ path: FilePathSchema })
const FileTransferSchema = z.object({ source: FilePathSchema, destination: FilePathSchema })
const AgentIdSchema = z.object({ agentId: z.string().min(1).max(160) })
const GenericObjectOutputSchema = { type: 'object' } satisfies Record<string, unknown>

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>
}

export function registerToolPackageBuiltInCapabilities(
  broker: ToolHostCapabilityBroker,
  deps: ToolPackageBuiltInCapabilityDeps,
): () => void {
  const providers = new ProviderProfileRepository(deps.db)
  const agents = new AgentRepository(deps.db)
  const storage = new ToolPackageStorageRepository(deps.db)
  const definitions: ToolHostCapabilityDefinition[] = [
    {
      name: 'http.fetch',
      description:
        'Send an HTTP or HTTPS request, including localhost, private networks and custom ports.',
      inputSchema: z.toJSONSchema(HttpFetchSchema) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      supportsCancellation: true,
      sensitiveDataPolicy: 'Headers and bodies are never written to tool invocation logs.',
      invoke: async (context, input) =>
        invokeHostHttpFetch(HttpFetchSchema.parse(input), context.signal),
    },
    {
      name: 'storage.kv.get',
      description: 'Read one value from package-isolated persistent storage.',
      inputSchema: inputSchema(StorageGetSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (context, input) => {
        const { key } = StorageGetSchema.parse(input)
        return { entry: storage.get(context.packageId, key) ?? null }
      },
    },
    {
      name: 'storage.kv.set',
      description: 'Create or replace one value in package-isolated persistent storage.',
      inputSchema: inputSchema(StorageSetSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) => {
        const { key, value } = StorageSetSchema.parse(input)
        return { entry: storage.set(context.packageId, key, value) }
      },
    },
    {
      name: 'storage.kv.delete',
      description: 'Delete one value from package-isolated persistent storage.',
      inputSchema: inputSchema(StorageGetSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      invoke: async (context, input) => {
        const { key } = StorageGetSchema.parse(input)
        return { deleted: storage.delete(context.packageId, key) }
      },
    },
    {
      name: 'storage.kv.list',
      description: 'List package-isolated persistent storage entries by key prefix.',
      inputSchema: inputSchema(StorageListSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (context, input) => {
        const request = StorageListSchema.parse(input)
        return { entries: storage.list(context.packageId, request.prefix, request.limit) }
      },
    },
    {
      name: 'files.read',
      description: 'Read an explicit local file path as UTF-8 text or base64.',
      inputSchema: inputSchema(FileReadSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      sensitiveDataPolicy:
        'File content is returned to the caller and is not logged by the broker.',
      invoke: async (_context, input) => {
        const request = FileReadSchema.parse(input)
        const info = await stat(request.path)
        if (!info.isFile()) throw new Error(`Path is not a regular file: ${request.path}`)
        if (info.size > request.maxBytes) throw new Error(`File exceeds maxBytes: ${info.size}`)
        const body = await readFile(request.path)
        return {
          path: request.path,
          size: body.byteLength,
          content: body.toString(request.encoding),
        }
      },
    },
    {
      name: 'files.write',
      description: 'Write UTF-8 or base64 content to an explicit local file path.',
      inputSchema: inputSchema(FileWriteSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      invoke: async (_context, input) => {
        const request = FileWriteSchema.parse(input)
        if (request.createParents) await mkdir(dirname(request.path), { recursive: true })
        const body = Buffer.from(request.content, request.encoding)
        await writeFile(request.path, body)
        return { path: request.path, size: body.byteLength }
      },
    },
    {
      name: 'files.list',
      description: 'List entries from an explicit local directory path.',
      inputSchema: inputSchema(FilePathInputSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (_context, input) => {
        const { path } = FilePathInputSchema.parse(input)
        const entries = await readdir(path, { withFileTypes: true })
        return {
          path,
          entries: entries.slice(0, 10_000).map((entry) => ({
            name: entry.name,
            kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          })),
          truncated: entries.length > 10_000,
        }
      },
    },
    {
      name: 'files.stat',
      description: 'Read metadata for an explicit local path.',
      inputSchema: inputSchema(FilePathInputSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (_context, input) => {
        const { path } = FilePathInputSchema.parse(input)
        const info = await stat(path)
        return {
          path,
          size: info.size,
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          modifiedAt: info.mtime.toISOString(),
        }
      },
    },
    {
      name: 'files.copy',
      description: 'Copy one explicit local file path to another.',
      inputSchema: inputSchema(FileTransferSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      invoke: async (_context, input) => {
        const request = FileTransferSchema.parse(input)
        await copyFile(request.source, request.destination)
        return { ...request }
      },
    },
    {
      name: 'files.move',
      description: 'Move or rename one explicit local path.',
      inputSchema: inputSchema(FileTransferSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      invoke: async (_context, input) => {
        const request = FileTransferSchema.parse(input)
        await rename(request.source, request.destination)
        return { ...request }
      },
    },
    {
      name: 'process.exec',
      description:
        'Run one local command with the current user permissions. Takes an argv array (no shell), ' +
        'supports cwd, extra environment variables, timeout, bounded output capture and cancellation. ' +
        'Every call requires explicit user confirmation.',
      inputSchema: inputSchema(ProcessExecSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'destructive',
      requiresCallConfirmation: true,
      supportsCancellation: true,
      sensitiveDataPolicy:
        'Command output is returned to the caller; environment values are never logged by the broker.',
      invoke: async (context, input) =>
        invokeHostProcessExec(ProcessExecSchema.parse(input), context.signal),
    },
    {
      name: 'models.list',
      description: 'List enabled model ids without exposing Provider credentials.',
      inputSchema: inputSchema(EmptyObjectSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async () => ({ models: listModels(providers) }),
    },
    {
      name: 'models.get',
      description: 'Resolve one enabled Provider and model selection.',
      inputSchema: inputSchema(ProviderSelectionSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (_context, input) => {
        const selection = ProviderSelectionSchema.parse(input)
        return publicModelSelection(resolveModelSelection(providers, selection))
      },
    },
    {
      name: 'models.invoke',
      description:
        'Run one non-streaming model request through an enabled HTTP Provider, ' +
        'optionally requesting JSON output via responseFormat.',
      inputSchema: inputSchema(ModelInvokeSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      sensitiveDataPolicy: 'Prompts and model output are not written to tool invocation logs.',
      invoke: async (_context, input) => {
        const request = ModelInvokeSchema.parse(input)
        const selection = resolveModelSelection(providers, request)
        const text = await invokeModel(selection.provider, selection.model, request)
        const json = request.responseFormat != null ? parseModelJsonOutput(text) : undefined
        return { ...publicModelSelection(selection), text, ...(json != null ? { json } : {}) }
      },
    },
    {
      name: 'agents.list',
      description: 'List enabled Spark Agents without exposing their system prompts or metadata.',
      inputSchema: inputSchema(EmptyObjectSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async () => ({ agents: agents.list().map(publicAgent) }),
    },
    {
      name: 'agents.get',
      description: 'Read public metadata for one Spark Agent.',
      inputSchema: inputSchema(AgentIdSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (_context, input) => {
        const { agentId } = AgentIdSchema.parse(input)
        const agent = agents.get(agentId)
        if (agent == null) throw new Error(`Spark Agent not found: ${agentId}`)
        return publicAgent(agent)
      },
    },
    {
      name: 'agents.invoke',
      description: 'Run one single-turn request using an enabled Spark Agent configuration.',
      inputSchema: inputSchema(AgentInvokeSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      sensitiveDataPolicy: 'Agent prompts and output are not written to tool invocation logs.',
      invoke: async (_context, input) => {
        const request = AgentInvokeSchema.parse(input)
        const agent = agents.get(request.agentId)
        if (agent == null || !agent.enabled) {
          throw new Error(`Spark Agent is unavailable: ${request.agentId}`)
        }
        const selection = resolveModelSelection(providers, {
          ...(agent.providerProfileId != null ? { providerId: agent.providerProfileId } : {}),
          ...(agent.modelId != null ? { model: agent.modelId } : {}),
        })
        const text = await invokeModel(selection.provider, selection.model, {
          prompt: request.prompt,
          ...(agent.prompt ? { system: agent.prompt } : {}),
          maxTokens: request.maxTokens,
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
        })
        return {
          agent: publicAgent(agent),
          executionMode: 'single-turn',
          ...publicModelSelection(selection),
          text,
        }
      },
    },
  ]
  definitions.push(
    ...createToolPackageWorkflowCapabilities(deps),
    ...createToolPackageBrowserCapabilities(deps),
    ...createToolPackageComputerCapabilities(deps),
    ...createToolPackageMediaCapabilities(deps),
  )
  const uploadFile = deps.uploadFile
  if (uploadFile != null) {
    definitions.push({
      name: 'files.upload',
      description: 'Upload an allowed local file through the active Spark account.',
      inputSchema: inputSchema(FileUploadSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'high-write',
      invoke: async (context, input) => uploadFile(context, FileUploadSchema.parse(input)),
    })
  }
  const presentFiles = deps.presentFiles
  if (presentFiles != null) {
    definitions.push({
      name: 'files.present',
      description: 'Present explicit local files to the user in the active Spark turn.',
      inputSchema: z.toJSONSchema(FilePresentSchema) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) => presentFiles(context, FilePresentSchema.parse(input)),
    })
    definitions.push({
      name: 'artifacts.present',
      description: 'Present completed artifact files to the user in the active Spark turn.',
      inputSchema: z.toJSONSchema(FilePresentSchema) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) => presentFiles(context, FilePresentSchema.parse(input)),
    })
  }
  const trashFile = deps.trashFile
  if (trashFile != null) {
    definitions.push({
      name: 'files.trash',
      description: 'Move one explicit local path to the operating-system trash or recycle bin.',
      inputSchema: inputSchema(FilePathInputSchema),
      outputSchema: GenericObjectOutputSchema,
      risk: 'destructive',
      requiresCallConfirmation: true,
      invoke: async (context, input) =>
        trashFile(context, z.object({ path: FilePathSchema }).parse(input)),
    })
  }
  const readClipboardText = deps.readClipboardText
  if (readClipboardText != null) {
    definitions.push({
      name: 'clipboard.read',
      description: 'Read the current plain-text clipboard contents.',
      inputSchema: z.toJSONSchema(z.object({})) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      sensitiveDataPolicy:
        'Clipboard text is returned to the package and is not logged by the broker.',
      invoke: async (context, input) => {
        z.object({}).parse(input)
        return { text: await readClipboardText(context) }
      },
    })
  }
  const writeClipboardText = deps.writeClipboardText
  if (writeClipboardText != null) {
    definitions.push({
      name: 'clipboard.write',
      description: 'Replace the current clipboard with plain text.',
      inputSchema: z.toJSONSchema(z.object({ text: z.string().max(2 * 1024 * 1024) })) as Record<
        string,
        unknown
      >,
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) =>
        writeClipboardText(
          context,
          z.object({ text: z.string().max(2 * 1024 * 1024) }).parse(input),
        ),
    })
  }
  const showNotification = deps.showNotification
  if (showNotification != null) {
    definitions.push({
      name: 'notifications.show',
      description: 'Show a local operating-system notification to the user.',
      inputSchema: z.toJSONSchema(
        z.object({ title: z.string().min(1).max(200), body: z.string().max(2_000).optional() }),
      ) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) =>
        showNotification(
          context,
          z
            .object({ title: z.string().min(1).max(200), body: z.string().max(2_000).optional() })
            .parse(input),
        ),
    })
  }
  const openExternal = deps.openExternal
  if (openExternal != null) {
    definitions.push({
      name: 'browser.open',
      description: 'Open a validated external URL with the operating-system default handler.',
      inputSchema: z.toJSONSchema(z.object({ url: z.string().url().max(32_768) })) as Record<
        string,
        unknown
      >,
      outputSchema: GenericObjectOutputSchema,
      risk: 'low-write',
      invoke: async (context, input) =>
        openExternal(context, z.object({ url: z.string().url().max(32_768) }).parse(input)),
    })
  }
  const openDialog = deps.openDialog
  if (openDialog != null) {
    definitions.push({
      name: 'dialogs.open',
      description: 'Ask the user to choose one or more local files or directories.',
      inputSchema: z.toJSONSchema(DialogOpenSchema) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (context, input) => openDialog(context, DialogOpenSchema.parse(input)),
    })
  }
  const saveDialog = deps.saveDialog
  if (saveDialog != null) {
    definitions.push({
      name: 'dialogs.save',
      description: 'Ask the user to choose a destination path. This does not write the file.',
      inputSchema: z.toJSONSchema(DialogSaveSchema) as Record<string, unknown>,
      outputSchema: GenericObjectOutputSchema,
      risk: 'read',
      invoke: async (context, input) => saveDialog(context, DialogSaveSchema.parse(input)),
    })
  }
  const unregister = definitions.map((definition) => broker.register(definition))
  return () => {
    for (const dispose of unregister.reverse()) dispose()
  }
}

async function invokeHostHttpFetch(
  request: z.infer<typeof HttpFetchSchema>,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const onAbort = () =>
    controller.abort(new DOMException('HTTP request was cancelled', 'AbortError'))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted === true) onAbort()
  const timer = setTimeout(
    () => controller.abort(new DOMException('HTTP request timed out', 'TimeoutError')),
    request.timeoutMs,
  )
  try {
    const response = await fetch(request.url, {
      method: request.method,
      ...(request.headers != null ? { headers: request.headers } : {}),
      ...(request.body != null ? { body: request.body } : {}),
      signal: controller.signal,
      redirect: 'follow',
    })
    const body = await readBoundedResponse(response, request.maxResponseBytes)
    const text = body.toString('utf8')
    const content =
      request.responseType === 'base64'
        ? body.toString('base64')
        : request.responseType === 'json'
          ? JSON.parse(text)
          : text
    return {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      content,
      size: body.byteLength,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (response.body == null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      total += chunk.byteLength
      if (total > maxBytes) {
        await reader.cancel('response exceeds configured byte limit')
        throw new Error(`HTTP response exceeds maxResponseBytes: more than ${maxBytes}`)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

/**
 * Runs one confirmed local command. Non-zero exits resolve as completed runs
 * (exit code is data, not a host error); timeouts and cancellations kill the
 * whole process tree and resolve with an explicit status so callers keep the
 * partial output.
 */
async function invokeHostProcessExec(
  request: z.infer<typeof ProcessExecSchema>,
  signal?: AbortSignal,
): Promise<unknown> {
  const startedAt = Date.now()
  if (signal?.aborted === true) {
    throw new DOMException('process.exec was cancelled before start', 'AbortError')
  }
  const spawnOptions: SpawnOptions = {
    ...(request.cwd != null ? { cwd: request.cwd } : {}),
    shell: process.platform === 'win32',
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(request.env != null ? { env: { ...process.env, ...request.env } } : {}),
  }
  const [executable, ...args] = request.command
  if (executable == null || executable.length === 0) {
    throw new Error('process.exec requires a non-empty command')
  }
  const child = spawn(executable, args, spawnOptions)

  const stdout = createBoundedCapture(request.maxOutputBytes)
  const stderr = createBoundedCapture(request.maxOutputBytes)
  child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk))

  let timedOut = false
  let cancelled = false
  const timer = setTimeout(() => {
    timedOut = true
    terminateProcessTree(child)
  }, request.timeoutMs)
  const onAbort = () => {
    cancelled = true
    terminateProcessTree(child)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error(`process.exec failed to start: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(code)
    })
  })

  return {
    command: request.command,
    status: timedOut ? 'timeout' : cancelled ? 'cancelled' : 'completed',
    exitCode,
    durationMs: Date.now() - startedAt,
    stdout: stdout.text(),
    stderr: stderr.text(),
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  }
}

interface BoundedCapture {
  append(chunk: Buffer): void
  text(): string
  readonly truncated: boolean
}

/** Keeps at most maxBytes of output; anything beyond sets truncated. */
function createBoundedCapture(maxBytes: number): BoundedCapture {
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  return {
    append(chunk) {
      if (truncated || total >= maxBytes) return
      total += chunk.byteLength
      if (total > maxBytes) {
        const remaining = chunk.byteLength - (total - maxBytes)
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
        total = maxBytes
        truncated = true
        return
      }
      chunks.push(chunk)
    },
    text() {
      return Buffer.concat(chunks).toString('utf8')
    },
    get truncated() {
      return truncated
    },
  }
}

type ProviderRow = NonNullable<ReturnType<ProviderProfileRepository['get']>>

interface ProviderConfig {
  apiEndpoint?: string
  defaultModel?: string
  modelIds?: string[]
}

function listModels(providers: ProviderProfileRepository) {
  return providers
    .listAll()
    .filter((provider) => provider.enabled === 1)
    .flatMap((provider) => {
      const config = parseProviderConfig(provider)
      const ids = uniqueStrings([
        ...(config.modelIds ?? []),
        ...(config.defaultModel ? [config.defaultModel] : []),
      ])
      return ids.map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.provider_type,
        model,
        default: config.defaultModel === model,
      }))
    })
}

function resolveModelSelection(
  providers: ProviderProfileRepository,
  selection: { providerId?: string | undefined; model?: string | undefined },
): { provider: ProviderRow; model: string } {
  const provider =
    (selection.providerId != null ? providers.get(selection.providerId) : providers.getDefault()) ??
    providers.listAll().find((candidate) => candidate.enabled === 1) ??
    null
  if (provider == null || provider.enabled !== 1) {
    throw new Error('No enabled Spark model Provider is available')
  }
  const config = parseProviderConfig(provider)
  const model = selection.model ?? config.defaultModel ?? config.modelIds?.[0]
  if (model == null || model.trim().length === 0) {
    throw new Error(`Spark model is not configured for Provider: ${provider.id}`)
  }
  if (
    config.modelIds != null &&
    config.modelIds.length > 0 &&
    !config.modelIds.includes(model) &&
    config.defaultModel !== model
  ) {
    throw new Error(`Spark model is not registered on Provider ${provider.id}: ${model}`)
  }
  return { provider, model }
}

async function invokeModel(
  provider: ProviderRow,
  model: string,
  request: {
    prompt: string
    system?: string | undefined
    maxTokens: number
    temperature?: number | undefined
    responseFormat?: { type: 'json'; schema?: Record<string, unknown> | undefined } | undefined
  },
): Promise<string> {
  if (provider.provider_type === 'local-cli' || provider.provider_type === 'local-codex-cli') {
    throw new Error(`Provider does not expose an HTTP model endpoint: ${provider.id}`)
  }
  if (request.responseFormat != null && provider.provider_type === 'anthropic') {
    throw new Error('responseFormat is not supported on Anthropic Providers')
  }
  const config = parseProviderConfig(provider)
  const apiKey = await resolveProviderApiKey(provider)
  const anthropic = provider.provider_type === 'anthropic'
  const openAiResponseFormat = buildOpenAiResponseFormat(request.responseFormat)
  const endpoint = anthropic
    ? anthropicMessagesEndpoint(config.apiEndpoint)
    : openAiChatEndpoint(config.apiEndpoint)
  const response = await fetchJson<{
    content?: Array<{ type?: string; text?: string }>
    choices?: Array<{ message?: { content?: string } }>
  }>(endpoint, {
    method: 'POST',
    headers: anthropic
      ? {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          'anthropic-version': '2023-06-01',
        }
      : {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
    body: JSON.stringify(
      anthropic
        ? {
            model,
            max_tokens: request.maxTokens,
            ...(request.system ? { system: request.system } : {}),
            ...(request.temperature != null ? { temperature: request.temperature } : {}),
            messages: [{ role: 'user', content: request.prompt }],
          }
        : {
            model,
            max_tokens: request.maxTokens,
            ...(request.temperature != null ? { temperature: request.temperature } : {}),
            ...(openAiResponseFormat != null ? { response_format: openAiResponseFormat } : {}),
            messages: [
              ...(request.system ? [{ role: 'system', content: request.system }] : []),
              { role: 'user', content: request.prompt },
            ],
          },
    ),
    timeoutMs: 120_000,
  })
  const text = anthropic
    ? response.content
        ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
    : response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Spark model returned no text output')
  }
  return text
}

function parseProviderConfig(provider: ProviderRow): ProviderConfig {
  try {
    const parsed = JSON.parse(provider.config_json) as Record<string, unknown>
    return {
      ...(typeof parsed.apiEndpoint === 'string' ? { apiEndpoint: parsed.apiEndpoint } : {}),
      ...(typeof parsed.defaultModel === 'string' ? { defaultModel: parsed.defaultModel } : {}),
      ...(Array.isArray(parsed.modelIds)
        ? { modelIds: parsed.modelIds.filter((item): item is string => typeof item === 'string') }
        : {}),
    }
  } catch {
    return {}
  }
}

function publicAgent(agent: ReturnType<AgentRepository['list']>[number]) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    builtIn: agent.builtIn,
    enabled: agent.enabled,
    providerProfileId: agent.providerProfileId ?? null,
    modelId: agent.modelId ?? null,
  }
}

function publicModelSelection(selection: { provider: ProviderRow; model: string }) {
  return {
    providerId: selection.provider.id,
    providerName: selection.provider.name,
    providerType: selection.provider.provider_type,
    model: selection.model,
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function openAiChatEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function buildOpenAiResponseFormat(
  responseFormat: { type: 'json'; schema?: Record<string, unknown> | undefined } | undefined,
): Record<string, unknown> | undefined {
  if (responseFormat == null) return undefined
  if (responseFormat.schema != null) {
    return {
      type: 'json_schema',
      json_schema: { name: 'result', strict: false, schema: responseFormat.schema },
    }
  }
  return { type: 'json_object' }
}

/**
 * Best-effort JSON extraction: returns the parsed value, or null with the
 * parse error surfaced so tool authors can decide how to retry.
 */
function parseModelJsonOutput(text: string): { value: unknown; error?: string } | null {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch (directError) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
    if (fenced != null) {
      try {
        return { value: JSON.parse(fenced.trim()) as unknown }
      } catch {
        // fall through to the direct error
      }
    }
    return {
      value: null,
      error: directError instanceof Error ? directError.message : String(directError),
    }
  }
}

function anthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/messages')) return base
  if (/\/v\d+$/i.test(base)) return `${base}/messages`
  return `${base}/v1/messages`
}
