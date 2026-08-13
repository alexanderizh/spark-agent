// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateProjectModal } from './SidebarSessionList'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const actual = await vi.importActual<typeof import('@lobehub/ui')>('@lobehub/ui')

  const Button = ({
    children,
    icon,
    onClick,
    size: _size,
    type: _type,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode
    size?: string
    type?: string
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  )

  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />

  const Modal = ({
    open,
    title,
    children,
    footer,
  }: {
    open?: boolean
    title?: React.ReactNode
    children?: React.ReactNode
    footer?: React.ReactNode
  }) =>
    open ? (
      <div className="project-create-modal">
        <div className="project-create-modal-title-slot">{title}</div>
        {children}
        {footer}
      </div>
    ) : null

  return { ...actual, Button, Input, Modal }
})

vi.mock('./i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'sidebar.project.createTitle': '新建项目',
        'sidebar.project.createSubtitle': '在本地文件夹中创建一个新项目',
        'sidebar.project.name': '项目名称',
        'sidebar.project.placeholder': '例如 Spark-Agent',
        'sidebar.project.folderLabel': '项目位置',
        'sidebar.project.dropFolder': '将文件夹拖到这里',
        'sidebar.project.dropFolderHint': '或点击下方按钮选择本地文件夹',
        'sidebar.project.chooseFolder': '选择本地文件夹',
        'sidebar.project.create': '创建项目',
        'common.cancel': '取消',
        'common.change': '更换',
      })[key] ?? key,
  }),
}))

function createDirectoryTransfer(path: string): DataTransfer {
  const file = new File([''], path.split('/').pop() ?? 'project')
  const item = {
    kind: 'file',
    getAsFile: () => file,
    webkitGetAsEntry: () => ({ isDirectory: true }),
  }
  return {
    types: ['Files'],
    items: [item],
    files: [file],
    dropEffect: 'none',
    getData: () => '',
  } as unknown as DataTransfer
}

describe('CreateProjectModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { getPathForFile: () => '/Users/test/alpha' },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('passes a dropped folder path to the project path handler', async () => {
    const onDropPath = vi.fn().mockResolvedValue(undefined)
    const dataTransfer = createDirectoryTransfer('/Users/test/alpha')

    await act(async () => {
      root.render(
        <CreateProjectModal
          name=""
          path=""
          notice=""
          setName={() => undefined}
          onPickPath={() => undefined}
          onDropPath={onDropPath}
          onCancel={() => undefined}
          onCreate={() => undefined}
        />,
      )
    })

    const dropzone = container.querySelector<HTMLElement>('.project-create-dropzone')
    if (dropzone == null) throw new Error('Missing project dropzone')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })

    await act(async () => {
      dropzone.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(onDropPath).toHaveBeenCalledWith('/Users/test/alpha')
  })
})
