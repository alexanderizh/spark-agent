import { describe, expect, it } from 'vitest'
import { SidebarOrderUpdateRequestSchema } from './sidebar-order.js'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('SidebarOrderUpdateRequestSchema', () => {
  it('accepts a project-scoped session order', () => {
    expect(
      SidebarOrderUpdateRequestSchema.parse({
        scope: 'sessions',
        projectId: PROJECT_ID,
        itemIds: [SESSION_ID],
      }),
    ).toEqual({ scope: 'sessions', projectId: PROJECT_ID, itemIds: [SESSION_ID] })
  })

  it('rejects duplicate IDs', () => {
    expect(() =>
      SidebarOrderUpdateRequestSchema.parse({
        scope: 'projects',
        itemIds: [PROJECT_ID, PROJECT_ID],
      }),
    ).toThrow('排序列表不能包含重复项')
  })
})
