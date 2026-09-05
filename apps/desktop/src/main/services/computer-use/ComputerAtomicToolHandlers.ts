import type { ComputerAction, ComputerElementRef, ComputerObservation } from '@spark/protocol'
import { z } from 'zod'
import type {
  AtomicDispatchResult,
  ComputerAtomicActionService,
} from './ComputerAtomicActionService.js'
import type { ComputerUseServices } from './ComputerUseServices.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

/**
 * Reference to a target: the element id from the latest tree, or a pixel
 * coordinate in the latest screenshot's coordinate space (top-left origin).
 * Element references are preferred — they survive window moves and resolve
 * through the accessibility tree instead of raw pixels.
 */
const ElementRefSchema = z.object({ elementId: z.string().trim().min(1).max(200) }).strict()
const CoordinateSchema = z.tuple([z.number().finite().min(0), z.number().finite().min(0)])
const AtSchema = z.union([ElementRefSchema, z.object({ coordinate: CoordinateSchema }).strict()])

export const AtomicClickSchema = z
  .object({
    at: AtSchema,
    clickCount: z.number().int().min(1).max(3).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
  })
  .strict()

export const AtomicTypeTextSchema = z
  .object({
    text: z.string().min(1).max(20_000),
    into: ElementRefSchema.optional(),
    submit: z.boolean().optional(),
  })
  .strict()

export const AtomicSetValueSchema = z
  .object({
    elementId: z.string().trim().min(1).max(200),
    value: z.string().max(20_000),
  })
  .strict()

export const AtomicInvokeSchema = z
  .object({
    elementId: z.string().trim().min(1).max(200),
    action: z.enum(['invoke', 'select', 'focus', 'expand', 'collapse']).optional(),
  })
  .strict()

export const AtomicPressKeySchema = z
  .object({
    /** Either an array of key names or a single chord string like "cmd+shift+t". */
    keys: z.union([
      z.string().trim().min(1).max(200),
      z.array(z.string().trim().min(1).max(30)).min(1).max(8),
    ]),
  })
  .strict()

export const AtomicScrollSchema = z
  .object({
    deltaY: z.number().finite().min(-100_000).max(100_000).optional(),
    deltaX: z.number().finite().min(-100_000).max(100_000).optional(),
    at: AtSchema.optional(),
  })
  .strict()

export const AtomicDragSchema = z
  .object({
    from: AtSchema,
    to: AtSchema,
    durationMs: z.number().int().min(50).max(250).optional(),
  })
  .strict()

export const AtomicSelectTextSchema = z
  .object({
    elementId: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    prefix: z.string().max(2_000).optional(),
    suffix: z.string().max(2_000).optional(),
  })
  .strict()

export const AtomicSecondaryActionSchema = z.object({ at: AtSchema }).strict()

export const ATOMIC_TOOL_NAMES = [
  'click',
  'type_text',
  'set_value',
  'invoke_element',
  'press_key',
  'scroll',
  'drag',
  'select_text',
  'perform_secondary_action',
  'screenshot',
] as const

export type AtomicToolName = (typeof ATOMIC_TOOL_NAMES)[number]

const KEY_ALIASES: Record<string, string> = {
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  win: 'Meta',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
}

/** Parses "cmd+shift+t" / ["Meta","shift","t"] into normalized key names. */
export function parseKeyChord(input: string | string[]): string[] {
  const parts = typeof input === 'string' ? input.split('+') : input
  const normalized = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const lowered = part.toLowerCase()
      if (KEY_ALIASES[lowered] != null) return KEY_ALIASES[lowered] as string
      const fn = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(part)
      if (fn != null) return `F${Number(fn[1])}`
      return part
    })
  if (normalized.length === 0 || normalized.length > 8) {
    throw invalidArguments('press_key needs 1-8 keys')
  }
  return normalized
}

type AtRef = z.infer<typeof AtSchema>

/**
 * Executes one atomic tool invocation against the implicit computer session
 * and returns the model-facing result: fresh Markdown tree + full-resolution
 * screenshot + truthful execution channel. Every action is built inside the
 * dispatch callback so it resolves against the freshest observation.
 */
export class ComputerAtomicToolHandlers {
  /**
   * Geometry of the image the model last SAW for a session. Coordinates in
   * tool calls refer to that image, which may be a downscaled frame — mapping
   * through the original observation dims would misplace the click.
   */
  private readonly modelImageDims = new Map<string, { width: number; height: number }>()

  constructor(
    private readonly atomic: ComputerAtomicActionService,
    private readonly services: ComputerUseServices,
  ) {}

