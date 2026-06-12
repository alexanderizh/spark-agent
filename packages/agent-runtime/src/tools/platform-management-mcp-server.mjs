#!/usr/bin/env node
/**
 * Platform Management MCP Server
 *
 * Exposes 34 tools for managing the Spark Agent platform:
 *   Skills (5), MCP Servers (5), Providers (5),
 *   Workflows (5), Agents (5), Settings (4), Board Tasks (11)
 *
 * Communicates with the main process via the PlatformBridge HTTP server
 * running on localhost. The bridge port is passed via SPARK_PLATFORM_BRIDGE_PORT.
 *
 * Pattern follows image-generation-mcp-server.mjs: stdio MCP protocol,
 * runs with ELECTRON_RUN_AS_NODE=1.
 */
import { request as httpRequest } from 'node:http'
import readline from 'node:readline'

const BRIDGE_PORT = Number(process.env.SPARK_PLATFORM_BRIDGE_PORT || 0)
const BRIDGE_HOST = '127.0.0.1'

// ─── JSON-RPC helpers ────────────────────────────────────────────────

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

// ─── Bridge RPC ──────────────────────────────────────────────────────

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const options = {
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = httpRequest(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          if (parsed.ok) {
            resolve(parsed.data)
          } else {
            reject(new Error(parsed.error || 'Unknown bridge error'))
          }
        } catch (e) {
          reject(new Error(`Bridge response parse error: ${e.message}`))
        }
      })
    })

    req.on('error', (e) => reject(new Error(`Bridge connection error: ${e.message}`)))
    req.write(body)
    req.end()
  })
}

// ─── Tool Definitions ────────────────────────────────────────────────

