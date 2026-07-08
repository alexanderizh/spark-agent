#!/usr/bin/env node
/**
 * Platform Management MCP Server
 *
 * Exposes tools for managing the Spark Agent platform:
 *   Skills, MCP Servers, Providers, Workflows, Agents, Teams,
 *   Settings, Sessions, and Board Tasks.
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
const SESSION_ID = process.env.SPARK_SESSION_ID || ''

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
      name: 'skills_load',
      description: '加载某个技能的完整指令（SKILL.md 正文）。系统提示里只给出技能目录（id+名称+描述）；当你判断某个技能对当前任务有用时，调用本工具拿到它的完整操作指令后再执行。这是技能"渐进式披露"的加载入口。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要加载的技能 ID（取自技能目录条目的 id）' },
        },
      },
    },
    {
      name: 'skills_search',
      description: '搜索可安装的技能（聚合远程技能商店 + 内置精选目录）。返回的每个技能都带 registryId 和 id 字段，安装时原样回传即可。内置精选目录（如 ppt-master、playwright）的 registryId 为 "catalog"。',
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
      description: '安装一个技能。传入 skills_search 返回的 registryId 和 remoteSkillId（或 id），安装后落盘并出现在已安装列表，应用内即刻可用。registryId 和 remoteSkillId 都直接取自搜索结果，无需手工拼接。',
      inputSchema: {
        type: 'object',
        required: ['remoteSkillId', 'registryId'],
        properties: {
          remoteSkillId: {
            type: 'string',
            description: '远程技能 ID。直接传 skills_search 返回的 id 字段即可（如 "skillhub:tapd-api" 或 "catalog:ppt-master"），代码会自动剥掉 "registryId:" 前缀；也可只传 slug 部分（如 "tapd-api"）。',
          },
          registryId: {
            type: 'string',
            description: '注册表 ID。必须用 skills_search 返回的 registryId 字段（小写），不要用显示名 registryName。常见值：skillhub / skillsmp / catalog（内置精选目录）。代码层对大小写和常见显示名已做容错。',
          },
        },
      },
    },
    {
      name: 'skills_search_github',
      description: '在 GitHub 上搜索包含 SKILL.md 的技能仓库。返回 repo（owner/name）、名称、描述、作者、star 数、默认分支。用于在内置市场之外帮用户从 GitHub 找技能。',
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
      name: 'skills_install_github',
      description: '从 GitHub 仓库安装技能：定位含 SKILL.md 的目录并把该目录子树落盘到应用，安装后应用内即刻可用。可选 ref（分支/标签/commit）与 path（多技能仓库内的技能目录，如 "skills/pdf"）。',
      inputSchema: {
        type: 'object',
        required: ['repo'],
        properties: {
          repo: { type: 'string', description: '仓库，形如 "owner/name"（也接受完整 GitHub URL）' },
          ref: { type: 'string', description: '分支/标签/commit，缺省取默认分支' },
          path: { type: 'string', description: '仓库内技能目录，缺省为根目录' },
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
          configJson: { type: 'object', description: '服务器配置。用 type 声明传输：\n- type:"http"（远程 Streamable HTTP，当前标准）或 "sse"（旧标准）→ 必须提供 url（http/https），可选 headers。\n- type:"stdio"（本地进程）→ 必须提供 command，可选 args(数组)/env(对象)。\n务必让 type 与字段匹配：填了 url 就用 http（不要写成 stdio），否则会被判为配置无效而拒绝。', additionalProperties: true },
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
          configJson: { type: 'object', description: '新的配置内容。传输字段规则同 mcp_create：http/sse 需 url，stdio 需 command，type 必须与字段匹配，否则会被拒绝。', additionalProperties: true },
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
    {
      name: 'providers_get',
      description: '获取单个 Provider 的完整详情，包含默认模型、可用模型列表、API 端点、是否为默认供应商等。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Provider ID' },
        },
      },
    },
    {
      name: 'providers_set_default',
      description: '将指定 Provider 设为默认供应商。设为默认后，新建会话将优先使用该供应商。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要设为默认的 Provider ID' },
        },
      },
    },
    {
      name: 'providers_set_default_model',
      description: '修改 Provider 的默认模型。后续使用该 Provider 创建会话时将优先使用新默认模型。',
      inputSchema: {
        type: 'object',
        required: ['id', 'model'],
        properties: {
          id: { type: 'string', description: 'Provider ID' },
          model: { type: 'string', description: '新的默认模型名称，如 "claude-sonnet-4-6"' },
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
          reasoningEffort: { type: 'string', description: '推理强度：medium/high/xhigh/max', enum: ['medium', 'high', 'xhigh', 'max'] },
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
          builtIn: { type: 'boolean', description: '是否标记为内置 Agent（内置 Agent 不可删除，可跨项目复用）' },
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
          reasoningEffort: { type: 'string', description: '新推理强度：medium/high/xhigh/max', enum: ['medium', 'high', 'xhigh', 'max'] },
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
          builtIn: { type: 'boolean', description: '是否标记为内置 Agent（内置 Agent 不可删除，可跨项目复用）。设为 true 后该 Agent 会出现在系统内置 Agent 列表中' },
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

    // ── Teams ──
    {
      name: 'teams_list',
      description: '列出长期团队定义（Teams）。返回团队 ID、名称、主持人 Agent、成员 Agent、嵌套设置、启用状态等。',
      inputSchema: {
        type: 'object',
        properties: {
          includeDisabled: { type: 'boolean', description: '是否包含已停用团队，默认 false' },
        },
      },
    },
    {
      name: 'teams_get',
      description: '获取单个团队定义详情，包含主持人、成员、团队专属 prompt、嵌套设置和元数据。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '团队 ID' },
        },
      },
    },
    {
      name: 'teams_create',
      description: '创建长期团队定义。团队由一个主持人 Agent 和若干成员 Agent 组成，可在会话中作为已保存团队启用。',
      inputSchema: {
        type: 'object',
        required: ['name', 'hostAgentId'],
        properties: {
          name: { type: 'string', description: '团队名称' },
          description: { type: 'string', description: '团队描述' },
          hostAgentId: { type: 'string', description: '主持人 Agent ID。创建前建议先调用 agents_list 获取可用 Agent。' },
          memberAgentIds: {
            type: 'array',
            items: { type: 'string' },
            description: '成员 Agent ID 列表。若包含 hostAgentId，系统会自动剔除。',
          },
          maxDepth: { type: 'number', minimum: 1, maximum: 3, description: '团队嵌套调用最大深度，1-3，默认 1' },
          allowNesting: { type: 'boolean', description: '是否允许成员继续调用其他成员，默认 false' },
          prompt: { type: 'string', description: '团队专属 system prompt 片段，会追加到 Team Roster 后' },
          enabled: { type: 'boolean', description: '是否启用，默认 true' },
          metadata: { type: 'object', description: '团队元数据（如 avatar 等）', additionalProperties: true },
        },
      },
    },
    {
      name: 'teams_update',
      description: '更新长期团队定义。可修改名称、描述、主持人、成员、嵌套设置、团队 prompt、启用状态和元数据。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '团队 ID' },
          name: { type: 'string', description: '新团队名称' },
          description: { type: 'string', description: '新描述' },
          hostAgentId: { type: 'string', description: '新的主持人 Agent ID' },
          memberAgentIds: {
            type: 'array',
            items: { type: 'string' },
            description: '新的成员 Agent ID 列表（整体替换）。若包含主持人，系统会自动剔除。',
          },
          maxDepth: { type: 'number', minimum: 1, maximum: 3, description: '新的最大嵌套深度，1-3' },
          allowNesting: { type: 'boolean', description: '是否允许嵌套调用' },
          prompt: { type: 'string', description: '新的团队专属 prompt' },
          enabled: { type: 'boolean', description: '是否启用' },
          metadata: { type: 'object', description: '新的团队元数据', additionalProperties: true },
        },
      },
    },
    {
      name: 'teams_delete',
      description: '删除长期团队定义。内置团队不可删除。这是破坏性操作，建议先向用户确认。',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '要删除的团队 ID' },
        },
      },
    },

    // ── Spark Install Artifacts ──
    {
      name: 'artifacts_list',
      description: '查询 Spark 自建安装源 manifest 中的技能包、运行时安装包和离线依赖包。缺少 Python/Node.js/依赖库时，先用本工具按 type/platform/arch/query 查找自建源，再考虑国内镜像或外网安装。',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '可选：skill/runtime/python-wheelhouse/npm-store/archive', enum: ['skill', 'runtime', 'python-wheelhouse', 'npm-store', 'archive'] },
          platform: { type: 'string', description: '可选：darwin/linux/win32/any', enum: ['darwin', 'linux', 'win32', 'any'] },
          arch: { type: 'string', description: '可选：x64/arm64/any', enum: ['x64', 'arm64', 'any'] },
          query: { type: 'string', description: '可选关键词，如 python、nodejs、ppt-master、wheelhouse' },
          manifestUrl: { type: 'string', description: '可选 manifest URL；默认使用 Spark 官方自建安装源' },
        },
      },
    },
    {
      name: 'artifacts_resolve',
      description: '按 artifactId 解析 Spark 自建安装源中的单个安装包，返回完整下载 URL、sha256、平台、大小和说明。执行安装命令前应先向用户说明计划并获得同意。',
      inputSchema: {
        type: 'object',
        required: ['artifactId'],
        properties: {
          artifactId: { type: 'string', description: 'manifest 中的 artifact id，如 runtime.python-3.11.9.win32-x64' },
          manifestUrl: { type: 'string', description: '可选 manifest URL；默认使用 Spark 官方自建安装源' },
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
          attachments: {
            type: 'array',
            description: '附件列表（图片或文件），每个元素包含 id / type / name / path 字段；type 为 image 时还可包含 previewPath',
            items: {
              type: 'object',
              required: ['id', 'type', 'name', 'path'],
              properties: {
                id: { type: 'string', description: '附件唯一 ID' },
                type: { type: 'string', enum: ['image', 'file'], description: '附件类型：image 或 file' },
                name: { type: 'string', description: '显示名' },
                path: { type: 'string', description: '附件绝对路径' },
                previewPath: { type: 'string', description: '图片附件可选的预览路径（缩略图等）' },
              },
            },
          },
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
          attachments: {
            type: 'array',
            description: '附件列表（整体替换现有附件），每个元素包含 id / type / name / path 字段；type 为 image 时还可包含 previewPath',
            items: {
              type: 'object',
              required: ['id', 'type', 'name', 'path'],
              properties: {
                id: { type: 'string', description: '附件唯一 ID' },
                type: { type: 'string', enum: ['image', 'file'], description: '附件类型：image 或 file' },
                name: { type: 'string', description: '显示名' },
                path: { type: 'string', description: '附件绝对路径' },
                previewPath: { type: 'string', description: '图片附件可选的预览路径' },
              },
            },
          },
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
                attachments: {
                  type: 'array',
                  description: '附件列表，每个元素包含 id / type / name / path 字段',
                  items: {
                    type: 'object',
                    required: ['id', 'type', 'name', 'path'],
                    properties: {
                      id: { type: 'string', description: '附件唯一 ID' },
                      type: { type: 'string', enum: ['image', 'file'], description: '附件类型' },
                      name: { type: 'string', description: '显示名' },
                      path: { type: 'string', description: '附件绝对路径' },
                      previewPath: { type: 'string', description: '图片附件可选的预览路径' },
                    },
                  },
                },
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
                attachments: {
                  type: 'array',
                  description: '附件列表（整体替换现有附件）',
                  items: {
                    type: 'object',
                    required: ['id', 'type', 'name', 'path'],
                    properties: {
                      id: { type: 'string', description: '附件唯一 ID' },
                      type: { type: 'string', enum: ['image', 'file'], description: '附件类型' },
                      name: { type: 'string', description: '显示名' },
                      path: { type: 'string', description: '附件绝对路径' },
                      previewPath: { type: 'string', description: '图片附件可选的预览路径' },
                    },
                  },
                },
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

    // ── GitHub Connector ──
    {
      name: 'github_status',
      description: '查看当前 GitHub 连接器状态、授权仓库范围以及 MCP 工具是否启用。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'github_list_repositories',
      description: '列出当前 GitHub 连接授权范围内可访问的仓库。可按 query 模糊过滤。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '按 owner/repo 或描述模糊搜索' },
        },
      },
    },
    {
      name: 'github_get_repository',
      description: '获取单个仓库详情。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
        },
      },
    },
    {
      name: 'github_read_repository_file',
      description: '读取仓库文件内容，并在返回中附带解码后的 UTF-8 文本。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'path'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          path: { type: 'string', description: '文件路径，如 "README.md"' },
          ref: { type: 'string', description: '可选分支 / tag / commit SHA' },
        },
      },
    },
    {
      name: 'github_create_branch',
      description: '基于默认分支或指定来源分支 / SHA 创建新分支。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'branch'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          branch: { type: 'string', description: '新分支名' },
          sourceBranch: { type: 'string', description: '可选源分支名' },
          sourceSha: { type: 'string', description: '可选源 commit SHA，优先级高于 sourceBranch' },
        },
      },
    },
    {
      name: 'github_upsert_repository_file',
      description: '创建或更新仓库文件。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'path', 'content', 'message'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '新的 UTF-8 文本内容' },
          message: { type: 'string', description: 'Git commit message' },
          branch: { type: 'string', description: '可选目标分支' },
          sha: { type: 'string', description: '更新已有文件时的 blob SHA' },
        },
      },
    },
    {
      name: 'github_list_issues',
      description: '列出仓库 Issue（自动排除 PR）。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          state: { type: 'string', description: '状态过滤', enum: ['open', 'closed', 'all'] },
          labels: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          assignee: { type: 'string', description: '负责人登录名' },
          page: { type: 'number', description: '页码，默认 1' },
          perPage: { type: 'number', description: '每页数量，默认 50' },
        },
      },
    },
    {
      name: 'github_get_issue',
      description: '获取单个 Issue 详情。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issueNumber'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          issueNumber: { type: 'number', description: 'Issue 编号' },
        },
      },
    },
    {
      name: 'github_create_issue',
      description: '创建 Issue。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'title'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          title: { type: 'string', description: 'Issue 标题' },
          body: { type: 'string', description: 'Issue 描述' },
          labels: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          assignees: { type: 'array', items: { type: 'string' }, description: '负责人列表' },
        },
      },
    },
    {
      name: 'github_update_issue',
      description: '更新 Issue 标题、正文、状态、标签或 assignees。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issueNumber', 'patch'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          issueNumber: { type: 'number', description: 'Issue 编号' },
          patch: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              state: { type: 'string', enum: ['open', 'closed'] },
              labels: { type: 'array', items: { type: 'string' } },
              assignees: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    {
      name: 'github_comment_issue',
      description: '给 Issue 添加评论。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issueNumber', 'body'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          issueNumber: { type: 'number', description: 'Issue 编号' },
          body: { type: 'string', description: '评论正文' },
        },
      },
    },
    {
      name: 'github_list_pull_requests',
      description: '列出仓库 Pull Request。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          state: { type: 'string', description: '状态过滤', enum: ['open', 'closed', 'all'] },
          head: { type: 'string', description: '可选 head 过滤，如 "owner:branch"' },
          base: { type: 'string', description: '可选 base 分支' },
          page: { type: 'number', description: '页码，默认 1' },
          perPage: { type: 'number', description: '每页数量，默认 50' },
        },
      },
    },
    {
      name: 'github_get_pull_request',
      description: '获取单个 Pull Request 详情。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'pullNumber'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          pullNumber: { type: 'number', description: 'Pull Request 编号' },
        },
      },
    },
    {
      name: 'github_create_pull_request',
      description: '创建 Pull Request。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'title', 'head', 'base'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          title: { type: 'string', description: 'PR 标题' },
          head: { type: 'string', description: '源分支，如 "feature/github-connector"' },
          base: { type: 'string', description: '目标分支，如 "main"' },
          body: { type: 'string', description: 'PR 描述' },
          draft: { type: 'boolean', description: '是否创建为 Draft PR' },
        },
      },
    },
    {
      name: 'github_comment_pull_request',
      description: '给 Pull Request 添加评论。需要连接器开启写入权限。',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'pullNumber', 'body'],
        properties: {
          owner: { type: 'string', description: '仓库 owner' },
          repo: { type: 'string', description: '仓库名' },
          pullNumber: { type: 'number', description: 'Pull Request 编号' },
          body: { type: 'string', description: '评论正文' },
        },
      },
    },

    // ── Session Management ──
    {
      name: 'sessions_get',
      description: '获取当前会话的运行时状态，包括当前模型、供应商、会话模式、权限模式、推理强度、可用模型列表等。用于 Agent 自查当前运行参数。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'sessions_switch_model',
      description: '切换当前会话使用的模型。模型必须属于当前会话的供应商。切换后立即生效。',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', description: '要切换到的模型 ID，如 "claude-sonnet-4-6"、"claude-opus-4-7"' },
        },
      },
    },
    {
      name: 'sessions_switch_provider',
      description: '切换当前会话使用的 AI 供应商（Provider）。切换后模型也会变更到新供应商的默认模型。',
      inputSchema: {
        type: 'object',
        required: ['providerProfileId'],
        properties: {
          providerProfileId: { type: 'string', description: '要切换到的 Provider Profile ID' },
        },
      },
    },
    {
      name: 'sessions_switch_mode',
      description: '切换当前会话的聊天模式。不同模式影响 Agent 的行为方式：agent（正常对话）、ask（仅回答不执行）、edit（编辑模式）、review（代码审查模式）。',
      inputSchema: {
        type: 'object',
        required: ['chatMode'],
        properties: {
          chatMode: { type: 'string', description: '聊天模式', enum: ['agent', 'ask', 'edit', 'review'] },
        },
      },
    },
    {
      name: 'sessions_switch_permission',
      description: '切换当前会话的权限模式。权限模式控制 Agent 能自动执行哪些操作。default（需确认高风险操作）、claude-auto-edits（自动编辑文件，高风险仍需确认）、bypassPermissions（完全自动，慎用）。',
      inputSchema: {
        type: 'object',
        required: ['permissionMode'],
        properties: {
          permissionMode: { type: 'string', description: '权限模式', enum: ['default', 'plan', 'claude-auto-edits', 'claude-plan', 'bypassPermissions'] },
        },
      },
    },
    {
      name: 'sessions_switch_reasoning_effort',
      description: '切换当前会话的推理强度。medium（平衡）、high（深度分析）、xhigh（极致推理）、max（最高推理，消耗更多 token）。',
      inputSchema: {
        type: 'object',
        required: ['reasoningEffort'],
        properties: {
          reasoningEffort: { type: 'string', description: '推理强度', enum: ['medium', 'high', 'xhigh', 'max'] },
        },
      },
    },
  ]
}

// ─── Tool Call Handler ───────────────────────────────────────────────

async function handleToolCall(name, args) {
  // Map tool name to bridge method
  const methodMap = {
    skills_list: 'skills.list',
    skills_load: 'skills.load',
    skills_search: 'skills.search',
    skills_search_github: 'skills.search_github',
    skills_install: 'skills.install',
    skills_install_github: 'skills.install_github',
    skills_uninstall: 'skills.uninstall',
    skills_toggle: 'skills.toggle',
    mcp_list: 'mcp.list',
    mcp_create: 'mcp.create',
    mcp_update: 'mcp.update',
    mcp_delete: 'mcp.delete',
    mcp_status: 'mcp.status',
    providers_list: 'providers.list',
    providers_get: 'providers.get',
    providers_create: 'providers.create',
    providers_update: 'providers.update',
    providers_delete: 'providers.delete',
    providers_health_check: 'providers.health_check',
    providers_set_default: 'providers.set_default',
    providers_set_default_model: 'providers.set_default_model',
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
    teams_list: 'teams.list',
    teams_get: 'teams.get',
    teams_create: 'teams.create',
    teams_update: 'teams.update',
    teams_delete: 'teams.delete',
    artifacts_list: 'artifacts.list',
    artifacts_resolve: 'artifacts.resolve',
    settings_get: 'settings.get',
    settings_set: 'settings.set',
    settings_get_category: 'settings.get_category',
    settings_get_all: 'settings.get_all',
    github_status: 'github.status',
    github_list_repositories: 'github.list_repositories',
    github_get_repository: 'github.get_repository',
    github_read_repository_file: 'github.read_repository_file',
    github_create_branch: 'github.create_branch',
    github_upsert_repository_file: 'github.upsert_repository_file',
    github_list_issues: 'github.list_issues',
    github_get_issue: 'github.get_issue',
    github_create_issue: 'github.create_issue',
    github_update_issue: 'github.update_issue',
    github_comment_issue: 'github.comment_issue',
    github_list_pull_requests: 'github.list_pull_requests',
    github_get_pull_request: 'github.get_pull_request',
    github_create_pull_request: 'github.create_pull_request',
    github_comment_pull_request: 'github.comment_pull_request',
    sessions_get: 'sessions.get',
    sessions_switch_model: 'sessions.switch_model',
    sessions_switch_provider: 'sessions.switch_provider',
    sessions_switch_mode: 'sessions.switch_mode',
    sessions_switch_permission: 'sessions.switch_permission',
    sessions_switch_reasoning_effort: 'sessions.switch_reasoning_effort',
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

  // Auto-inject sessionId for session tools (read from env)
  const rpcArgs = { ...args }
  if (name.startsWith('sessions_') && SESSION_ID) {
    rpcArgs.sessionId = SESSION_ID
  }

  try {
    const data = await rpc(method, rpcArgs)
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
        serverInfo: { name: 'spark-platform-management', version: '2.5.0' },
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

    if (msg.method === 'resources/list') {
      result(msg.id, { resources: [] })
      return
    }

    if (msg.method === 'resources/templates/list') {
      result(msg.id, { resourceTemplates: [] })
      return
    }

    if (msg.method === 'prompts/list') {
      result(msg.id, { prompts: [] })
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

    if (msg.id != null) {
      error(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

main()
