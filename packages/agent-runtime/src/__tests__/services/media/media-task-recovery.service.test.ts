import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { recoverMediaTask } from '../../../services/media/media-task-recovery.service.js'
import type { MediaTaskPollingDescriptor } from '../../../services/media/media-task-polling.types.js'

describe('recoverMediaTask', () => {
  let directory: string | undefined

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
    directory = undefined
  })

  it('reuses a manifest query contract and never calls task creation', async () => {
    directory = mkdtempSync(join(tmpdir(), 'spark-recovery-'))
    let queryCount = 0
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      const value = String(url)
      calls.push(value)
      if (value.endsWith('/tasks/provider-task-1')) {
        queryCount += 1
        return new Response(
          JSON.stringify(
            queryCount === 1
              ? { id: 'provider-task-1', status: 'running' }
              : {
                  id: 'provider-task-1',
                  status: 'succeeded',
                  result: { url: 'https://cdn.example/video.mp4' },
                },
          ),
          { status: 200 },
        )
      }
      if (value === 'https://cdn.example/video.mp4')
        return new Response(new Uint8Array([0, 1, 2, 3]))
      return new Response('unexpected endpoint', { status: 404 })
    }
    const descriptor: MediaTaskPollingDescriptor = {
      version: 1,
      providerKind: 'custom',
      strategy: 'manifest',
      capability: 'video.generate',
      modelId: 'custom-video',
      manifestId: 'custom-video-manifest',
      outputType: 'video',
      manifest: {
        id: 'custom-video-manifest',
        contractVersion: 2,
        providerKind: 'custom',
        modelId: 'custom-video',
        displayName: 'Custom video',
        domains: ['video'],
        capabilities: [
          {
            id: 'video.generate',
            label: 'Video',
            input: { required: ['prompt'] },
            output: { types: ['video'] },
            paramSchema: {},
          },
        ],
        invocation: {
          mode: 'async_polling',
          endpoint: '/generations',
          method: 'POST',
          contentType: 'json',
          requestTemplate: {},
          response: {
            kind: 'task_poll',
            taskIdPaths: ['id'],
            poll: {
              method: 'GET',
              endpoint: '/tasks/{taskId}',
              auth: { kind: 'inherit' },
              body: { kind: 'none' },
            },
            resultPaths: ['result.url'],
            statusPaths: ['status'],
          },
          polling: {
            intervalMs: 1,
            timeoutMs: 1_000,
            maxAttempts: 3,
            statusMap: { running: 'running', succeeded: 'succeeded', failed: 'failed' },
          },
        },
        docs: { sourceUrls: [] },
      } as any,
      manifestCapability: {
        id: 'video.generate',
        label: 'Video',
        input: { required: ['prompt'] },
        output: { types: ['video'] },
        paramSchema: {},
      } as any,
      intervalMs: 1,
      timeoutMs: 1_000,
      maxAttempts: 3,
    }

    const result = await recoverMediaTask({
      descriptor,
      taskId: 'provider-task-1',
      apiKey: 'secret',
      apiEndpoint: 'https://provider.example/v1',
      input: { operation: 'text_to_video', capability: 'video.generate', outputDir: directory },
      fetch: fetchImpl,
      shouldContinue: () => true,
    })

    expect(result.status).toBe('succeeded')
    expect(result.assets[0]?.filePath).toBeTruthy()
    expect(calls.filter((value) => value.includes('/generations')).length).toBe(0)
    expect(calls).toContain('https://provider.example/v1/tasks/provider-task-1')
  })

  it('waits for Google file artifacts and authenticates the download', async () => {
    directory = mkdtempSync(join(tmpdir(), 'spark-google-recovery-'))
    let operationCount = 0
    let fileCount = 0
    const downloadHeaders: Headers[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      const value = String(url)
      if (value.endsWith('/operations/op-1')) {
        operationCount += 1
        return new Response(
          JSON.stringify(
            operationCount === 1
              ? { done: false }
              : {
                  done: true,
                  response: {
                    videos: [
                      {
                        uri: 'https://generativelanguage.googleapis.com/v1beta/files/video-1:download?alt=media',
                      },
                    ],
                  },
                },
          ),
          { status: 200 },
        )
      }
      if (value.endsWith('/files/video-1')) {
        fileCount += 1
        return new Response(JSON.stringify({ state: fileCount === 1 ? 'PROCESSING' : 'ACTIVE' }), {
          status: 200,
        })
      }
      if (value.includes('/files/video-1:download')) {
        downloadHeaders.push(new Headers(init?.headers))
        return new Response(new Uint8Array([1, 2, 3, 4]))
      }
      return new Response('unexpected endpoint', { status: 404 })
    }
    const descriptor: MediaTaskPollingDescriptor = {
      version: 1,
      providerKind: 'google-generative-ai',
      strategy: 'google-generative-ai',
      capability: 'video.generate',
      modelId: 'veo-3.0-generate-preview',
      manifestId: null,
      outputType: 'video',
      manifest: null,
      manifestCapability: null,
      intervalMs: 1,
      timeoutMs: 1_000,
      maxAttempts: 3,
    }

    const result = await recoverMediaTask({
      descriptor,
      taskId: 'operations/op-1',
      apiKey: 'google-secret',
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
      input: { operation: 'text_to_video', capability: 'video.generate', outputDir: directory },
      fetch: fetchImpl,
      shouldContinue: () => true,
    })

    expect(result.status).toBe('succeeded')
    expect(result.assets[0]?.filePath).toBeTruthy()
    expect(fileCount).toBe(2)
    expect(downloadHeaders[0]?.get('x-goog-api-key')).toBe('google-secret')
  })
})
