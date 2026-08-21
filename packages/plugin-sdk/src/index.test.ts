import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMockRuntimeContext, runRuntimeContract } from './testing.js'
import { defineConnectorRuntime, defineTool } from './index.js'

const runtime = defineConnectorRuntime({
  descriptor: {
    id: 'acme-tasks',
    pluginId: 'com.acme.tasks',
    provider: 'acme',
    displayName: 'Acme Tasks',
    description: 'Contract fixture',
    icon: 'generic',
    toolNamespace: 'acme',
    accountMode: 'multiple',
    execution: {
      type: 'worker',
      entrypoint: 'runtime/index.js',
      packageSha256: '0'.repeat(64),
    },
    authMethods: ['oauth2'],
    capabilities: [
      {
        id: 'tasks.read',
        label: 'Tasks read',
        description: 'Read tasks',
        enabledByDefault: true,
      },
    ],
  },
  tools: [
    defineTool({
      name: 'search_tasks',
      title: 'Search tasks',
      description: 'Search tasks by query.',
      input: z.object({ query: z.string().max(200) }),
      requiredCapabilities: ['tasks.read'],
      risk: 'read',
      effect: 'read',
      idempotency: 'safe',
      async handler(ctx, input) {
        ctx.policy.requireCapability('tasks.read')
        return { query: input.query, accountId: ctx.account.id }
      },
    }),
  ],
})

describe('@spark/plugin-sdk', () => {
  it('builds a descriptor and validates zod input at invocation time', async () => {
    expect(runtime.listTools()[0]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          maxLength: 200,
        },
      },
    })
    expect(runtime.listTools()[0]?.inputSchema).not.toHaveProperty('$schema')
    await expect(
      runtime.invokeTool(createMockRuntimeContext(), 'search_tasks', { query: 42 }),
    ).rejects.toThrow()
    await expect(
      runtime.invokeTool(createMockRuntimeContext(), 'search_tasks', { query: 'inbox' }),
    ).resolves.toMatchObject({ query: 'inbox' })
  })

  it('passes the baseline runtime contract', async () => {
    await expect(runRuntimeContract(runtime)).resolves.toBeUndefined()
  })

  it('rejects unsafe tool metadata at definition time', () => {
    expect(() =>
      defineTool({
        name: 'delete_task',
        title: 'Delete task',
        description: 'Delete a task.',
        input: z.object({ id: z.string() }),
        risk: 'destructive',
        effect: 'delete',
        idempotency: 'keyed',
        async handler() {
          return null
        },
      }),
    ).toThrow('unsafe idempotency')
  })
})
