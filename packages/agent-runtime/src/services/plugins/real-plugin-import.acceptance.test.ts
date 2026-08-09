import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, SkillRepository } from '@spark/storage'
import { PluginManager } from './plugin-manager.service.js'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('real connector plugin imports', () => {
  it('imports Gmail and Notion packages and mounts their Skills/connectors', async () => {
    const database = createDatabase(':memory:')
    const pluginRoot = await mkdtemp(join('/tmp', 'spark-real-plugin-import-'))
    temporaryRoots.push(pluginRoot)
    const manager = new PluginManager({ db: database, pluginRoot })
    await manager.initialize()

    const gmail = await manager.installLocal(join(fixtureRoot, 'fixtures/gmail'), [
      'network',
      'secrets.read',
      'connector.account',
    ])
    const notion = await manager.installLocal(join(fixtureRoot, 'fixtures/notion'), [
      'network',
      'secrets.read',
      'connector.account',
      'filesystem.read',
    ])

    expect(gmail.id).toBe('google.gmail')
    expect(gmail.icon).toBe('gmail')
    expect(gmail.enabled).toBe(true)
    expect(gmail.contributionCounts).toEqual({ skills: 1, mcpServers: 0, connectors: 1 })
    expect(notion.id).toBe('notion.workspace')
    expect(notion.icon).toBe('notion')
    expect(notion.enabled).toBe(true)
    expect(notion.contributionCounts).toEqual({ skills: 1, mcpServers: 0, connectors: 1 })
    const skills = new SkillRepository(database)
    expect(
      JSON.parse(skills.get('plugin:google.gmail:skill:gmail-assistant')!.manifest_json),
    ).toMatchObject({
      author: 'Spark Connectors',
      category: 'communication',
      icon: 'gmail',
    })
    expect(
      JSON.parse(skills.get('plugin:notion.workspace:skill:notion-research')!.manifest_json),
    ).toMatchObject({
      author: 'Spark Connectors',
      category: 'productivity',
      icon: 'notion',
    })
    expect(
      manager.repository.listResources('google.gmail').map((row) => row.resource_type),
    ).toEqual(['connector', 'skill'])
    expect(
      manager.repository.listResources('notion.workspace').map((row) => row.resource_type),
    ).toEqual(['connector', 'skill'])

    const disabled = await manager.setEnabled(gmail.id, false)
    expect(disabled.enabled).toBe(false)
    expect(manager.repository.listResources(gmail.id).every((row) => row.enabled === 0)).toBe(true)
    expect(await manager.uninstall(notion.id)).toBe(true)
    expect(manager.repository.get(notion.id)).toBeUndefined()
    database.close()
  })

  it('installs the Acme SDK example and keeps its worker runtime behind the host gate', async () => {
    const database = createDatabase(':memory:')
    const pluginRoot = await mkdtemp(join('/tmp', 'spark-acme-plugin-import-'))
    temporaryRoots.push(pluginRoot)
    const manager = new PluginManager({ db: database, pluginRoot })
    await manager.initialize()

    const exampleRoot = join(
      fixtureRoot,
      '..',
      '..',
      '..',
      '..',
      '..',
      'examples',
      'plugins',
      'acme-tasks',
    )
    const plugin = await manager.installLocal(exampleRoot, [
      'network',
      'secrets.read',
      'connector.account',
    ])

    expect(plugin).toMatchObject({
      id: 'com.acme.tasks',
      enabled: true,
      contributionCounts: { skills: 1, runtimes: 1 },
    })
    expect(manager.repository.listResources('com.acme.tasks')).toEqual(
      expect.arrayContaining([expect.objectContaining({ resource_type: 'runtime', enabled: 0 })]),
    )
    const runtimeResource = manager.repository
      .listResources('com.acme.tasks')
      .find((resource) => resource.resource_type === 'runtime')
    expect(runtimeResource?.metadata_json).toContain('isolated-runtime-host-required')
    database.close()
  })
})
