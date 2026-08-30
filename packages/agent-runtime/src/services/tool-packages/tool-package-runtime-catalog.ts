import { createHash } from 'node:crypto'
import type { RuntimeToolDefinition } from '@spark/protocol'
import { z } from 'zod'
import type { ToolPackageService } from './tool-package.service.js'
import type { ToolProcessInvocationContext } from './tool-process-host.js'

export interface ToolPackageCatalogEntry {
  qualifiedName: string
  packageId: string
  version: string
  toolName: string
  tool: RuntimeToolDefinition
  invoke(input: Record<string, unknown>): Promise<unknown>
}

/** Business-neutral catalog for installed and enabled Tool Package versions. */
export class ToolPackageRuntimeCatalog {
  constructor(private readonly service: ToolPackageService) {}

  list(context: Omit<ToolProcessInvocationContext, 'environment'> = {}): ToolPackageCatalogEntry[] {
    return this.service
      .listEnabledTools()
      .flatMap((entry) => {
        const definition = entry.manifest.tools.find((tool) => tool.name === entry.toolName)
        if (definition == null) return []
        const inputSchema = z.fromJSONSchema(definition.inputSchema)
        return [
          {
            qualifiedName: qualifiedToolName(entry.packageId, entry.toolName),
            packageId: entry.packageId,
            version: entry.version,
            toolName: entry.toolName,
            tool: {
              name: `${entry.packageId}/${entry.toolName}`,
              title: definition.title,
              description: definition.description,
              inputSchema: definition.inputSchema,
              requiredCapabilities: [],
              risk: definition.risk,
              effect: definition.effect,
              idempotency: definition.idempotency,
            },
            invoke: async (input: Record<string, unknown>) => {
              const parsed = inputSchema.safeParse(input)
              if (!parsed.success) {
                throw new Error(
                  `Invalid input for Tool Package ${entry.packageId}/${entry.toolName}: ${z.prettifyError(parsed.error)}`,
                )
              }
              if (
                parsed.data == null ||
                typeof parsed.data !== 'object' ||
                Array.isArray(parsed.data)
              ) {
                throw new Error(
                  `Invalid input for Tool Package ${entry.packageId}/${entry.toolName}: expected an object`,
                )
              }
              return this.service.invokeInstalledVersion({
                packageId: entry.packageId,
                version: entry.version,
                toolName: entry.toolName,
                input: parsed.data,
                context,
              })
            },
          },
        ]
      })
      .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName))
  }
}

function qualifiedToolName(packageId: string, toolName: string): string {
  const readable = `${packageId}_${toolName}`.replace(/[^a-z0-9_-]/g, '_')
  const hash = createHash('sha256').update(`${packageId}/${toolName}`).digest('hex').slice(0, 10)
  const prefix = 'package_'
  const readableLimit = 64 - prefix.length - 1 - hash.length
  return `${prefix}${readable.slice(0, readableLimit)}_${hash}`
}
