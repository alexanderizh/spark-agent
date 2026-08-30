import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

import type { ToolDefinition } from './contract.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

export class ToolArgumentValidator {
  readonly #ajv = new Ajv({ allErrors: true, strict: true });
  readonly #validators = new WeakMap<ToolDefinition, ValidateFunction>();

  validate(definition: ToolDefinition, args: unknown): ValidationResult {
    const cached = this.#validators.get(definition);
    const validator = cached ?? this.#ajv.compile(definition.inputSchema);
    if (!cached) this.#validators.set(definition, validator);
    if (validator(args)) return { valid: true };
    return { valid: false, message: formatErrors(validator.errors ?? []) };
  }
}

function formatErrors(errors: readonly ErrorObject[]): string {
  if (errors.length === 0) return 'Arguments do not match the tool schema';
  return errors
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
}
