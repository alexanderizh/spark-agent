// @vitest-environment jsdom

import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasProjectSelectionProvider,
  useCanvasProjectSelection,
} from './CanvasProjectSelectionContext'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function EditRequester() {
  const { requestProjectEdit } = useCanvasProjectSelection()
  return (
    <button type="button" onClick={() => requestProjectEdit('project-1')}>
      编辑项目
    </button>
  )
}

function EditHandler({ onEdit }: { onEdit: (projectId: string) => void }) {
  const { registerProjectEditHandler } = useCanvasProjectSelection()
  useEffect(
    () =>
      registerProjectEditHandler((projectId) => {
        onEdit(projectId)
        return true
      }),
    [onEdit, registerProjectEditHandler],
  )
  return null
}

function Harness({ registered, onEdit }: { registered: boolean; onEdit: (id: string) => void }) {
  return (
    <CanvasProjectSelectionProvider>
      <EditRequester />
      {registered && <EditHandler onEdit={onEdit} />}
    </CanvasProjectSelectionProvider>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CanvasProjectSelectionContext edit requests', () => {
  it('delivers a pending sidebar edit request after the project view mounts', async () => {
    const onEdit = vi.fn()
    await act(async () => root.render(<Harness registered={false} onEdit={onEdit} />))
    act(() => container.querySelector('button')?.click())
    expect(onEdit).not.toHaveBeenCalled()

    await act(async () => root.render(<Harness registered onEdit={onEdit} />))

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledWith('project-1')
  })
})
