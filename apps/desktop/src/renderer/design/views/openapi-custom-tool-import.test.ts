import { describe, expect, it } from 'vitest'
import { buildCustomToolDraft } from './custom-tools-model'
import { parseOpenApiToEditorDrafts } from './openapi-custom-tool-import'

describe('OpenAPI custom tool import', () => {
  it('imports OpenAPI 3 path, query, header, JSON body and bearer auth', () => {
    const result = parseOpenApiToEditorDrafts(`
openapi: 3.0.3
info: { title: Issue API, version: 1.0.0 }
servers: [{ url: 'https://api.example.com/v1' }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    IssueInput:
      type: object
      required: [title]
      properties:
        title: { type: string, description: Issue title }
        priority: { type: integer }
paths:
  /projects/{projectId}/issues:
    post:
      operationId: createIssue
      summary: 创建 Issue
      description: 在指定项目中创建一个新的 Issue 并返回创建结果
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: projectId, in: path, required: true, schema: { type: string } }
        - { name: dryRun, in: query, schema: { type: boolean } }
        - { name: X-Request-Id, in: header, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/IssueInput' }
      responses: { '200': { description: ok } }
`)
    expect(result).toMatchObject({ title: 'Issue API', version: '3.0.3' })
    expect(result.operations).toHaveLength(1)
    const editor = result.operations[0]?.editor
    expect(editor).not.toBeNull()
    expect(editor).toMatchObject({
      id: 'createissue',
      method: 'POST',
      urlTemplate: 'https://api.example.com/v1/projects/{{projectId}}/issues?dryRun={{dryRun}}',
    })
    expect(JSON.parse(editor?.headersJson ?? '[]')).toEqual([
      { name: 'Authorization', secretRef: 'bearerauth_secret' },
      { name: 'X-Request-Id', valueTemplate: '{{X_Request_Id}}' },
      { name: 'Content-Type', valueTemplate: 'application/json' },
    ])
    expect(editor?.bodyJsonTemplate).toContain('"title": {{title}}')
    if (editor == null) throw new Error('Expected an imported editor')
    expect(buildCustomToolDraft(editor)).toMatchObject({
      type: 'http',
      effect: 'create',
      secretRefs: { bearerauth_secret: 'custom-tool:createissue:bearerauth_secret' },
    })
  })

  it('imports Swagger 2 and keeps unsupported operations visible with diagnostics', () => {
    const result = parseOpenApiToEditorDrafts(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Legacy', version: '1' },
        host: 'legacy.example.com',
        basePath: '/api',
        schemes: ['https'],
        paths: {
          '/users/{id}': {
            get: {
              operationId: 'get_user',
              parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }],
              responses: { 200: { description: 'ok' } },
            },
          },
          '/upload': {
            post: {
              operationId: 'upload_file',
              parameters: [{ name: 'file', in: 'formData', type: 'file' }],
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      }),
    )
    expect(result.operations[0]?.editor?.urlTemplate).toBe(
      'https://legacy.example.com/api/users/{{id}}',
    )
    expect(result.operations[1]).toMatchObject({ editor: null })
    expect(result.operations[1]?.diagnostics.join(' ')).toMatch(/formData/)
  })

  it('rejects external refs instead of importing a semantically incomplete tool', () => {
    const result = parseOpenApiToEditorDrafts(`
openapi: 3.1.0
info: { title: External, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /items:
    post:
      operationId: create_item
      requestBody:
        content:
          application/json:
            schema: { $ref: './schemas.yaml#/Item' }
      responses: { '200': { description: ok } }
`)
    expect(result.operations[0]?.editor).toBeNull()
    expect(result.operations[0]?.diagnostics.join(' ')).toMatch(/外部引用/)
  })

  it('imports a Swagger 2 path-level body parameter', () => {
    const result = parseOpenApiToEditorDrafts(`
swagger: '2.0'
info: { title: Legacy body, version: '1' }
host: legacy.example.com
basePath: /api
paths:
  /issues:
    parameters:
      - in: body
        name: payload
        schema:
          type: object
          properties:
            title: { type: string }
    post:
      operationId: create_issue
      responses: { '200': { description: ok } }
`)
    const editor = result.operations[0]?.editor
    expect(editor?.bodyJsonTemplate).toContain('"title": {{title}}')
    expect(JSON.parse(editor?.inputSchemaJson ?? '{}').required).toEqual(['title'])
  })

  it('reports array parameters instead of silently changing their serialization', () => {
    const result = parseOpenApiToEditorDrafts(`
openapi: 3.0.3
info: { title: Search, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /search:
    get:
      parameters:
        - name: tags
          in: query
          schema: { type: array, items: { type: string } }
      responses: { '200': { description: ok } }
`)
    expect(result.operations[0]?.editor).toBeNull()
    expect(result.operations[0]?.diagnostics.join(' ')).toMatch(/数组序列化规则/)
  })

  it('warns when alternative security requirements are skipped', () => {
    const result = parseOpenApiToEditorDrafts(`
openapi: 3.0.3
info: { title: Alt auth, version: '1' }
servers: [{ url: https://api.example.com }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
    apiKeyAuth: { type: apiKey, in: header, name: X-Api-Key }
paths:
  /items:
    get:
      operationId: list_items
      security:
        - { bearerAuth: [] }
        - { apiKeyAuth: [] }
      responses: { '200': { description: ok } }
`)
    const operation = result.operations[0]
    expect(operation?.editor).not.toBeNull()
    expect(operation?.warnings.join(' ')).toMatch(/2 种可互换的鉴权方案.*未导入/)
    // 第一个组合（bearer）正常导入，备选的 apiKey 方案只提示、不导入。
    expect(JSON.parse(operation?.editor?.headersJson ?? '[]')).toEqual([
      { name: 'Authorization', secretRef: 'bearerauth_secret' },
    ])
  })

  it('fills typed test input defaults instead of empty strings', () => {
    const result = parseOpenApiToEditorDrafts(`
openapi: 3.0.3
info: { title: Typed, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /items:
    post:
      operationId: create_item
      parameters:
        - { name: limit, in: query, schema: { type: integer, default: 20 } }
        - { name: verbose, in: query, schema: { type: boolean } }
        - { name: note, in: query, schema: { type: string } }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                count: { type: number }
                flag: { type: boolean }
                name: { type: string }
      responses: { '200': { description: ok } }
`)
    const testInput = JSON.parse(result.operations[0]?.editor?.testInputJson ?? '{}')
    expect(testInput).toEqual({
      limit: 20,
      verbose: false,
      note: '',
      count: 0,
      flag: false,
      name: '',
    })
  })
})
