import { describe, expect, it } from 'vitest'
import { validateCanvasToolInput } from './canvasToolInputValidation'

describe('canvas tool input validation', () => {
  const workflowSchema = {
    type: 'object',
    required: ['name', 'nodes'],
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      nodes: {
        type: 'array',
        minItems: 1,
        items: {
          oneOf: [
            {
              type: 'object',
              required: ['ref', 'role', 'type', 'title'],
              additionalProperties: false,
              properties: {
                ref: { type: 'string' },
                role: { type: 'string', enum: ['input'] },
                type: { type: 'string', enum: ['image', 'prompt'] },
                title: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['ref', 'role', 'operation', 'dependsOn'],
              additionalProperties: false,
              properties: {
                ref: { type: 'string' },
                role: { type: 'string', enum: ['operation'] },
                operation: { type: 'string' },
                dependsOn: { type: 'array', minItems: 1, items: { type: 'string' } },
              },
            },
          ],
        },
      },
    },
  }

  it('reports exact paths for missing and guessed workflow fields', () => {
    const result = validateCanvasToolInput(workflowSchema, {
      name: '测试流程',
      nodes: [
        {
          type: 'input',
          inputType: 'image',
          title: '参考图',
          placeholder: true,
        },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'nodes[0].ref', code: 'required' }),
        expect.objectContaining({ path: 'nodes[0].role', code: 'required' }),
      ]),
    )
  })

  it('accepts the documented workflow node contract', () => {
    expect(
      validateCanvasToolInput(workflowSchema, {
        name: '测试流程',
        nodes: [{ ref: 'image', role: 'input', type: 'image', title: '参考图' }],
      }).valid,
    ).toBe(true)
  })

  it('enforces string patterns and numeric ranges', () => {
    const schema = {
      type: 'object',
      required: ['ref', 'count', 'ratio'],
      properties: {
        ref: { type: 'string', pattern: '^[a-z_]+$' },
        count: { type: 'integer', minimum: 1, maximum: 4 },
        ratio: { type: 'number', minimum: 0, maximum: 1 },
      },
    }

    const result = validateCanvasToolInput(schema, {
      ref: 'Bad Ref',
      count: 0,
      ratio: 1.5,
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ref', code: 'constraint' }),
        expect.objectContaining({ path: 'count', code: 'constraint' }),
        expect.objectContaining({ path: 'ratio', code: 'constraint' }),
      ]),
    )
  })
})
