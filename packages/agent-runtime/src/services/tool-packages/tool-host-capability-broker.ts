import { z } from 'zod'

export interface ToolHostCapabilityContext {
  packageId: string
  packageVersion: string
  toolName: string
  invocationId: string
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  correlationId?: string
  signal?: AbortSignal
}

export interface ToolHostCapabilityDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  risk?: 'read' | 'low-write' | 'high-write' | 'destructive'
  supportsCancellation?: boolean
  supportsProgress?: boolean
  requiresCallConfirmation?: boolean
  sensitiveDataPolicy?: string
  invoke(context: ToolHostCapabilityContext, input: unknown): Promise<unknown>
}

export class ToolHostCapabilityError extends Error {
  constructor(
    readonly code:
      | 'CAPABILITY_NOT_DECLARED'
      | 'CAPABILITY_NOT_AUTHORIZED'
      | 'CAPABILITY_UNAVAILABLE'
      | 'CAPABILITY_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ToolHostCapabilityError'
  }
}

/** Versioned host capability registry used by every Tool Process language. */
export class ToolHostCapabilityBroker {
  readonly protocolVersion = 1 as const
  private readonly definitions = new Map<string, ToolHostCapabilityDefinition>()
  private invocationAuthorizer:
    | ((params: {
        definition: Omit<ToolHostCapabilityDefinition, 'invoke'>
        context: ToolHostCapabilityContext
        input: unknown
      }) => Promise<boolean>)
    | undefined

  setInvocationAuthorizer(
    authorizer:
      | ((params: {
          definition: Omit<ToolHostCapabilityDefinition, 'invoke'>
          context: ToolHostCapabilityContext
          input: unknown
        }) => Promise<boolean>)
      | null,
  ): void {
    this.invocationAuthorizer = authorizer ?? undefined
  }

  register(definition: ToolHostCapabilityDefinition): () => void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Tool host capability already registered: ${definition.name}`)
    }
    this.definitions.set(definition.name, definition)
    return () => {
      if (this.definitions.get(definition.name) === definition) {
        this.definitions.delete(definition.name)
      }
    }
  }

  list(): string[] {
    return [...this.definitions.keys()].sort()
  }

  describe(): Array<Omit<ToolHostCapabilityDefinition, 'invoke'>> {
    return [...this.definitions.values()]
      .map(({ invoke: _invoke, ...definition }) => definition)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async invoke(params: {
    capability: string
    declaredCapabilities: ReadonlySet<string>
    grantedCapabilities: ReadonlySet<string>
    context: ToolHostCapabilityContext
    input: unknown
  }): Promise<unknown> {
    if (!params.declaredCapabilities.has(params.capability)) {
      throw new ToolHostCapabilityError(
        'CAPABILITY_NOT_DECLARED',
        `Tool package did not declare Spark capability: ${params.capability}`,
      )
    }
    if (!params.grantedCapabilities.has(params.capability)) {
      throw new ToolHostCapabilityError(
        'CAPABILITY_NOT_AUTHORIZED',
        `Tool package is not authorized to use Spark capability: ${params.capability}`,
      )
    }
    const definition = this.definitions.get(params.capability)
    if (definition == null) {
      throw new ToolHostCapabilityError(
        'CAPABILITY_UNAVAILABLE',
        `Spark capability is unavailable: ${params.capability}`,
      )
    }
    try {
      const input = validateCapabilityValue(
        params.capability,
        'input',
        definition.inputSchema,
        params.input,
      )
      if (definition.requiresCallConfirmation === true) {
        const { invoke: _invoke, ...descriptor } = definition
        const authorized = await this.invocationAuthorizer?.({
          definition: descriptor,
          context: params.context,
          input,
        })
        if (authorized !== true) {
          throw new ToolHostCapabilityError(
            'CAPABILITY_NOT_AUTHORIZED',
            `Spark capability call was not confirmed: ${params.capability}`,
          )
        }
      }
      const result = await definition.invoke(params.context, input)
      return validateCapabilityValue(params.capability, 'output', definition.outputSchema, result)
    } catch (error) {
      if (error instanceof ToolHostCapabilityError) throw error
      throw new ToolHostCapabilityError(
        'CAPABILITY_FAILED',
        `Spark capability failed: ${params.capability}`,
        { cause: error },
      )
    }
  }
}

function validateCapabilityValue(
  capability: string,
  boundary: 'input' | 'output',
  schema: Record<string, unknown> | undefined,
  value: unknown,
): unknown {
  if (schema == null) return value
  const parsed = z.fromJSONSchema(schema).safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `Spark capability ${capability} ${boundary} failed schema validation: ${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data
}