  async handle(
    toolName: AtomicToolName,
    sessionId: string,
    turnId: string,
    args: unknown,
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'screenshot': {
        const observation = await this.atomic.observe(sessionId, turnId)
        return this.result('screenshot', sessionId, {
          observation,
          noop: false,
          executionChannel: null,
        })
      }
      case 'click': {
        const request = parse(AtomicClickSchema, args)
        return this.dispatchAndSummarize(
          'click',
          sessionId,
          turnId,
          (observation) =>
            this.clickAction(
              sessionId,
              request.at,
              observation,
              request.button ?? 'left',
              request.clickCount,
            ),
          'Click',
        )
      }
      case 'perform_secondary_action': {
        const request = parse(AtomicSecondaryActionSchema, args)
        return this.dispatchAndSummarize(
          'perform_secondary_action',
          sessionId,
          turnId,
          (observation) => this.clickAction(sessionId, request.at, observation, 'right', 1),
          'Secondary action',
        )
      }
      case 'type_text': {
        const request = parse(AtomicTypeTextSchema, args)
        return this.typeText(sessionId, turnId, request)
      }
      case 'set_value': {
        const request = parse(AtomicSetValueSchema, args)
        return this.dispatchAndSummarize(
          'set_value',
          sessionId,
          turnId,
          () =>
            ({
              type: 'set_value',
              elementId: request.elementId,
              value: request.value,
            }) as ComputerAction,
          `Set value of element ${request.elementId}`,
        )
      }
      case 'invoke_element': {
        const request = parse(AtomicInvokeSchema, args)
        return this.dispatchAndSummarize(
          'invoke_element',
          sessionId,
          turnId,
          () =>
            ({
              type: 'invoke_element',
              elementId: request.elementId,
              ...(request.action == null ? {} : { action: request.action }),
            }) as ComputerAction,
          `Invoke element ${request.elementId}`,
        )
      }
      case 'press_key': {
        const request = parse(AtomicPressKeySchema, args)
        const keys = parseKeyChord(request.keys)
        return this.dispatchAndSummarize(
          'press_key',
          sessionId,
          turnId,
          () => ({ type: 'keypress', keys }) as ComputerAction,
          `Press ${keys.join('+')}`,
        )
      }
      case 'scroll': {
        const request = parse(AtomicScrollSchema, args)
        const deltaX = request.deltaX ?? 0
        const deltaY = request.deltaY ?? 0
        if (deltaX === 0 && deltaY === 0) {
          throw invalidArguments('scroll needs a non-zero deltaX or deltaY')
        }
        return this.dispatchAndSummarize(
          'scroll',
          sessionId,
          turnId,
          (observation) => {
            const action: ComputerAction = { type: 'scroll', deltaX, deltaY }
            if (request.at == null) return action
            if ('elementId' in request.at) {
              requireElement(observation, request.at.elementId)
              return { ...action, elementId: request.at.elementId }
            }
            return {
              ...action,
              point: this.coordinateToPoint(sessionId, request.at.coordinate, observation),
            }
          },
          `Scroll ${deltaY !== 0 ? deltaY : deltaX}`,
        )
      }
      case 'drag': {
        const request = parse(AtomicDragSchema, args)
        return this.dispatchAndSummarize(
          'drag',
          sessionId,
          turnId,
          (observation) => {
            const action: ComputerAction = {
              type: 'drag',
              from: this.atToPoint(sessionId, request.from, observation),
              to: this.atToPoint(sessionId, request.to, observation),
            }
            return request.durationMs == null
              ? action
              : { ...action, durationMs: request.durationMs }
          },
          'Drag',
        )
      }
      case 'select_text': {
        const request = parse(AtomicSelectTextSchema, args)
        return this.dispatchAndSummarize(
          'select_text',
          sessionId,
          turnId,
          () =>
            ({
              type: 'select_text',
              elementId: request.elementId,
              text: request.text,
              ...(request.prefix == null ? {} : { prefix: request.prefix }),
              ...(request.suffix == null ? {} : { suffix: request.suffix }),
            }) as ComputerAction,
          `Select text in element ${request.elementId}`,
        )
      }
    }
  }

  private async typeText(
    sessionId: string,
    turnId: string,
    request: z.infer<typeof AtomicTypeTextSchema>,
  ): Promise<Record<string, unknown>> {
    // Focus the field first when `into` is given — background typing targets
    // the app's focused element, so an explicit focus click makes it deterministic.
    if (request.into != null) {
      const into = request.into
      await this.atomic.dispatch(
        sessionId,
        turnId,
        (observation) => this.clickAction(sessionId, into, observation, 'left', 1),
        'Focus field for typing',
      )
    }
    let last = await this.atomic.dispatch(
      sessionId,
      turnId,
      () => ({ type: 'type_text', text: request.text }) as ComputerAction,
      'Type text',
    )
    if (request.submit === true) {
      last = await this.atomic.dispatch(
        sessionId,
        turnId,
        () => ({ type: 'keypress', keys: ['Enter'] }) as ComputerAction,
        'Submit typed text',
      )
    }
    return this.result('type_text', sessionId, last)
  }

  private async dispatchAndSummarize(
    toolName: string,
    sessionId: string,
    turnId: string,
    build: (observation: ComputerObservation) => ComputerAction,
    intent: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.atomic.dispatch(sessionId, turnId, build, intent)
    return this.result(toolName, sessionId, result)
  }

  /** click at element (bounds center) or at screenshot pixel coordinate. */
  private clickAction(
    sessionId: string,
    at: AtRef,
    observation: ComputerObservation,
    button: 'left' | 'right' | 'middle',
    clickCount: number | undefined,
  ): ComputerAction {
    const point = this.atToPoint(sessionId, at, observation)
    return {
      type: 'click',
      point,
      ...(button === 'left' ? {} : { button }),
      ...(clickCount == null || clickCount === 1 ? {} : { count: clickCount }),
    }
  }

  private atToPoint(
    sessionId: string,
    at: AtRef,
    observation: ComputerObservation,
  ): { x: number; y: number } {
    if ('elementId' in at) {
      const element = requireElement(observation, at.elementId)
      const bounds = observation.foreground.window.bounds
      // Element bounds and window bounds share the AX coordinate space, so
      // the ratio is coordinate-system independent.
      return {
        x: clamp01((element.bounds.x + element.bounds.width / 2 - bounds.x) / bounds.width),
        y: clamp01((element.bounds.y + element.bounds.height / 2 - bounds.y) / bounds.height),
      }
    }
    return this.coordinateToPoint(sessionId, at.coordinate, observation)
  }

  /**
   * Screenshot pixels (what the model reads) → window-relative normalized
   * point. Uses the geometry of the model-facing image the model actually
   * saw (possibly downscaled), NOT the observation's capture dims.
   */
  private coordinateToPoint(
    sessionId: string,
    coordinate: [number, number],
    observation: ComputerObservation,
  ): { x: number; y: number } {
    const dims = this.modelImageDims.get(sessionId) ?? {
      width: observation.screenshot.width,
      height: observation.screenshot.height,
    }
    return {
      x: clamp01(coordinate[0] / dims.width),
      y: clamp01(coordinate[1] / dims.height),
    }
  }

  private async result(
    toolName: string,
    sessionId: string,
    outcome: AtomicDispatchResult,
  ): Promise<Record<string, unknown>> {
    const observation = outcome.observation
    const screenshot = await this.readScreenshot(sessionId, observation)
    return {
      action: toolName,
      status: outcome.noop ? 'noop' : 'executed',
      executionChannel: outcome.executionChannel,
      app: observation.foreground.app.name,
      window: observation.foreground.window.title,
      frameId: observation.frameId,
      treeVersion: observation.treeVersion,
      elementCount: observation.tree.elementCount,
      tree: observation.tree.text,
      ...(screenshot == null ? { screenshotUnavailable: true } : { screenshot }),
    }
  }

  private async readScreenshot(
    sessionId: string,
    observation: ComputerObservation,
  ): Promise<{
    mimeType: 'image/png' | 'image/jpeg'
    width: number
    height: number
    data: string
  } | null> {
    const computerSessionId = this.atomic.computerSessionIdFor(sessionId)
    if (computerSessionId == null || this.services.evidence == null) return null
    try {
      const image = await this.services.evidence.readLatestImage(
        computerSessionId,
        observation.screenshot.snapshotId,
      )
      this.modelImageDims.set(sessionId, { width: image.width, height: image.height })
      return {
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        data: image.bytes.toString('base64'),
      }
    } catch {
      return null
    }
  }
}

function requireElement(observation: ComputerObservation, elementId: string): ComputerElementRef {
  const element = observation.elements.find((item) => item.id === elementId)
  if (element == null) {
    throw staleTree(elementId)
  }
  return element
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function parse<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    throw invalidArguments(
      `Invalid atomic tool arguments: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  return parsed.data
}

function invalidArguments(message: string): ComputerUseBrokerError {
  return new ComputerUseBrokerError('action_not_allowed', message)
}

function staleTree(elementId: string): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'stale_tree',
    `Element ${elementId} is not in the latest tree — call screenshot or get_app_state, then retry with a fresh element id`,
    undefined,
    { retryable: true },
  )
}
