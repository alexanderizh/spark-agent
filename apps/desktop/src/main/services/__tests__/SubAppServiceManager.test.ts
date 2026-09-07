import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase, SubAppPackageService, SubAppRepository } from '@spark/storage'
import { SubAppServiceManager } from '../SubAppServiceManager.js'
import { SubAppJobManager } from '../SubAppJobManager.js'

describe('SubAppServiceManager', () => {
  let root = ''
  let db: SparkDatabase | undefined
  let services: SubAppServiceManager | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spark-sub-app-service-'))
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(
      fileURLToPath(new URL('../../../../../../packages/storage/migrations', import.meta.url)),
    )
    services = new SubAppServiceManager(db)
  })

  afterEach(async () => {
    await services?.dispose()
    db?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('invokes a release-pinned managed service and exposes status', async () => {
    const packages = new SubAppPackageService(db!)
    const app = await packages.scaffold({ name: 'Service', template: 'fullstack' })
    await packages.publish(app.appId, app.draftRevision)
    new SubAppRepository(db!).setEnabled(app.appId, true)

    const response = await services!.invoke(app.appId, 'health', {})
    expect(response.output).toEqual({ ok: true })
    expect(services!.status(app.appId)).toMatchObject({ status: 'running' })
  })

  it('persists job progress and result independently of a page', async () => {
    const packages = new SubAppPackageService(db!)
    const app = await packages.scaffold({ name: 'Jobs', template: 'fullstack' })
    await packages.publish(app.appId, app.draftRevision)
    new SubAppRepository(db!).setEnabled(app.appId, true)
    const jobs = new SubAppJobManager(db!, services!)
    const created = jobs.create(app.appId, 'run-job', { value: 42 })

    const finished = await waitForJob(() => jobs.get(app.appId, created.id))
    expect(finished).toMatchObject({
      status: 'succeeded',
      progress: 1,
      result: { input: { value: 42 } },
    })
    expect(finished.releaseId).toBeTruthy()
  })

  it('rejects a candidate release whose declared health action fails', async () => {
    const packages = new SubAppPackageService(db!)
    const app = await packages.scaffold({ name: 'Broken', template: 'fullstack' })
    await packages.writeFile({
      appId: app.appId,
      expectedDraftRevision: app.draftRevision,
      filePath: 'service/main.mjs',
      content: `export default { async invoke(action) { if (action === 'health') throw new Error('unhealthy') } }`,
    })
    await expect(services!.preflightDraft(app.appId)).rejects.toThrow('unhealthy')
    expect(new SubAppRepository(db!).get(app.appId)?.publishedRelease).toBeNull()
  })
})

async function waitForJob(read: () => ReturnType<SubAppJobManager['get']>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = read()
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('job did not finish')
}
