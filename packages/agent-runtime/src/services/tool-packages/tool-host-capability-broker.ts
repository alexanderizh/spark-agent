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
}

export interface ToolHostCapabilityDefinition {
  name: string
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
      return await definition.invoke(params.context, params.input)
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
