import type { FfmpegCapabilityService } from '../services/FfmpegCapabilityService.js'
import { ffmpegCapabilityService } from '../services/FfmpegCapabilityService.js'
import { typedIpcHandle } from './typed-ipc.js'

export interface RegisterVideoWorkbenchCapabilityIpcOptions {
  capabilityService?: Pick<FfmpegCapabilityService, 'getCapabilities'>
}

export function registerVideoWorkbenchCapabilityIpc(
  options: RegisterVideoWorkbenchCapabilityIpcOptions = {},
): void {
  const capabilityService = options.capabilityService ?? ffmpegCapabilityService
  typedIpcHandle('video-workbench:get-ffmpeg-capabilities', async () =>
    capabilityService.getCapabilities(),
  )
}
