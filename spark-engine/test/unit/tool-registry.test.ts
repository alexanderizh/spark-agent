import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/tools/contract.js';
import { OrderedToolRegistry } from '../../src/tools/registry.js';

describe('tool registry contract boundary', () => {
  it('rejects permission metadata that could bypass plan mode', () => {
    expect(() => new OrderedToolRegistry([definition({ readonly: false, permissionClass: 'read' })]))
      .toThrow(/inconsistent readonly and permissionClass/u);
    expect(
      () =>
        new OrderedToolRegistry([
          definition({ readonly: true, permissionClass: 'workspace-write' }),
        ]),
    ).toThrow(/inconsistent readonly and permissionClass/u);
  });

  it('clones and freezes the registered JSON schema', () => {
    const source = definition({ readonly: true, permissionClass: 'read' });
    const registry = new OrderedToolRegistry([source]);
    const registered = registry.get(source.name);

    expect(registered).not.toBe(source);
    expect(registered?.inputSchema).not.toBe(source.inputSchema);
    expect(Object.isFrozen(registered?.inputSchema)).toBe(true);
  });
});

function definition(
  overrides: Pick<ToolDefinition, 'readonly' | 'permissionClass'>,
): ToolDefinition {
  return {
    name: 'test',
    description: 'test tool',
    inputSchema: { type: 'object', properties: {} },
    approval: 'never',
    concurrency: 'parallel',
    timeoutMs: 1_000,
    interruptible: true,
    costClass: 'io',
    ...overrides,
  };
}
