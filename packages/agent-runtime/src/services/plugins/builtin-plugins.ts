import { GITHUB_CONNECTOR_MANIFEST, type PluginManifest } from '@spark/protocol'

/**
 * Built-in plugins are trusted package records with a host-owned runtime binding.
 * The binding is deliberately an allow-listed id; plugin packages cannot provide
 * executable code through this field.
 */
export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    schemaVersion: 2,
    id: 'spark.github',
    version: '1.0.0',
    displayName: 'GitHub',
    description: '连接 GitHub 账号后，Agent 可在授权范围内读取仓库、管理 Issue / PR 和提交代码。',
    author: { name: 'Spark' },
    icon: 'github',
    categories: ['development', 'source-control'],
    tags: ['github', 'repository', 'issue', 'pull-request'],
    runtime: { type: 'builtin', id: 'github' },
    permissions: {
      required: ['network', 'secrets.read', 'connector.account'],
      optional: [],
    },
    activation: 'on-demand',
    contributions: {
      skills: [],
      mcpServers: [],
      connectors: [
        {
          id: 'github',
          manifest: GITHUB_CONNECTOR_MANIFEST,
          permissions: ['network', 'secrets.read', 'connector.account'],
        },
      ],
      runtimes: [
        {
          id: 'github',
          kind: 'connector',
          execution: { type: 'builtin', adapter: 'github' },
          toolNamespace: 'github',
          accountMode: 'multiple',
          activation: 'on-demand',
          provider: 'github',
        },
      ],
    },
  },
  {
    schemaVersion: 2,
    id: 'spark.google',
    version: '1.0.0',
    displayName: 'Google Workspace',
    description: '用一个 Google 账号安全管理 Gmail 和 Google Calendar，读取与写入能力分开授权。',
    author: { name: 'Spark' },
    icon: 'google',
    categories: ['productivity', 'communication'],
    tags: ['gmail', 'calendar', 'google'],
    runtime: { type: 'builtin', id: 'google' },
    permissions: { required: ['network', 'secrets.read', 'connector.account'], optional: [] },
    activation: 'on-demand',
    contributions: {
      skills: [],
      mcpServers: [],
      connectors: [],
      runtimes: [
        {
          id: 'google',
          kind: 'connector',
          execution: { type: 'builtin', adapter: 'google' },
          toolNamespace: 'google',
          accountMode: 'multiple',
          activation: 'on-demand',
          provider: 'google',
        },
      ],
    },
  },
  {
    schemaVersion: 2,
    id: 'spark.notion',
    version: '1.0.0',
    displayName: 'Notion',
    description: '在用户授权的 Notion 工作区内搜索、读取和整理页面与数据源。',
    author: { name: 'Spark' },
    icon: 'notion',
    categories: ['productivity', 'knowledge'],
    tags: ['notion', 'wiki', 'database'],
    runtime: { type: 'builtin', id: 'notion' },
    permissions: { required: ['network', 'secrets.read', 'connector.account'], optional: [] },
    activation: 'on-demand',
    contributions: {
      skills: [],
      mcpServers: [],
      connectors: [],
      runtimes: [
        {
          id: 'notion',
          kind: 'connector',
          execution: { type: 'builtin', adapter: 'notion' },
          toolNamespace: 'notion',
          accountMode: 'multiple',
          activation: 'on-demand',
          provider: 'notion',
        },
      ],
    },
  },
  {
    schemaVersion: 2,
    id: 'spark.obsidian',
    version: '1.0.0',
    displayName: 'Obsidian Vault',
    description: '在用户明确选择的本地 Obsidian Vault 中安全读取、搜索和整理 Markdown 笔记。',
    author: { name: 'Spark' },
    icon: 'obsidian',
    categories: ['productivity', 'knowledge'],
    tags: ['obsidian', 'markdown', 'notes'],
    runtime: { type: 'builtin', id: 'obsidian' },
    permissions: {
      required: ['filesystem.read', 'connector.account'],
      optional: ['filesystem.write'],
    },
    activation: 'on-demand',
    contributions: {
      skills: [],
      mcpServers: [],
      connectors: [],
      runtimes: [
        {
          id: 'obsidian',
          kind: 'connector',
          execution: { type: 'builtin', adapter: 'obsidian' },
          toolNamespace: 'obsidian',
          accountMode: 'multiple',
          activation: 'on-demand',
          provider: 'obsidian',
        },
      ],
    },
  },
]
