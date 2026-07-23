import type { CanvasWorkflowIpcChannelMap } from './canvas-workflow.js'
import type { CanvasWorkflowRuntimeIpcChannelMap } from './canvas-workflow-runtime.js'

declare module './ipc/index.js' {
  interface IpcChannelMap extends CanvasWorkflowIpcChannelMap, CanvasWorkflowRuntimeIpcChannelMap {}
}

export {}
