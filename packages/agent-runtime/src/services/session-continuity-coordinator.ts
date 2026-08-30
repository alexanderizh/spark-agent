import crypto from 'node:crypto'
import type { ContextSummarizedEvent } from '@spark/protocol'
import {
  EventRepository,
  ModelProfileRepository,
  ProviderProfileRepository,
  SessionSummaryRepository,
  SettingsRepository,
  type SparkDatabase,
} from '@spark/storage'
import { createLogger } from '@spark/shared'
import { ModelService } from './model.service.js'
import { updateSessionContinuityCapsule } from './session-continuity-capsule.js'

const log = createLogger('session-continuity-coordinator')

type PublishCapsuleEvent = (
  sessionId: string,
  turnId: string,
  event: ContextSummarizedEvent,
  eventRepo: EventRepository,
) => void

/**
 * Owns non-blocking capsule update scheduling outside the already-large
 * SessionService. Updates are serialized per session so two completed turns
 * cannot race the persisted seq waterline.
 */
export class SessionContinuityCoordinator {
  private readonly updates = new Map<string, Promise<void>>()

  constructor(
    private readonly db: SparkDatabase,
    private readonly publish: PublishCapsuleEvent,
    private readonly getActiveChatModel: (
      sessionId: string,
    ) => { providerId: string; model: string } | null,
  ) {}

  schedule(sessionId: string, turnId: string, modelId: string): void {
    const previous = this.updates.get(sessionId) ?? Promise.resolve()
    const activeModel = this.getActiveChatModel(sessionId)
    const update = previous
      .catch(() => undefined)
      .then(() => this.update(sessionId, turnId, modelId, activeModel))
      .catch((err) => {
        log.warn(
          `continuity capsule update failed (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      })
    this.updates.set(sessionId, update)
    void update.finally(() => {
      if (this.updates.get(sessionId) === update) this.updates.delete(sessionId)
    })
  }

  private async update(
    sessionId: string,
    turnId: string,
    modelId: string,
    activeModel: { providerId: string; model: string } | null,
  ): Promise<void> {
    const settingsRepo = new SettingsRepository(this.db)
    const settingsGet = (category: string, key: string) => settingsRepo.get(category, key)
    const configuredSummaryModel = settingsGet('memory', 'extractionModel')
    const summaryModelId =
      typeof configuredSummaryModel === 'string' && configuredSummaryModel.length > 0
        ? configuredSummaryModel
        : (activeModel?.model ?? modelId)
    const modelService = new ModelService(
      new ModelProfileRepository(this.db),
      new ProviderProfileRepository(this.db),
      settingsGet,
      () => activeModel,
    )
    const eventRepo = new EventRepository(this.db)
    const result = await updateSessionContinuityCapsule({
      eventRepo,
      summaryRepo: new SessionSummaryRepository(this.db),
      sessionId,
      turnId,
      modelId: summaryModelId,
      complete: (prompt, options) => modelService.complete(prompt, options),
    })
    if (result == null) return

    this.publish(
      sessionId,
      turnId,
      {
        id: crypto.randomUUID(),
        type: 'context_summarized',
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        summarizedEntryCount: result.summarizedEntryCount,
        fromSeq: result.fromSeq,
        toSeq: result.toSeq,
        tokensSaved: result.tokensSaved,
        summaryTokens: result.summaryTokens,
      },
      eventRepo,
    )
  }
}
