import type { VideoWorkbenchIpcChannelMap } from './video-workbench.js'

declare module './ipc/index.js' {
  interface IpcChannelMap extends VideoWorkbenchIpcChannelMap {}
}

export {}
