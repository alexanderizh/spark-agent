import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import type { FetchLike } from '../llm/http/client.js'
import type { ModelProtocol } from '../llm/registry.js'

const DescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    host: z.literal('sparkwork'),
    instanceId: z.string().min(16).max(200),
    endpoint: z.url().max(2_000),
    token: z.string().min(32).max(512),
    pid: z.number().int().positive(),
    startedAt: z.iso.datetime(),
  })
  .strict()

const RouteSchema = z
  .object({
    routeId: z.string().min(1).max(2_000),
    providerId: z.string().min(1).max(500),
    providerName: z.string().min(1).max(500),
    protocol: z.enum(['anthropic-messages', 'openai-responses']),
    model: z.string().min(1).max(1_000),
    contextWindow: z.number().int().positive().optional(),
  })
  .strict()

const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    host: z.literal('sparkwork'),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    generatedAt: z.iso.datetime(),
    defaultRoute: z.string().min(1).max(2_000).optional(),
    routes: z.array(RouteSchema).max(10_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    const routeIds = new Set<string>()
    for (const [index, route] of catalog.routes.entries()) {
      if (routeIds.has(route.routeId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate route id: ${route.routeId}`,
          path: ['routes', index, 'routeId'],
        })
      }
      routeIds.add(route.routeId)
    }
    if (catalog.defaultRoute && !routeIds.has(catalog.defaultRoute)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultRoute must reference a catalog route',
        path: ['defaultRoute'],
      })
    }
  })

type Descriptor = z.output<typeof DescriptorSchema>

// Each SparkWork instance owns one descriptor file (bridge-<instanceId>.json), so
// concurrent instances never delete each other's state and crash leftovers are
// distinguishable from live bridges.
const DESCRIPTOR_NAME = /^bridge-[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.json$/u
const MAX_PROBED_DESCRIPTORS = 8
const LIVE_BRIDGE_TIMEOUT_MS = 2_000
// A descriptor whose owner pid is gone can only answer by port-reuse accident;
// keep a short budget so stale files never dominate startup latency.
const DEAD_BRIDGE_TIMEOUT_MS = 250

export interface SparkWorkHostRoute {
  readonly routeId: string
  readonly providerId: string
  readonly providerName: string
  readonly protocol: ModelProtocol
  readonly model: string
  readonly contextWindow?: number
}

export interface SparkWorkHostCatalog {
  readonly revision: string
  readonly generatedAt: string
  readonly defaultRoute?: string
  readonly routes: readonly SparkWorkHostRoute[]
  readonly endpoint: string
  readonly token: string
}

export interface SparkWorkHostDiscovery {
  readonly catalog?: SparkWorkHostCatalog
  readonly diagnostic?: string
  readonly staleBridgeDescriptors: number
}

export interface DiscoverSparkWorkHostOptions {
  readonly sparkHome: string
  readonly descriptorPath?: string
  readonly fetch?: FetchLike
}

interface CandidateOutcome {
  readonly startedAt: string
  readonly catalog?: SparkWorkHostCatalog
  readonly reason?: string
  readonly missing?: boolean
}

export async function discoverSparkWorkHost(
  options: DiscoverSparkWorkHostOptions,
): Promise<SparkWorkHostDiscovery> {
  const fetcher = options.fetch ?? fetch
  if (options.descriptorPath) {
    return settle([await probeDescriptor(resolve(options.descriptorPath), fetcher)])
  }

  const hostsDir = resolve(options.sparkHome, 'hosts', 'sparkwork')
  let entries: Dirent[]
  try {
    entries = await readdir(hostsDir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { staleBridgeDescriptors: 0 }
    return {
      diagnostic: `SparkWork bridge descriptors are unavailable: ${message(error)}`,
      staleBridgeDescriptors: 0,
    }
  }

  const names = entries
    .filter((entry) => entry.isFile() && DESCRIPTOR_NAME.test(entry.name))
    .map((entry) => entry.name)
  const ordered = await orderCandidates(hostsDir, names)
  if (ordered.length === 0) return { staleBridgeDescriptors: 0 }

  const outcomes = await Promise.all(
    ordered.map((name) => probeDescriptor(resolve(hostsDir, name), fetcher)),
  )
  return settle(outcomes)
}

function settle(outcomes: readonly CandidateOutcome[]): SparkWorkHostDiscovery {
  const successes = outcomes.filter(
    (outcome): outcome is CandidateOutcome & { catalog: SparkWorkHostCatalog } =>
      outcome.catalog !== undefined,
  )
  if (successes.length > 0) {
    const winner = successes.reduce((best, next) => (next.startedAt > best.startedAt ? next : best))
    return {
      catalog: winner.catalog,
      staleBridgeDescriptors: outcomes.length - successes.length,
    }
  }
  const reason = outcomes.find((outcome) => outcome.reason)?.reason ?? 'no reachable bridge'
  if (outcomes.every((outcome) => outcome.missing)) return { staleBridgeDescriptors: 0 }
  return {
    diagnostic: `SparkWork bridge is not reachable: ${reason}`,
    staleBridgeDescriptors: outcomes.length,
  }
}

async function orderCandidates(
  hostsDir: string,
  names: readonly string[],
): Promise<readonly string[]> {
  const stamped: { name: string; mtimeMs: number }[] = []
  for (const name of names) {
    try {
      const info = await stat(resolve(hostsDir, name))
      stamped.push({ name, mtimeMs: info.mtimeMs })
    } catch {
      // Deleted between readdir and stat: nothing to probe.
    }
  }
  return stamped
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, MAX_PROBED_DESCRIPTORS)
    .map((item) => item.name)
}

async function probeDescriptor(
  descriptorPath: string,
  fetcher: FetchLike,
): Promise<CandidateOutcome> {
  const read = await readDescriptor(descriptorPath)
  if ('reason' in read) {
    return {
      startedAt: '',
      reason: read.reason,
      ...(read.missing ? { missing: true } : {}),
    }
  }
  try {
    const catalog = await fetchCatalog(read.descriptor, fetcher)
    return { startedAt: read.descriptor.startedAt, catalog }
  } catch (error) {
    return { startedAt: read.descriptor.startedAt, reason: message(error) }
  }
}

async function readDescriptor(
  descriptorPath: string,
): Promise<{ descriptor: Descriptor } | { reason: string; missing?: boolean }> {
  let raw: string
  try {
    await assertPrivateDescriptor(descriptorPath)
    raw = await readFile(descriptorPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { reason: `descriptor ${descriptorPath} is gone`, missing: true }
    }
    return { reason: `descriptor is unreadable: ${message(error)}` }
  }
  try {
    const descriptor = DescriptorSchema.parse(JSON.parse(raw))
    assertLoopbackEndpoint(descriptor.endpoint)
    return { descriptor }
  } catch (error) {
    return { reason: `descriptor is invalid: ${message(error)}` }
  }
}

async function fetchCatalog(
  descriptor: Descriptor,
  fetcher: FetchLike,
): Promise<SparkWorkHostCatalog> {
  const timeout = isProcessAlive(descriptor.pid)
    ? LIVE_BRIDGE_TIMEOUT_MS
    : DEAD_BRIDGE_TIMEOUT_MS
  let response: Response
  try {
    response = await fetcher(`${stripTrailingSlash(descriptor.endpoint)}/v1/catalog`, {
      headers: { authorization: `Bearer ${descriptor.token}` },
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new Error(`bridge pid ${descriptor.pid} did not answer (${message(error)})`, { cause: error })
  }
  if (!response.ok) {
    throw new Error(`bridge pid ${descriptor.pid} rejected catalog (HTTP ${response.status})`)
  }
  try {
    const catalog = CatalogSchema.parse(JSON.parse(await readBoundedResponse(response)))
    return Object.freeze({
      revision: catalog.revision,
      generatedAt: catalog.generatedAt,
      ...(catalog.defaultRoute ? { defaultRoute: catalog.defaultRoute } : {}),
      routes: Object.freeze(
        catalog.routes.map((route) =>
          Object.freeze({
            routeId: route.routeId,
            providerId: route.providerId,
            providerName: route.providerName,
            protocol: route.protocol,
            model: route.model,
            ...(route.contextWindow === undefined ? {} : { contextWindow: route.contextWindow }),
          }),
        ),
      ),
      endpoint: stripTrailingSlash(descriptor.endpoint),
      token: descriptor.token,
    })
  } catch (error) {
    throw new Error(`bridge returned an invalid model catalog: ${message(error)}`, { cause: error })
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    // EPERM means the process exists but belongs to another user; only ESRCH
    // proves the pid is gone.
    return errorCode(error) !== 'ESRCH'
  }
  return true
}

export function resolveSparkWorkRoute(
  catalog: SparkWorkHostCatalog,
  requested: string,
): SparkWorkHostRoute | undefined {
  const exact = catalog.routes.find((route) => route.routeId === requested)
  if (exact) return exact
  const byModel = catalog.routes.filter((route) => route.model === requested)
  if (byModel.length === 1) return byModel[0]
  if (byModel.length > 1) {
    const alternatives = byModel.map((route) => route.routeId).join(', ')
    throw new Error(
      `Model ${requested} exists in multiple SparkWork providers; use one of: ${alternatives}`,
    )
  }
  return undefined
}

export function sparkWorkProxyBaseUrl(
  catalog: SparkWorkHostCatalog,
  route: SparkWorkHostRoute,
): string {
  return `${catalog.endpoint}/v1/proxy/${encodeURIComponent(route.providerId)}`
}

async function assertPrivateDescriptor(path: string): Promise<void> {
  const descriptorStat = await stat(path)
  if (!descriptorStat.isFile() || descriptorStat.size > 64 * 1024) {
    throw new Error('descriptor must be a regular file no larger than 64 KiB')
  }
  if (process.platform === 'win32') return
  if ((descriptorStat.mode & 0o077) !== 0) {
    throw new Error('descriptor permissions must be 0600 or stricter')
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error('catalog response has no body')
  const maximum = 8 * 1024 * 1024
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      const value: unknown = item.value
      if (!(value instanceof Uint8Array)) throw new Error('catalog response is not a byte stream')
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel('catalog response exceeds 8 MiB')
        throw new Error('catalog response exceeds 8 MiB')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function assertLoopbackEndpoint(value: string): void {
  const endpoint = new URL(value)
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('bridge endpoint must use HTTP on a loopback address')
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('bridge endpoint must not contain credentials, path, query, or fragment')
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