function toolDefinitions() {
  return [
    // ── Skills ──
    {
      name: 'skills_list',
      description: '列出所有已安装的 Skill（技能）。返回每个技能的 ID、名称、描述、分类、版本、作者和启用状态。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'skills_search',
      description: '在远程技能商店中搜索技能。返回匹配的远程技能列表，包含名称、作者、描述。',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回结果数量上限，默认 8' },
        },
      },
    },
    {
      name: 'skills_install',
      description: '从远程技能商店安装一个技能。需要提供远程技能 ID 和注册表 ID。安装后技能会出现在已安装列表中。',
      inputSchema: {
        type: 'object',
        required: ['remoteSkillId', 'registryId'],
        properties: {
          remoteSkillId: { type: 'string', description: '远程技能 ID' },
          registryId: { type: 'string', description: '注册表 ID' },
        },
      },
    },
    {
      name: 'skills_uninstall',
      description: '卸载（删除）一个已安装的技能。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要卸载的技能 ID' },
        },
      },
    },
    {
      name: 'skills_toggle',
      description: '切换技能的启用/禁用状态。启用后技能可在会话中使用。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要切换状态的技能 ID' },
        },
      },
    },

    // ── MCP Servers ──
    {
      name: 'mcp_list',
      description: '列出所有 MCP 服务器配置。返回每个服务器的 ID、名称、作用域、启用状态和配置信息。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'mcp_create',
      description: '创建一个新的 MCP 服务器配置。支持 stdio、http、sse 三种传输类型。创建后需启动才能使用。',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'MCP 服务器名称' },
          scope: { type: 'string', description: '作用域：system/user/project/team/session，默认 user', enum: ['system', 'user', 'project', 'team', 'session'] },
          configJson: { type: 'object', description: '服务器配置，包含 type(stdio/http/sse)、command、args、url、env 等', additionalProperties: true },
          enabled: { type: 'boolean', description: '是否启用，默认 true' },
        },
      },
    },
    {
      name: 'mcp_update',
      description: '更新 MCP 服务器配置。可修改名称、配置内容和启用状态。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要更新的 MCP 服务器 ID' },
          name: { type: 'string', description: '新名称' },
          configJson: { type: 'object', description: '新的配置内容', additionalProperties: true },
          enabled: { type: 'boolean', description: '是否启用' },
        },
      },
    },
    {
      name: 'mcp_delete',
      description: '删除一个 MCP 服务器配置。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的 MCP 服务器 ID' },
        },
      },
    },
    {
      name: 'mcp_status',
      description: '获取 MCP 服务器的运行状态。可查询单个或全部服务器的状态信息。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '可选，指定服务器 ID。不提供则返回所有服务器状态。' },
        },
      },
    },

    // ── Providers ──
    {
      name: 'providers_list',
      description: '列出所有 Provider（AI 模型供应商）配置。返回名称、类型、默认模型、是否有 API Key 等信息。注意：不会返回 API Key 明文。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'providers_create',
      description: '创建一个新的 Provider 配置。需要指定名称、类型、模型配置和 API Key 引用。',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'string', description: '可选的自定义 ID' },
          name: { type: 'string', description: 'Provider 名称，如 "OpenAI"' },
          providerType: { type: 'string', description: 'API 协议类型：anthropic 或 openai', enum: ['anthropic', 'openai'] },
          config: { type: 'object', description: '模型配置，包含 defaultModel、apiEndpoint 等', additionalProperties: true },
          keystoreRef: { type: 'string', description: 'Keychain 中存储 API Key 的引用' },
          isDefault: { type: 'boolean', description: '是否设为默认 Provider' },
        },
      },
    },
    {
      name: 'providers_update',
      description: '更新 Provider 配置。可修改名称、模型配置和启用状态。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Provider ID' },
          name: { type: 'string', description: '新名称' },
          config: { type: 'object', description: '新的模型配置', additionalProperties: true },
          enabled: { type: 'boolean', description: '是否启用' },
        },
      },
    },
    {
      name: 'providers_delete',
      description: '删除一个 Provider 配置。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的 Provider ID' },
        },
      },
    },
    {
      name: 'providers_health_check',
      description: '测试 Provider 的连接状态。检查是否配置了 API Key。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要测试的 Provider ID' },
        },
      },
    },

    // ── Workflows ──
    {
      name: 'workflows_list',
      description: '列出所有 Workflow（工作流）。返回每个工作流的 ID、名称、状态、描述。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'workflows_get',
      description: '获取单个 Workflow 的详细信息，包含完整的流程图数据。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Workflow ID' },
        },
      },
    },
    {
      name: 'workflows_create',
      description: '创建一个新的 Workflow。创建后默认为草稿状态，可在 Workflows 页面编辑流程图。',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Workflow 名称' },
          description: { type: 'string', description: '描述' },
          scope: { type: 'string', description: '作用域：system/user/project，默认 system', enum: ['system', 'user', 'project'] },
          version: { type: 'string', description: '版本号，默认 1.0.0' },
          status: { type: 'string', description: '状态：draft/active/archived', enum: ['draft', 'active', 'archived'] },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          graph: { type: 'object', description: '流程图数据（DAG）', additionalProperties: true },
        },
      },
    },
    {
      name: 'workflows_update',
      description: '更新 Workflow 的名称、描述、状态、流程图等。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Workflow ID' },
          name: { type: 'string', description: '新名称' },
          description: { type: 'string', description: '新描述' },
          scope: { type: 'string', description: '新作用域', enum: ['system', 'user', 'project'] },
          version: { type: 'string', description: '新版本号' },
          status: { type: 'string', description: '新状态', enum: ['draft', 'active', 'archived'] },
          tags: { type: 'array', items: { type: 'string' }, description: '新标签列表' },
          graph: { type: 'object', description: '新的流程图数据', additionalProperties: true },
          enabled: { type: 'boolean', description: '是否启用' },
        },
      },
    },
    {
      name: 'workflows_delete',
      description: '删除一个 Workflow。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的 Workflow ID' },
        },
      },
    },

    // ── Agents ──
    {
      name: 'agents_list',
      description: '列出所有 Agent（代理）。返回每个代理的名称、类型、权限模式、启用状态等。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'agents_get',
      description: '获取单个 Agent 的完整配置详情，包含 provider、model、prompt、skills、MCP 服务器等。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Agent ID' },
        },
      },
    },
    {
      name: 'agents_create',
      description: '创建一个新的 Agent。可指定名称、描述、适配器类型、权限模式、系统提示词、关联的 Workflow、Provider 等。',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Agent 名称' },
          description: { type: 'string', description: '描述' },
          agentAdapter: { type: 'string', description: '适配器类型：claude-sdk/claude/codex', enum: ['claude-sdk', 'claude', 'codex'] },
          permissionMode: { type: 'string', description: '权限模式' },
          reasoningEffort: { type: 'string', description: '推理强度：low/medium/high/xhigh', enum: ['low', 'medium', 'high', 'xhigh'] },
          prompt: { type: 'string', description: '系统提示词' },
          skillIds: { type: 'array', items: { type: 'string' }, description: '关联的 Skill ID 列表' },
          mcpServerIds: { type: 'array', items: { type: 'string' }, description: '关联的 MCP 服务器 ID 列表' },
          workflowId: { type: 'string', description: '关联的 Workflow ID，绑定后 Agent 会按该工作流执行' },
          providerProfileId: { type: 'string', description: '关联的 Provider Profile ID，指定使用哪个 AI 供应商' },
          modelId: { type: 'string', description: '模型 ID，指定使用的具体模型' },
          ruleIds: { type: 'array', items: { type: 'string' }, description: '关联的规则 ID 列表' },
          hookConfig: { type: 'object', description: 'Hook 配置，定义事件回调', additionalProperties: true },
          metadata: { type: 'object', description: '元数据（如 avatar 等）', additionalProperties: true },
          isDefault: { type: 'boolean', description: '是否设为默认 Agent' },
          enabled: { type: 'boolean', description: '是否启用，默认 true' },
        },
      },
    },
    {
      name: 'agents_update',
      description: '更新 Agent 的配置。可修改名称、提示词、关联的 skills、MCP 服务器、Workflow、Provider 等。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Agent ID' },
          name: { type: 'string', description: '新名称' },
          description: { type: 'string', description: '新描述' },
          agentAdapter: { type: 'string', description: '新适配器类型' },
          permissionMode: { type: 'string', description: '新权限模式' },
          reasoningEffort: { type: 'string', description: '新推理强度：low/medium/high/xhigh', enum: ['low', 'medium', 'high', 'xhigh'] },
          prompt: { type: 'string', description: '新系统提示词' },
          skillIds: { type: 'array', items: { type: 'string' }, description: '新的 Skill ID 列表' },
          mcpServerIds: { type: 'array', items: { type: 'string' }, description: '新的 MCP 服务器 ID 列表' },
          workflowId: { type: 'string', description: '关联的 Workflow ID，设为 null 可解绑' },
          providerProfileId: { type: 'string', description: '关联的 Provider Profile ID' },
          modelId: { type: 'string', description: '模型 ID' },
          ruleIds: { type: 'array', items: { type: 'string' }, description: '新的规则 ID 列表' },
          hookConfig: { type: 'object', description: 'Hook 配置', additionalProperties: true },
          metadata: { type: 'object', description: '元数据', additionalProperties: true },
          isDefault: { type: 'boolean', description: '是否设为默认 Agent' },
          enabled: { type: 'boolean', description: '是否启用' },
        },
      },
    },
    {
      name: 'agents_delete',
      description: '删除一个 Agent。内置 Agent 不可删除。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的 Agent ID' },
        },
      },
    },

    // ── Board Tasks ──
    {
      name: 'board_list',
      description: '列出看板任务。可按状态、优先级、负责人、项目等条件过滤。返回匹配的任务列表。',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '按状态过滤：todo/in-progress/done/accepted/closed/bug-fix', enum: ['todo', 'in-progress', 'done', 'accepted', 'closed', 'bug-fix'] },
          priority: { type: 'string', description: '按优先级过滤：low/medium/high/urgent', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee: { type: 'string', description: '按负责人过滤（模糊匹配）' },
          project: { type: 'string', description: '按项目过滤（精确匹配项目名称）' },
          query: { type: 'string', description: '搜索关键词（匹配标题、描述）' },
          includeDeleted: { type: 'boolean', description: '是否包含已删除的任务（回收站），默认 false' },
        },
      },
    },
    {
      name: 'board_get',
      description: '获取单个看板任务的详情。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '任务 ID' },
        },
      },
    },
    {
      name: 'board_create',
      description: '创建一个新的看板任务。标题是必填的。',
      inputSchema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: '任务标题' },
          description: { type: 'string', description: '任务描述' },
          status: { type: 'string', description: '状态，默认 todo', enum: ['todo', 'in-progress', 'done', 'accepted', 'closed', 'bug-fix'] },
          priority: { type: 'string', description: '优先级，默认 medium', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee: { type: 'string', description: '负责人' },
          project: { type: 'string', description: '所属项目' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          dueDate: { type: 'string', description: '截止日期（ISO 格式，如 2025-12-31）' },
          processingAgent: { type: 'string', description: '处理 Agent，指定执行任务的 agent 或团队（格式：agent 名称 或 team:团队名称）' },
          acceptanceCriteria: { type: 'string', description: '验收条件，任务完成后测试验收的标准' },
          testAgent: { type: 'string', description: '测试 Agent，可选指定测试的 agent（格式：agent 名称 或 team:团队名称）' },
        },
      },
    },
    {
      name: 'board_update',
      description: '更新看板任务。可修改标题、描述、状态、优先级等字段。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '任务 ID' },
          title: { type: 'string', description: '新标题' },
          description: { type: 'string', description: '新描述' },
          status: { type: 'string', description: '新状态', enum: ['todo', 'in-progress', 'done', 'accepted', 'closed', 'bug-fix'] },
          priority: { type: 'string', description: '新优先级', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee: { type: 'string', description: '新负责人' },
          project: { type: 'string', description: '新所属项目' },
          tags: { type: 'array', items: { type: 'string' }, description: '新标签列表（完全替换）' },
          dueDate: { type: 'string', description: '新截止日期' },
          processingAgent: { type: 'string', description: '新处理 Agent（格式：agent 名称 或 team:团队名称）' },
          acceptanceCriteria: { type: 'string', description: '新验收条件' },
          testAgent: { type: 'string', description: '新测试 Agent（格式：agent 名称 或 team:团队名称）' },
        },
      },
    },
    {
      name: 'board_delete',
      description: '删除看板任务（移至回收站）。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的任务 ID' },
        },
      },
    },
    {
      name: 'board_batch_create',
      description: '批量创建看板任务。接收任务数组，一次性创建多个任务。',
      inputSchema: {
        type: 'object',
        required: ['tasks'],
        properties: {
          tasks: {
            type: 'array',
            description: '任务列表，每个元素至少包含 title',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string', description: '任务标题' },
                description: { type: 'string', description: '任务描述' },
                status: { type: 'string', description: '状态', enum: ['todo', 'in-progress', 'done', 'accepted', 'closed', 'bug-fix'] },
                priority: { type: 'string', description: '优先级', enum: ['low', 'medium', 'high', 'urgent'] },
                assignee: { type: 'string', description: '负责人' },
                project: { type: 'string', description: '所属项目' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签' },
                dueDate: { type: 'string', description: '截止日期' },
                processingAgent: { type: 'string', description: '处理 Agent' },
                acceptanceCriteria: { type: 'string', description: '验收条件' },
                testAgent: { type: 'string', description: '测试 Agent' },
              },
            },
          },
        },
      },
    },
    {
      name: 'board_batch_update',
      description: '批量更新看板任务。接收更新数组，每个元素需包含 id 和要修改的字段。',
      inputSchema: {
        type: 'object',
        required: ['updates'],
        properties: {
          updates: {
            type: 'array',
            description: '更新列表，每个元素需包含 id',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string', description: '任务 ID' },
                title: { type: 'string' },
                description: { type: 'string' },
                status: { type: 'string', enum: ['todo', 'in-progress', 'done', 'accepted', 'closed', 'bug-fix'] },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                assignee: { type: 'string' },
                project: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                dueDate: { type: 'string' },
                processingAgent: { type: 'string' },
                acceptanceCriteria: { type: 'string' },
                testAgent: { type: 'string' },
              },
            },
          },
        },
      },
    },
    {
      name: 'board_batch_delete',
      description: '批量删除看板任务（移至回收站）。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要删除的任务 ID 列表',
          },
        },
      },
    },
    {
      name: 'board_restore',
      description: '从回收站恢复已删除的任务。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要恢复的任务 ID' },
        },
      },
    },
    {
      name: 'board_permanent_delete',
      description: '彻底永久删除任务（从回收站清除，不可恢复）。这是破坏性操作。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要彻底删除的任务 ID' },
        },
      },
    },

    // ── Settings ──
    {
      name: 'settings_get',
      description: '获取单个设置项的值。需要提供分类和键名。',
      inputSchema: {
        type: 'object',
        required: ['key'],
        properties: {
          category: { type: 'string', description: '设置分类，默认 "general"' },
          key: { type: 'string', description: '设置键名' },
        },
      },
    },
    {
      name: 'settings_set',
      description: '修改设置项的值。需要提供分类、键名和新值。',
      inputSchema: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          category: { type: 'string', description: '设置分类，默认 "general"' },
          key: { type: 'string', description: '设置键名' },
          value: { description: '设置值，可以是字符串、数字、布尔值或对象' },
        },
      },
    },
    {
      name: 'settings_get_category',
      description: '获取指定分类下的所有设置项。',
      inputSchema: {
        type: 'object',
        required: ['category'],
        properties: {
          category: { type: 'string', description: '设置分类名称' },
        },
      },
    },
    {
      name: 'settings_get_all',
      description: '获取所有分类的所有设置项。返回嵌套对象 { [category]: { [key]: value } }。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ]
}

