import { describe, expect, it, vi } from 'vitest'
import {
  BailianFilesClient,
  resolveBailianFilesBaseUrl,
} from '../../../services/media/bailian-files.client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('BailianFilesClient', () => {
  it('uses the documented public DashScope Files base URL', () => {
    expect(resolveBailianFilesBaseUrl()).toBe('https://dashscope.aliyuncs.com/api/v1')
    expect(resolveBailianFilesBaseUrl('https://dashscope.aliyuncs.com/api/v1/services/aigc')).toBe(
      'https://dashscope.aliyuncs.com/api/v1',
    )
    expect(() =>
      resolveBailianFilesBaseUrl('https://workspace.cn-beijing.maas.aliyuncs.com'),
    ).toThrow('仅支持北京 Region 的公共 DashScope Base URL')
  })

  it('lists, gets and deletes files with documented paths and pagination', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          request_id: 'list-request',
          data: {
            total: 41,
            page_size: 20,
            page_no: 2,
            files: [
              {
                file_id: 'file-2',
                name: 'report.pdf',
                size: 1024,
                gmt_create: '2026-07-17 10:00:00',
                purpose: 'file-extract',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          request_id: 'get-request',
          data: { file_id: 'file-2', name: 'report.pdf', size: 1024, purpose: 'file-extract' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ request_id: 'delete-request' }))
    const client = new BailianFilesClient({ apiKey: 'test-key', fetch: fetchMock })

    await expect(client.list({ pageNo: 2, pageSize: 20 })).resolves.toMatchObject({
      providerKind: 'bailian',
      paginationToken: '3',
      hasMore: true,
      files: [{ id: 'file-2', filename: 'report.pdf', purpose: 'file-extract' }],
    })
    await expect(client.get('file-2')).resolves.toMatchObject({ id: 'file-2' })
    await expect(client.delete('file-2')).resolves.toEqual({ deleted: true, id: 'file-2' })
    expect(
      fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        method: init?.method ?? 'GET',
      })),
    ).toEqual([
      { url: 'https://dashscope.aliyuncs.com/api/v1/files?page_no=2&page_size=20', method: 'GET' },
      { url: 'https://dashscope.aliyuncs.com/api/v1/files/file-2', method: 'GET' },
      { url: 'https://dashscope.aliyuncs.com/api/v1/files/file-2', method: 'DELETE' },
    ])
  })

  it('uses the native multipart field names and exposes a partial upload failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        request_id: 'upload-request',
        data: {
          uploaded_files: [],
          failed_uploads: [
            { name: 'input.txt', code: 'BadRequest.TooLarge', message: 'Out of space' },
          ],
        },
      }),
    )
    const statMock = vi.fn().mockResolvedValue({ isFile: () => true, size: 1 })
    const openAsBlobMock = vi.fn().mockResolvedValue(new Blob(['x']))
    const client = new BailianFilesClient({
      apiKey: 'test-key',
      fetch: fetchMock,
      stat: statMock as never,
      openAsBlob: openAsBlobMock as never,
    })

    await expect(
      client.upload({
        filePath: '/tmp/input.txt',
        purpose: 'file-extract',
        description: 'sample',
      }),
    ).rejects.toThrow('BadRequest.TooLarge：Out of space')
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect([...body.keys()]).toEqual(['files', 'purpose', 'descriptions'])
    expect(statMock).toHaveBeenCalledWith('/tmp/input.txt')
    expect(openAsBlobMock).toHaveBeenCalledWith('/tmp/input.txt')
  })

  it('keeps the provider request id in HTTP errors', async () => {
    const client = new BailianFilesClient({
      apiKey: 'test-key',
      fetch: async () =>
        jsonResponse(
          { request_id: 'req-123', code: 'InvalidParameter', message: 'File not found.' },
          400,
        ),
    })

    await expect(client.get('missing-file')).rejects.toThrow('RequestId: req-123')
  })
})
