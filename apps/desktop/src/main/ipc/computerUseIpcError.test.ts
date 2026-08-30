import { SparkError } from '@spark/shared'
import { describe, expect, it } from 'vitest'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'
import { NativeHostArtifactError } from '../services/computer-use/NativeHostArtifact.js'
import { safeComputerUseIpc } from './computerUseIpcError.js'

describe('safeComputerUseIpc', () => {
  it('forwards ComputerUseBrokerError diagnostics and the retryable flag onto the SparkError context', async () => {
    await expect(
      safeComputerUseIpc(() => {
        throw new ComputerUseBrokerError('action_timeout', 'host request timed out', undefined, {
          retryable: true,
          diagnostic: { diagnosticCode: 'host_request_timeout', stage: 'execute' },
        })
      }),
    ).rejects.toMatchObject({
      name: 'SparkError',
      code: 'action_timeout',
      context: {
        retryable: true,
        diagnostic: { diagnosticCode: 'host_request_timeout', stage: 'execute' },
      },
    })
  })

  it('forwards NativeHostArtifactError diagnostics onto the SparkError context', async () => {
    await expect(
      safeComputerUseIpc(() => {
        throw new NativeHostArtifactError('native_host_incompatible', 'version too low', {
          diagnostic: {
            diagnosticCode: 'artifact_version_too_low',
            stage: 'verify',
            repairAction: 'update_app',
          },
        })
      }),
    ).rejects.toMatchObject({
      name: 'SparkError',
      code: 'native_host_incompatible',
      context: {
        diagnostic: { diagnosticCode: 'artifact_version_too_low', repairAction: 'update_app' },
      },
    })
  })

  it('wraps a diagnostic-free Computer Use error without injecting an empty context envelope', async () => {
    const error = await safeComputerUseIpc(() => {
      throw new ComputerUseBrokerError('stale_frame', 'frame drifted')
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(SparkError)
    expect((error as SparkError).code).toBe('stale_frame')
    expect((error as SparkError).context).toBeUndefined()
  })

  it('rethrows non Computer Use errors untouched', async () => {
    const unrelated = new Error('unrelated')
    await expect(safeComputerUseIpc(() => Promise.reject(unrelated))).rejects.toBe(unrelated)
  })
})
