export type CanvasToolInputIssue = {
  path: string
  code: 'type' | 'required' | 'enum' | 'additional_property' | 'constraint' | 'union'
  message: string
}

export type CanvasToolInputValidationResult = {
  valid: boolean
  issues: CanvasToolInputIssue[]
}

type JSONSchema = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function propertyPath(parent: string, property: string): string {
  return parent ? `${parent}.${property}` : property
}

function arrayPath(parent: string, index: number): string {
  return `${parent}[${index}]`
}

function issue(
  issues: CanvasToolInputIssue[],
  path: string,
  code: CanvasToolInputIssue['code'],
  message: string,
): void {
  issues.push({ path: path || '$', code, message })
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateUnion(
  branches: unknown[],
  value: unknown,
  path: string,
  issues: CanvasToolInputIssue[],
): void {
  const branchIssues = branches.map((branch) => {
    const next: CanvasToolInputIssue[] = []
    validateNode(isRecord(branch) ? branch : {}, value, path, next)
    return next
  })
  if (branchIssues.some((candidate) => candidate.length === 0)) return
  const best = branchIssues.sort((left, right) => left.length - right.length)[0] ?? []
  if (best.length > 0) issues.push(...best)
  else issue(issues, path, 'union', '不符合任何允许的参数结构')
}

function validateNode(
  schema: JSONSchema,
  value: unknown,
  path: string,
  issues: CanvasToolInputIssue[],
): void {
  const union = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null
  if (union != null) {
    validateUnion(union, value, path, issues)
    return
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameValue(candidate, value))) {
    issue(issues, path, 'enum', `必须是 ${schema.enum.map(String).join('、')} 之一`)
    return
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !sameValue(schema.const, value)) {
    issue(issues, path, 'enum', `必须等于 ${String(schema.const)}`)
    return
  }

  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) {
        issue(issues, path, 'type', '必须是对象')
        return
      }
      const properties = isRecord(schema.properties) ? schema.properties : {}
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((item): item is string => typeof item === 'string')
          : [],
      )
      for (const property of required) {
        if (
          !Object.prototype.hasOwnProperty.call(value, property) ||
          value[property] === undefined
        ) {
          issue(issues, propertyPath(path, property), 'required', '必填字段缺失')
        }
      }
      for (const [property, propertyValue] of Object.entries(value)) {
        const propertySchema = properties[property]
        if (isRecord(propertySchema)) {
          validateNode(propertySchema, propertyValue, propertyPath(path, property), issues)
          continue
        }
        if (schema.additionalProperties === false) {
          issue(issues, propertyPath(path, property), 'additional_property', '不支持该字段')
        } else if (isRecord(schema.additionalProperties)) {
          validateNode(
            schema.additionalProperties,
            propertyValue,
            propertyPath(path, property),
            issues,
          )
        }
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issue(issues, path, 'type', '必须是数组')
        return
      }
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        issue(issues, path, 'constraint', `至少需要 ${schema.minItems} 项`)
      }
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        issue(issues, path, 'constraint', `最多允许 ${schema.maxItems} 项`)
      }
      if (
        schema.uniqueItems === true &&
        new Set(value.map((item) => JSON.stringify(item))).size !== value.length
      ) {
        issue(issues, path, 'constraint', '数组项不能重复')
      }
      if (isRecord(schema.items)) {
        value.forEach((item, index) =>
          validateNode(schema.items as JSONSchema, item, arrayPath(path, index), issues),
        )
      }
      return
    }
    case 'string':
      if (typeof value !== 'string') issue(issues, path, 'type', '必须是字符串')
      else {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
          issue(issues, path, 'constraint', `长度不能少于 ${schema.minLength}`)
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
          issue(issues, path, 'constraint', `长度不能超过 ${schema.maxLength}`)
        }
        if (typeof schema.pattern === 'string') {
          try {
            if (!new RegExp(schema.pattern).test(value)) {
              issue(issues, path, 'constraint', `必须匹配格式 ${schema.pattern}`)
            }
          } catch {
            // Invalid schema patterns are ignored consistently with the MCP converter.
          }
        }
      }
      return
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issue(issues, path, 'type', '必须是整数')
      } else {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
          issue(issues, path, 'constraint', `不能小于 ${schema.minimum}`)
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
          issue(issues, path, 'constraint', `不能大于 ${schema.maximum}`)
        }
      }
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issue(issues, path, 'type', '必须是有限数字')
      } else {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
          issue(issues, path, 'constraint', `不能小于 ${schema.minimum}`)
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
          issue(issues, path, 'constraint', `不能大于 ${schema.maximum}`)
        }
      }
      return
    case 'boolean':
      if (typeof value !== 'boolean') issue(issues, path, 'type', '必须是布尔值')
      return
    default:
      return
  }
}

export function validateCanvasToolInput(
  schema: JSONSchema,
  input: unknown,
): CanvasToolInputValidationResult {
  const issues: CanvasToolInputIssue[] = []
  validateNode(schema, input, '', issues)
  return { valid: issues.length === 0, issues }
}

export function formatCanvasToolInputIssues(
  toolName: string,
  issues: readonly CanvasToolInputIssue[],
): string {
  const detail = issues
    .slice(0, 8)
    .map((item) => `${item.path}: ${item.message}`)
    .join('；')
  const suffix = issues.length > 8 ? `；另有 ${issues.length - 8} 个问题` : ''
  return `画布工具 ${toolName} 参数校验失败：${detail}${suffix}`
}
