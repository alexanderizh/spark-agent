import { afterEach, describe, expect, it } from 'vitest'
import { PluginRepository, createDatabase, type SparkDatabase } from '@spark/storage'
import { RuntimeBroker } from './runtime-broker.js'
import { RuntimeTokenService, type RuntimeSecretStore } from './token-service.js'
import { registerBuiltinRuntimeAdapters } from './builtin-runtimes.js'

const databases: SparkDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const githubToken = process.env.SPARK_REAL_GITHUB_TOKEN?.trim()
const githubRepo = process.env.SPARK_REAL_GITHUB_REPO?.trim()
const googleToken = process.env.SPARK_REAL_GOOGLE_ACCESS_TOKEN?.trim()
const notionToken = process.env.SPARK_REAL_NOTION_TOKEN?.trim()
const googleScopes = (process.env.SPARK_REAL_GOOGLE_SCOPES ?? '').split(/\s+/).filter(Boolean)

describe('real provider acceptance (opt-in)', () => {
  it.skipIf(githubToken == null || githubRepo == null)(
    'uses GitHub through the production RuntimeBroker without writing to the repository',
    async () => {
      const broker = createRealBroker()
      const account = await broker.connect('github', {
        authMethod: 'pat',
        secrets: { token: githubToken! },
        config: { selectedRepos: [githubRepo!] },
        enabledCapabilities: ['identity', 'repositories'],
        resourceScope: { repos: [githubRepo!] },
      })
      const [owner, repo] = githubRepo!.split('/', 2)
      expect(owner).toBeTruthy()
      expect(repo).toBeTruthy()
      await expect(
        broker.invoke({
          runtimeId: 'github',
          accountId: account.id,
          toolName: 'get_status',
          input: {},
        }),
      ).resolves.toMatchObject({ login: expect.any(String) })
      await expect(
        broker.invoke({
          runtimeId: 'github',
          accountId: account.id,
          toolName: 'get_repository',
          input: { owner, repo },
        }),
      ).resolves.toMatchObject({ full_name: githubRepo! })
    },
  )

  it.skipIf(googleToken == null)(
    'connects a real Google account and performs a read-only Gmail call',
    async () => {
      const broker = createRealBroker()
      const account = await broker.connect('google', {
        authMethod: 'oauth2',
        secrets: { accessToken: googleToken! },
        config: {
          grantedScopes:
            googleScopes.length > 0
              ? googleScopes
              : ['https://www.googleapis.com/auth/gmail.readonly'],
        },
        enabledCapabilities: ['gmail_read'],
      })
      await expect(
        broker.invoke({
          runtimeId: 'google',
          accountId: account.id,
          toolName: 'gmail_list_labels',
          input: {},
        }),
      ).resolves.toMatchObject({ labels: expect.any(Array) })
    },
  )

  it.skipIf(notionToken == null)(
    'connects a real Notion integration and performs a read-only search',
    async () => {
      const broker = createRealBroker()
      const account = await broker.connect('notion', {
        authMethod: 'api-key',
        secrets: { token: notionToken! },
        enabledCapabilities: ['notion_read'],
      })
      await expect(
        broker.invoke({
          runtimeId: 'notion',
          accountId: account.id,
          toolName: 'search',
          input: { query: 'Spark runtime acceptance' },
        }),
      ).resolves.toMatchObject({ object: 'list', results: expect.any(Array) })
    },
  )
})

function createRealBroker(): RuntimeBroker {
  const database = createDatabase(':memory:')
  databases.push(database)
  const plugins = new PluginRepository(database)
  for (const [id, displayName] of [
    ['spark.github', 'GitHub'],
    ['spark.google', 'Google Workspace'],
    ['spark.notion', 'Notion'],
    ['spark.obsidian', 'Obsidian Vault'],
  ] as const) {
    plugins.upsert({
      id,
      version: '1.0.0',
      displayName,
      description: displayName,
      authorName: 'Spark QA',
      manifestJson: '{}',
      installPath: `builtin://${id}`,
      source: 'bundled',
      enabled: true,
      state: 'installed',
      trust: 'bundled',
      integritySha256: 'acceptance',
    })
  }
  const values = new Map<string, string>()
  const store: RuntimeSecretStore = {
    get: async (ref) => values.get(ref) ?? null,
    set: async (ref, value) => {
      values.set(ref, value)
    },
    delete: async (ref) => values.delete(ref),
  }
  const broker = new RuntimeBroker({
    db: database,
    tokenService: new RuntimeTokenService(store),
  })
  registerBuiltinRuntimeAdapters(broker)
  return broker
}
