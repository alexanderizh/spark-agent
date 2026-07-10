import { describe, expect, it } from 'vitest'

import { getCanvasToolSchemas } from './canvas.tools'

describe('canvas agent tool schemas', () => {
  it('does not expose multi-board operations to canvas agents', () => {
    const names = getCanvasToolSchemas().map((tool) => tool.name)

    expect(names).not.toContain('canvas_list_boards')
    expect(names).not.toContain('canvas_create_board')
    expect(names).not.toContain('canvas_rename_board')
    expect(names).not.toContain('canvas_delete_board')
    expect(names).not.toContain('canvas_duplicate_board')
    expect(names).not.toContain('canvas_switch_board')
    expect(names).not.toContain('canvas_copy_nodes_to_board')
    expect(names).not.toContain('canvas_insert_asset_to_board')
    expect(names).toContain('canvas_insert_asset')
  })

  it('keeps board ids out of public node and asset schemas', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_list_nodes?.inputSchema).not.toHaveProperty('properties.boardId')
    expect(schemas.canvas_find_nodes?.inputSchema).not.toHaveProperty('properties.boardId')
    expect(schemas.canvas_insert_asset?.inputSchema).not.toHaveProperty('properties.boardId')
  })

  it('exposes operation inspection and persistent configuration tools', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_get_operation_config).toBeDefined()
    expect(schemas.canvas_update_operation_config).toBeDefined()
    expect(schemas.canvas_run_operation?.inputSchema).toHaveProperty('required', ['nodeId'])
  })
})
