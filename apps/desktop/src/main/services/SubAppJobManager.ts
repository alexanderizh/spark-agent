import type { SubAppJob, SubAppJobListRequest } from '@spark/protocol'
import { SubAppPlatformRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { SparkError } from '@spark/shared'
import type { SubAppServiceManager } from './SubAppServiceManager.js'

export class SubAppJobManager {
  private readonly platform: SubAppPlatformRepository
  private readonly activeRequests = new Map<string, { appId: string; requestId: string }>()

  constructor(
    database: SparkDatabase,
    private readonly services: SubAppServiceManager,
    private readonly eventSink?: (event: { appId: string; job: SubAppJob }) => void,
  ) {
    this.platform = new SubAppPlatformRepository(database)
  }

  restore(): void {
    this.platform.interruptRunningJobs()
    for (const job of this.platform.listQueuedJobs()) queueMicrotask(() => void this.run(job))
  }

  create(appId: string, type: string, input: unknown): SubAppJob {
    const job = this.platform.createJob(appId, type, input)
    this.eventSink?.({ appId, job })
    queueMicrotask(() => void this.run(job))
    return job
  }

  get(appId: string, jobId: string): SubAppJob {
    const job = this.platform.getJob(appId, jobId)
    if (job == null) throw new SparkError('NOT_FOUND', '指定的子应用任务不存在。')
    return job
  }

  list(request: SubAppJobListRequest) {
    return this.platform.listJobs(request.appId, {
      ...(request.status != null ? { status: request.status } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
      ...(request.offset != null ? { offset: request.offset } : {}),
    })
  }

  cancel(appId: string, jobId: string): SubAppJob {
    const job = this.platform.requestJobCancel(appId, jobId)
    const active = this.activeRequests.get(jobId)
    if (active != null) this.services.cancel(active.appId, active.requestId)
    if (job.status === 'queued') {
      const cancelled = this.platform.transitionJob(appId, jobId, ['queued'], {
        status: 'cancelled',
        message: '任务已取消。',
      })
      this.eventSink?.({ appId, job: cancelled })
      return cancelled
    }
    return this.get(appId, jobId)
  }

  private async run(job: SubAppJob): Promise<void> {
    const current = this.platform.getJob(job.appId, job.id)
    if (current == null || current.status !== 'queued' || current.cancelRequested) return
    this.emit(
      this.platform.transitionJob(job.appId, job.id, ['queued'], {
        status: 'running',
        progress: 0,
        message: '任务已开始。',
      }),
    )
    try {
      const result = await this.services.invoke(
        job.appId,
        job.type,
        job.input,
        24 * 60 * 60 * 1_000,
        (progress, message, checkpoint) => {
          const latest = this.platform.getJob(job.appId, job.id)
          if (latest?.status !== 'running') return
          this.emit(
            this.platform.transitionJob(job.appId, job.id, ['running'], {
              status: 'running',
              progress,
              message,
              checkpoint,
            }),
          )
        },
        (requestId) => this.activeRequests.set(job.id, { appId: job.appId, requestId }),
      )
      const latest = this.platform.getJob(job.appId, job.id)
      if (latest?.cancelRequested) {
        this.emit(
          this.platform.transitionJob(job.appId, job.id, ['running'], {
            status: 'cancelled',
            message: '任务已取消。',
          }),
        )
      } else {
        this.emit(
          this.platform.transitionJob(job.appId, job.id, ['running'], {
            status: 'succeeded',
            progress: 1,
            message: '任务已完成。',
            result: result.output,
          }),
        )
      }
    } catch (error) {
      const latest = this.platform.getJob(job.appId, job.id)
      if (latest?.status !== 'running') return
      const cancelled = latest.cancelRequested
      this.emit(
        this.platform.transitionJob(job.appId, job.id, ['running'], {
          status: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? '任务已取消。' : '任务执行失败。',
          ...(!cancelled
            ? {
                error: {
                  code: 'SERVICE_EXECUTION_FAILED',
                  message: error instanceof Error ? error.message : String(error),
                },
              }
            : {}),
        }),
      )
    } finally {
      this.activeRequests.delete(job.id)
    }
  }

  private emit(job: SubAppJob): void {
    this.eventSink?.({ appId: job.appId, job })
  }
}
