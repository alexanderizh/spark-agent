import type {
  ContextProjector,
  ProjectedContext,
  ProjectorConfig,
  PromptComposer,
  SessionFacts,
} from '../seams.js'
import type { IrImageRef, IrMessage, SystemSection } from '../llm/types.js'
import type { InstructionProvider } from '../memory/instructions.js'
import type { MemoryProvider } from '../memory/store.js'
import { SPARK_KERNEL_PROMPT } from '../prompts/kernel.js'
import type { AgentEvent, TurnInputImage } from './schema.js'

export class EventContextProjector implements ContextProjector {
  project(events: readonly AgentEvent[], config: ProjectorConfig): ProjectedContext {
    void config
    const messages: IrMessage[] = []
    const calls = new Map<string, { tool: string; seq: number }>()
    const toolResultSlots = new Map<
      string,
      { readonly index: number; message: Extract<IrMessage, { role: 'tool_result' }> }
    >()
    const reindexToolResults = (): void => {
      toolResultSlots.clear()
      messages.forEach((message, index) => {
        if (message.role === 'tool_result') toolResultSlots.set(message.callId, { index, message })
      })
    }

    for (const event of events) {
      switch (event.type) {
        case 'turn.started': {
          const imageRefs = event.input.images?.map(toIrImageRef) ?? []
          messages.push({
            role: 'user',
            content: event.input.text,
            sourceSeqs: [event.seq],
            ...(imageRefs.length === 0 ? {} : { imageRefs }),
          })
          break
        }
        case 'assistant.completed':
          messages.push({
            role: 'assistant',
            content: event.message.text ?? '',
            ...(event.message.thinking === undefined ? {} : { thinking: event.message.thinking }),
            ...(event.message.continuation === undefined
              ? {}
              : { continuation: event.message.continuation }),
            toolCalls: event.message.toolCalls,
            sourceSeqs: [event.seq],
          })
          break
        case 'tool.call':
          calls.set(event.callId, { tool: event.tool, seq: event.seq })
          break
        case 'tool.result': {
          const call = calls.get(event.callId)
          const message: Extract<IrMessage, { role: 'tool_result' }> = {
            role: 'tool_result',
            callId: event.callId,
            tool: call?.tool ?? 'unknown',
            ok: event.ok,
            content: event.content,
            sourceSeqs: call ? [call.seq, event.seq] : [event.seq],
          }
          toolResultSlots.set(event.callId, { index: messages.length, message })
          messages.push(message)
          break
        }
        case 'context.compacted':
          applyCompaction(messages, event.droppedRanges, event.summary, event.seq)
          reindexToolResults()
          break
        case 'context.tool_results_slimmed': {
          for (const entry of event.slimmed) {
            const slot = toolResultSlots.get(entry.callId)
            if (slot === undefined) continue
            const patched = { ...slot.message, content: entry.slimmedContent }
            messages[slot.index] = patched
            toolResultSlots.set(entry.callId, { index: slot.index, message: patched })
          }
          break
        }
        default:
          break
      }
    }

    return {
      messages,
      sourceSeqs: [...new Set(messages.flatMap((message) => message.sourceSeqs))],
    }
  }
}

/**
 * Replaces the dropped sequence ranges with the compaction summary. Ranges
 * always cover whole turns, so tool call/result pairs are dropped together
 * and the request never carries an orphaned half of a pair.
 */
function applyCompaction(
  messages: IrMessage[],
  droppedRanges: readonly (readonly [number, number])[],
  summary: string | undefined,
  compactedSeq: number,
): void {
  const dropped = (seqs: readonly number[]): boolean =>
    seqs.some((seq) => droppedRanges.some(([from, to]) => seq >= from && seq < to))
  const kept = messages.filter((message) => !dropped(message.sourceSeqs))
  messages.length = 0
  messages.push(...kept)
  if (summary !== undefined && summary.trim() !== '') {
    messages.push({
      role: 'user',
      content: `<context-summary>\nThe earlier conversation was compacted to free context window. The summary below is the authoritative record of everything before this point.\n\n${summary.trim()}\n</context-summary>`,
      // Bound to the compaction event itself so a later compaction that drops
      // this turn range also retires this summary instead of stacking copies.
      sourceSeqs: [compactedSeq],
    })
  }
}

/** Keeps the ledger's artifact identity without leaking summary/readHint text. */
function toIrImageRef(image: TurnInputImage): IrImageRef {
  return {
    sha256: image.ref.sha256,
    bytes: image.ref.bytes,
    mediaType: image.ref.mediaType,
    summary: image.ref.summary,
    readHint: image.ref.readHint,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
  }
}

export interface DefaultPromptComposerOptions {
  /** Layered instruction files (SPARK.md / AGENTS.md / CLAUDE.md) injected as a stable section. */
  readonly instructions?: InstructionProvider
  /** Host-composed system prompt, kept as its own cache-stable section. */
  readonly systemPrompt?: string
  /** Progressive skill context supplied by the host. */
  readonly skillSystemPrompt?: string
  /** Optional local/host memory provider for compact session injection. */
  readonly memory?: MemoryProvider
}

export class DefaultPromptComposer implements PromptComposer {
  readonly #instructions: InstructionProvider | undefined
  readonly #systemPrompt: string | undefined
  readonly #skillSystemPrompt: string | undefined
  readonly #memory: MemoryProvider | undefined

  constructor(options: DefaultPromptComposerOptions = {}) {
    this.#instructions = options.instructions
    this.#systemPrompt = nonEmpty(options.systemPrompt)
    this.#skillSystemPrompt = nonEmpty(options.skillSystemPrompt)
    this.#memory = options.memory
  }

  async compose(facts: SessionFacts, config: ProjectorConfig): Promise<readonly SystemSection[]> {
    const sections: SystemSection[] = [
      {
        id: 'spark-kernel-contract',
        stability: 'stable',
        content: SPARK_KERNEL_PROMPT,
      },
      {
        id: 'runtime',
        stability: 'volatile',
        content: `Session: ${facts.sessionId}\nWorking directory: ${config.cwd}\nPermission mode: ${facts.permissionMode ?? 'manual'}`,
      },
    ]
    if (this.#instructions) {
      const snapshot = await this.#instructions.snapshot()
      if (snapshot.sections.length > 0) {
        const content = snapshot.sections
          .map(
            (section) =>
              `<instructions source="${section.sourcePath}" scope="${section.scope}">\n${section.content.trimEnd()}\n</instructions>`,
          )
          .join('\n\n')
        sections.splice(1, 0, { id: 'project-instructions', stability: 'stable', content })
      }
    }
    if (this.#systemPrompt !== undefined) {
      sections.splice(1, 0, {
        id: 'host-system-prompt',
        stability: 'stable',
        content: this.#systemPrompt,
      })
    }
    if (this.#skillSystemPrompt !== undefined) {
      sections.splice(1, 0, {
        id: 'host-skill-prompt',
        stability: 'stable',
        content: this.#skillSystemPrompt,
      })
    }
    if (this.#memory) {
      try {
        const memory = await this.#memory.injection()
        if (memory.block.length > 0) {
          sections.splice(1, 0, {
            id: 'long-term-memory',
            stability: 'stable',
            content: memory.block,
          })
        }
      } catch {
        // Memory is an optional context enhancement; a store failure must not
        // make the main turn unavailable. The store itself logs diagnostics.
      }
    }
    if (facts.warning) {
      sections.push({ id: 'budget-warning', stability: 'volatile', content: facts.warning })
    }
    return sections
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}
