import type { ToolRegistry } from '../seams.js';
import type { ToolDefinition } from './contract.js';

export class OrderedToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(definitions: readonly ToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ToolDefinition): () => void {
    validateDefinition(definition);
    if (this.#tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    this.#tools.set(definition.name, freezeDefinition(definition));
    return () => {
      this.#tools.delete(definition.name);
    };
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  list(): readonly ToolDefinition[] {
    return [...this.#tools.values()];
  }
}

function validateDefinition(definition: ToolDefinition): void {
  if (!definition.name.trim()) throw new Error('Tool name must not be empty');
  if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0) {
    throw new Error(`Tool ${definition.name} requires a positive integer timeout`);
  }
  const classifiedRead = definition.permissionClass === 'read';
  if (classifiedRead !== definition.readonly) {
    throw new Error(
      `Tool ${definition.name} has inconsistent readonly and permissionClass metadata`,
    );
  }
  if (definition.destructive && classifiedRead) {
    throw new Error(`Tool ${definition.name} cannot be both destructive and read-only`);
  }
}

function freezeDefinition(definition: ToolDefinition): ToolDefinition {
  const inputSchema = structuredClone(definition.inputSchema);
  deepFreeze(inputSchema);
  return Object.freeze({ ...definition, inputSchema });
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}