// ─── Tool Call Handler ───────────────────────────────────────────────

async function handleToolCall(name, args) {
  // Map tool name to bridge method
  const methodMap = {
    skills_list: 'skills.list',
    skills_search: 'skills.search',
    skills_install: 'skills.install',
    skills_uninstall: 'skills.uninstall',
    skills_toggle: 'skills.toggle',
    mcp_list: 'mcp.list',
    mcp_create: 'mcp.create',
    mcp_update: 'mcp.update',
    mcp_delete: 'mcp.delete',
    mcp_status: 'mcp.status',
    providers_list: 'providers.list',
    providers_create: 'providers.create',
    providers_update: 'providers.update',
    providers_delete: 'providers.delete',
    providers_health_check: 'providers.health_check',
    workflows_list: 'workflows.list',
    workflows_get: 'workflows.get',
    workflows_create: 'workflows.create',
    workflows_update: 'workflows.update',
    workflows_delete: 'workflows.delete',
    agents_list: 'agents.list',
    agents_get: 'agents.get',
    agents_create: 'agents.create',
    agents_update: 'agents.update',
    agents_delete: 'agents.delete',
    settings_get: 'settings.get',
    settings_set: 'settings.set',
    settings_get_category: 'settings.get_category',
    settings_get_all: 'settings.get_all',
    board_list: 'board.list',
    board_get: 'board.get',
    board_create: 'board.create',
    board_update: 'board.update',
    board_delete: 'board.delete',
    board_batch_create: 'board.batch_create',
    board_batch_update: 'board.batch_update',
    board_batch_delete: 'board.batch_delete',
    board_restore: 'board.restore',
    board_permanent_delete: 'board.permanent_delete',
  }

  const method = methodMap[name]
  if (!method) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  try {
    const data = await rpc(method, args)
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true,
    }
  }
}

// ─── Main loop ───────────────────────────────────────────────────────

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })

  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (msg.method === 'initialize') {
      result(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark-platform-management', version: '1.0.0' },
      })
      return
    }

    if (msg.method === 'notifications/initialized') {
      // No response needed for notifications
      return
    }

    if (msg.method === 'tools/list') {
      result(msg.id, { tools: toolDefinitions() })
      return
    }

    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name
      const toolArgs = msg.params?.arguments ?? {}
      handleToolCall(toolName, toolArgs)
        .then((toolResult) => result(msg.id, toolResult))
        .catch((e) => error(msg.id, -32603, e.message))
      return
    }

    // ping
    if (msg.method === 'ping') {
      result(msg.id, {})
      return
    }
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

main()
