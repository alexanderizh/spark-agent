/**
 * The single seam the TUI uses to obtain image attachments.
 *
 * Keeping clipboard, file, and path handling behind one interface means the
 * interactive editor can be tested with a fake reader instead of a real
 * pasteboard, and platform detection happens exactly once per session.
 */
import { createRuntimeLogger, type RuntimeLogger } from '../observability/logger.js'
import type { ImageReadResult } from './attachments.js'
import { detectClipboardPlatform, readClipboardImage, type CommandRunner } from './clipboard.js'
import { readImageFile, resolveImageFilePath } from './files.js'

export interface ImageInputSeam {
  /** Reads a picture from the OS clipboard; never throws. */
  readClipboard(): Promise<ImageReadResult>
  /** Reads a picture from disk; never throws. */
  readFile(path: string): Promise<ImageReadResult>
  /** Resolves pasted text that names an existing image file. */
  resolveFilePath(text: string): Promise<string | undefined>
  /** Whether Alt+V should also read the clipboard (Windows/WSL terminals). */
  readonly altVPaste: boolean
}

export interface CreateImageInputSeamOptions {
  readonly platform?: NodeJS.Platform
  readonly environment?: NodeJS.ProcessEnv
  readonly run?: CommandRunner
  readonly signal?: AbortSignal
  readonly logger?: RuntimeLogger
}

export function createImageInputSeam(options: CreateImageInputSeamOptions = {}): ImageInputSeam {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const logger = options.logger ?? createRuntimeLogger('clipboard')
  const clipboardPlatform = detectClipboardPlatform(platform, environment)
  const readFile = (path: string): Promise<ImageReadResult> => readImageFile(path)
  return {
    readClipboard: () =>
      readClipboardImage({
        platform,
        environment,
        logger,
        readFile,
        ...(options.run === undefined ? {} : { run: options.run }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    readFile,
    resolveFilePath: (text) => resolveImageFilePath(text),
    altVPaste: clipboardPlatform === 'windows' || clipboardPlatform === 'wsl',
  }
}
