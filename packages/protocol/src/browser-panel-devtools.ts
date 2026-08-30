import { z } from 'zod'

export const BrowserPanelDevtoolsBoundsSchema = z
  .object({
    x: z.number().int().min(0).max(20_000),
    y: z.number().int().min(0).max(20_000),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
  })
  .strict()

export interface BrowserPanelDevtoolsBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserPanelDevtoolsOpenRequest {
  webContentsId: number
  bounds: BrowserPanelDevtoolsBounds
}

export type BrowserPanelDevtoolsOpenError =
  | 'target-not-found'
  | 'target-not-owned'
  | 'host-window-not-found'
  | 'open-failed'

export interface BrowserPanelDevtoolsOpenResponse {
  success: boolean
  error?: BrowserPanelDevtoolsOpenError
}

export interface BrowserPanelDevtoolsUpdateBoundsRequest {
  bounds: BrowserPanelDevtoolsBounds
}

export interface BrowserPanelDevtoolsActionResponse {
  success: boolean
}

export interface BrowserPanelDevtoolsIpcChannelMap {
  'browser-panel:devtools-open': [BrowserPanelDevtoolsOpenRequest, BrowserPanelDevtoolsOpenResponse]
  'browser-panel:devtools-update-bounds': [
    BrowserPanelDevtoolsUpdateBoundsRequest,
    BrowserPanelDevtoolsActionResponse,
  ]
  'browser-panel:devtools-close': [Record<string, never>, BrowserPanelDevtoolsActionResponse]
}

export interface BrowserPanelDevtoolsStreamChannelMap {
  'stream:browser-panel:devtools-closed': {
    webContentsId: number
  }
}

export const BrowserPanelDevtoolsIpcSchemaRegistry = {
  'browser-panel:devtools-open': z
    .object({
      webContentsId: z.number().int().positive(),
      bounds: BrowserPanelDevtoolsBoundsSchema,
    })
    .strict(),
  'browser-panel:devtools-update-bounds': z
    .object({ bounds: BrowserPanelDevtoolsBoundsSchema })
    .strict(),
  'browser-panel:devtools-close': z.object({}).strict(),
} as const

declare module './ipc/index.js' {
  interface IpcChannelMap extends BrowserPanelDevtoolsIpcChannelMap {}
  interface IpcStreamChannelMap extends BrowserPanelDevtoolsStreamChannelMap {}
}
