import { createLogger } from '@spark/shared'
import type {
  InternalBrowserDownloadResult,
  InternalBrowserMediaInspection,
  InternalBrowserMeta,
} from './InternalBrowserService.js'
import { getInternalBrowserService } from './InternalBrowserService.js'
import { SystemBrowserError, SystemBrowserService } from './SystemBrowserService.js'

const log = createLogger('sub-app-browser')

export type SubAppBrowserBackend = 'system' | 'internal'

type BrowserAdapter = {
  openWindow: (opts: {
    url: string
    show?: boolean
    profileId?: string
    reuse?: boolean
  }) => Promise<InternalBrowserMeta>
  inspectMedia: (windowId: string) => Promise<InternalBrowserMediaInspection>
  downloadMedia: (
    windowId: string,
    url: string,
    filename?: string,
  ) => Promise<InternalBrowserDownloadResult>
  closeWindow: (windowId: string) => Promise<{ ok: true }> | { ok: true }
  bindLifecycle?: () => void
}

type RoutedWindow = { backend: SubAppBrowserBackend; adapter: BrowserAdapter }

export class SubAppBrowserService {
  private readonly routedWindows = new Map<string, RoutedWindow>()
  private readonly internal: BrowserAdapter
  private readonly system: BrowserAdapter

  constructor(
    internal: BrowserAdapter = getInternalBrowserService(),
    system: BrowserAdapter = new SystemBrowserService(),
  ) {
    this.internal = internal
    this.system = system
  }

  bindLifecycle(): void {
    this.internal.bindLifecycle?.()
    this.system.bindLifecycle?.()
  }

  async openWindow(opts: {
    url: string
    show?: boolean
    profileId?: string
    reuse?: boolean
    backend?: 'system' | 'internal' | 'auto'
  }): Promise<InternalBrowserMeta & { backend: SubAppBrowserBackend }> {
    const request = {
      url: opts.url,
      ...(opts.show === undefined ? {} : { show: opts.show }),
      ...(opts.profileId === undefined ? {} : { profileId: opts.profileId }),
      ...(opts.reuse === undefined ? {} : { reuse: opts.reuse }),
    }
    if (opts.backend === 'internal') return this.openWith('internal', this.internal, request)

    try {
      return await this.openWith('system', this.system, request)
    } catch (error) {
      if (!(error instanceof SystemBrowserError)) throw error
      log.warn(`System browser unavailable, falling back to internal browser: ${error.message}`)
      return this.openWith('internal', this.internal, request)
    }
  }

  inspectMedia(windowId: string): Promise<InternalBrowserMediaInspection> {
    return this.route(windowId).adapter.inspectMedia(windowId)
  }

  downloadMedia(
    windowId: string,
    url: string,
    filename?: string,
  ): Promise<InternalBrowserDownloadResult> {
    return this.route(windowId).adapter.downloadMedia(windowId, url, filename)
  }

  async closeWindow(windowId: string): Promise<{ ok: true }> {
    const routed = this.route(windowId)
    this.routedWindows.delete(windowId)
    return await routed.adapter.closeWindow(windowId)
  }

  private async openWith(
    backend: SubAppBrowserBackend,
    adapter: BrowserAdapter,
    request: { url: string; show?: boolean; profileId?: string; reuse?: boolean },
  ): Promise<InternalBrowserMeta & { backend: SubAppBrowserBackend }> {
    const opened = await adapter.openWindow(request)
    this.routedWindows.set(opened.windowId, { backend, adapter })
    return { ...opened, backend }
  }

  private route(windowId: string): RoutedWindow {
    const routed = this.routedWindows.get(windowId)
    if (routed != null) return routed
    if (windowId.startsWith('system-browser-')) return { backend: 'system', adapter: this.system }
    return { backend: 'internal', adapter: this.internal }
  }
}

let singleton: SubAppBrowserService | null = null

export function getSubAppBrowserService(): SubAppBrowserService {
  if (singleton == null) singleton = new SubAppBrowserService()
  return singleton
}
