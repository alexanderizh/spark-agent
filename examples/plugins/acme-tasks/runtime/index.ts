import { defineConnectorRuntime, defineTool } from '@spark/plugin-sdk'
import { z } from 'zod'

/**
 * This file is the worker-side implementation. It is intentionally not
 * imported by Spark's Electron main process. The production worker host will
 * start the bundled entrypoint through its restricted JSON-RPC boundary.
 */
export default defineConnectorRuntime({
  descriptor: {
    id: 'acme-tasks',
    pluginId: 'com.acme.tasks',
    provider: 'acme',
    displayName: 'Acme Tasks',
    description: 'Search and update tasks in an authorized Acme workspace.',
    icon: 'generic',
    toolNamespace: 'acme',
    accountMode: 'multiple',
    execution: {
      type: 'worker',
      entrypoint: 'runtime/index.js',
      packageSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    },
    authMethods: ['oauth2'],
    capabilities: [
      {
        id: 'tasks.read',
        label: '读取任务',
        description: '读取当前账号可见的任务。',
        enabledByDefault: true,
      },
      {
        id: 'tasks.write',
        label: '修改任务',
        description: '创建和更新任务，动作需要确认。',
        enabledByDefault: false,
      },
    ],
  },
  tools: [
    defineTool({
      name: 'search_tasks',
      title: '搜索任务',
      description: '按关键词和状态搜索当前账号可访问的任务。',
      input: z.object({
        query: z.string().max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      requiredCapabilities: ['tasks.read'],
      risk: 'read',
      effect: 'read',
      idempotency: 'safe',
      async handler(ctx, input) {
        ctx.policy.requireCapability('tasks.read')
        return ctx.http.get('/v1/tasks', { q: input.query, limit: input.limit })
      },
    }),
    defineTool({
      name: 'update_task',
      title: '更新任务',
      description: '更新一个任务的标题或状态，需要动作确认。',
      input: z.object({
        taskId: z.string().min(1).max(120),
        title: z.string().max(200).optional(),
        status: z.enum(['todo', 'in_progress', 'done']).optional(),
      }),
      requiredCapabilities: ['tasks.write'],
      risk: 'high-write',
      effect: 'update',
      idempotency: 'keyed',
      preview: (input) => ({ taskId: input.taskId, fields: Object.keys(input) }),
      async handler(ctx, input) {
        ctx.policy.requireCapability('tasks.write')
        ctx.policy.requireConfirmation()
        return ctx.http.request({
          path: `/v1/tasks/${encodeURIComponent(input.taskId)}`,
          method: 'PATCH',
          json: input,
        })
      },
    }),
  ],
})
