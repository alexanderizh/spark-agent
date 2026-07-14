import type { CanvasPromptResponseFields, CanvasPromptTaskFields } from './canvas-prompt.js'

declare module './ipc/index.js' {
  interface CanvasMediaTaskCreateRequest extends CanvasPromptTaskFields {}
  interface CanvasTextTaskCreateRequest extends CanvasPromptTaskFields {}
  interface CanvasMediaTaskCreateResponse extends CanvasPromptResponseFields {}
  interface CanvasTextTaskCreateResponse extends CanvasPromptResponseFields {}
}

export {}
