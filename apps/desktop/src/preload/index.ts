/**
 * Preload 脚本 — 在 contextIsolation 环境下通过 contextBridge 向渲染进程暴露安全的 IPC API
 *
 * 安全原则：
 *   - 只暴露明确定义的、类型安全的 IPC 接口
 *   - 不暴露任何原始 Node.js 或 Electron API
 *   - channel 名称由 @spark/protocol 的类型系统约束，防止任意 channel 调用
 *
 * IPC 返回值格式：
 *   - 主进程返回 IpcResult<T>，包含 ok/data 或 ok/error
 *   - preload 层解包 IpcResult，成功时返回 data，失败时 throw Error
 *   - 这样渲染进程可以使用标准的 try/catch 处理错误
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcStreamChannel,
  IpcStreamPayload,
} from '@spark/protocol'
import { VOICE_AUDIO_CHUNK_CHANNEL, type VoiceAudioChunkPayload } from '@spark/protocol/voice'

/**
 * IPC 调用结果格式（与主进程 typed-ipc.ts 中的 IpcResult 匹配）
 */
interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

/**
 * `window.spark` 的 TypeScript 类型声明
 *
 * 在渲染进程中使用：
 * @example
 * // 成功调用
 * const res = await window.spark.invoke('session:create', { providerProfileId: 'xxx' })
 *
 * // 错误处理
 * try {
 *   await window.spark.invoke('session:create', { providerProfileId: 'xxx' })
 * } catch (err) {
 *   // err 是 SparkIpcError 实例
 *   console.error(err.code, err.message)
 * }
 */
/**
 * 渲染进程可识别的运行平台。
 * 取自 `process.platform`，可能值：'darwin' | 'win32' | 'linux' | 其他 Node.js 平台字符串。
 */
export type SparkPlatform = typeof process.platform

export interface SparkApi {
  /**
   * 类型安全的双向 IPC 调用（renderer → main → response）
   *
   * 成功时返回 response data，失败时 throw SparkIpcError
   *
   * @param channel - IpcChannelMap 中定义的 channel 名称
   * @param request - 对应 channel 的 Request 类型
   * @returns 对应 channel 的 Response 类型
   * @throws SparkIpcError 当主进程返回错误时
   */
  invoke: <C extends IpcChannel>(channel: C, request: IpcRequest<C>) => Promise<IpcResponse<C>>

  /**
   * 订阅流式事件（main → renderer 单向推送）
   *
   * @param channel - IpcStreamChannelMap 中定义的 stream channel 名称
   * @param callback - 收到事件时的回调函数
   * @returns 取消订阅的函数（调用后停止监听）
   */
  on: <C extends IpcStreamChannel>(
    channel: C,
    callback: (payload: IpcStreamPayload<C>) => void,
  ) => () => void

  /**
   * 当前运行平台（同步常量，渲染进程不需要 IPC 即可读取）
   */
  platform: SparkPlatform

  /**
   * 推送语音音频 chunk（高频流式，fire-and-forget，不走 invoke/response）
   *
   * 渲染进程 AudioWorklet 采集 16kHz/16bit PCM 后通过此通道推给主进程
   * OnlineRecognizer 做增量解码。
   */
  sendVoiceAudioChunk: (payload: VoiceAudioChunkPayload) => void

  /**
   * 取拖拽/选择得到的 File 在磁盘上的真实路径。
   *
   * Electron 32 移除了渲染进程里的 `File.prototype.path` 补丁，唯一受支持的方式是
   * 主进程侧的 `webUtils.getPathForFile`。渲染进程不能直接 import electron，
   * 因此这里由 preload 转发——这是拖拽附件能拿到路径的唯一通道。
   *
   * @returns 真实绝对路径；非本地文件（如浏览器内合成的 File）返回空字符串。
   */
  getPathForFile: (file: File) => string
}

/**
 * IPC 调用错误类型
 *
 * 当主进程返回 { ok: false, error: { code, message } } 时，
 * preload 层抛出此错误，渲染进程可以通过 instanceof 判断
 */
export class SparkIpcError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    // contextBridge 结构化克隆只保留 message/name/stack，自定义属性（code）会丢。
    // 把 code 编进 name（`SparkIpcError:<code>`），渲染进程可从 name 恢复错误码。
    this.name = `SparkIpcError:${code}`
    this.code = code
  }
}

/**
 * 解包 IpcResult，成功时返回 data，失败时 throw SparkIpcError
 */
function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok && result.data !== undefined) {
    return result.data
  }

  const error = result.error ?? { code: 'UNKNOWN', message: 'Unknown IPC error' }
  throw new SparkIpcError(error.code, error.message)
}

// 通过 contextBridge 将 SparkApi 安全暴露给渲染进程，挂载到 window.spark
contextBridge.exposeInMainWorld('spark', {
  invoke: async <C extends IpcChannel>(
    channel: C,
    request: IpcRequest<C>,
  ): Promise<IpcResponse<C>> => {
    const result = (await ipcRenderer.invoke(channel, request)) as IpcResult<IpcResponse<C>>
    return unwrapIpcResult(result)
  },

  on: <C extends IpcStreamChannel>(
    channel: C,
    callback: (payload: IpcStreamPayload<C>) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: IpcStreamPayload<C>): void =>
      callback(payload)
    ipcRenderer.on(channel, listener)
    // 返回取消订阅函数
    return () => {
      ipcRenderer.off(channel, listener)
    }
  },

  // 同步暴露平台标识，用于渲染进程在首次渲染时决定 UI（无需 IPC 等待）
  platform: process.platform,

  // 语音音频 chunk 流：fire-and-forget，主进程 ipcMain.on 接收
  sendVoiceAudioChunk: (payload: VoiceAudioChunkPayload): void => {
    ipcRenderer.send(VOICE_AUDIO_CHUNK_CHANNEL, payload)
  },

  // 拖拽/文件选择 → 磁盘真实路径（Electron 32+ 唯一受支持方式，详见 SparkApi 定义）
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      // 非本地文件（渲染进程合成的 Blob/File）会抛出，视为「无路径」
      return ''
    }
  },
} satisfies SparkApi)

// 为渲染进程提供 TypeScript 类型支持，通过 declare global 扩展 Window 接口
declare global {
  interface Window {
    spark: SparkApi
  }
}
