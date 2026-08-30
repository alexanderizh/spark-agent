// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTaskItem } from '@spark/protocol'

import { SessionSchedulePanel } from './SessionSchedulePanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('SessionSchedulePanel', () => {
  let container: HTMLDivElement
  let root: Root
  const invoke = vi.fn(async (channel: string): Promise<unknown> => {
    if (channel === 'scheduled-task:list') return { tasks: [] }
    if (channel === 'scheduled-task:create') return { task: { id: 'task-new' } }
    return {}
  })

  it('uses application theme tokens instead of light-only fallback colors', () => {
    const styles = readFileSync(resolve(__dirname, 'SessionSchedulePanel.less'), 'utf8')

    expect(styles).toContain('--schedule-panel: var(--panel)')
    expect(styles).toContain('--schedule-text: var(--text)')
    expect(styles).toContain('--schedule-accent: var(--primary)')
    expect(styles).not.toContain('--color-bg-container')
    expect(styles).not.toContain('--color-text-')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    invoke.mockClear()
  })

  it('loads only tasks bound to the current session', async () => {
    await act(async () => {
      root.render(
        <SessionSchedulePanel
          open
          session={{ id: 'session-1', title: '代理巡检' }}
          onClose={() => undefined}
        />,
      )
    })

    expect(invoke).toHaveBeenCalledWith('scheduled-task:list', {
      scope: 'session',
      sessionId: 'session-1',
    })
    expect(container.textContent).toContain('代理巡检')
    expect(container.textContent).toContain('仅在此会话运行')
  })

  it('creates an interval task in the bound session', async () => {
    const onTasksChange = vi.fn()
    await act(async () => {
      root.render(
        <SessionSchedulePanel
          open
          session={{ id: 'session-1', title: '代理巡检' }}
          onClose={() => undefined}
          onTasksChange={onTasksChange}
        />,
      )
    })

    const addButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('新增任务'),
    )
    if (addButton == null) throw new Error('Missing add task button')
    act(() => addButton.click())

    const name = container.querySelector<HTMLInputElement>('input[name="schedule-name"]')
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[name="schedule-prompt"]')
    if (name == null || prompt == null) throw new Error('Missing task form fields')

    act(() => {
      setInputValue(name, '每半小时检查代理')
      setInputValue(prompt, '检查代理接口和工作流是否健康，并汇报异常。')
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建任务'),
    )
    if (saveButton == null) throw new Error('Missing create task button')
    await act(async () => saveButton.click())

    expect(invoke).toHaveBeenCalledWith(
      'scheduled-task:create',
      expect.objectContaining({
        name: '每半小时检查代理',
        promptTemplate: '检查代理接口和工作流是否健康，并汇报异常。',
        scope: 'session',
        sessionId: 'session-1',
        triggerType: 'interval',
        skipIfSessionRunning: true,
        continueOnError: true,
      }),
    )
    expect(onTasksChange).toHaveBeenCalledOnce()
  })

  it('allows disabling the session running and error continuation guards', async () => {
    await act(async () => {
      root.render(
        <SessionSchedulePanel
          open
          session={{ id: 'session-1', title: '代理巡检' }}
          onClose={() => undefined}
        />,
      )
    })

    const addButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('新增任务'),
    )
    if (addButton == null) throw new Error('Missing add task button')
    act(() => addButton.click())

    const name = container.querySelector<HTMLInputElement>('input[name="schedule-name"]')
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[name="schedule-prompt"]')
    if (name == null || prompt == null) throw new Error('Missing task form fields')
    act(() => {
      setInputValue(name, '不重叠任务')
      setInputValue(prompt, '检查状态')
    })

    const runningGuard = container.querySelector<HTMLButtonElement>('[aria-label="会话运行中跳过"]')
    const errorGuard = container.querySelector<HTMLButtonElement>('[aria-label="报错后继续执行"]')
    if (runningGuard == null || errorGuard == null)
      throw new Error('Missing session guard switches')
    expect(runningGuard.getAttribute('aria-checked')).toBe('true')
    expect(errorGuard.getAttribute('aria-checked')).toBe('true')
    act(() => {
      runningGuard.click()
      errorGuard.click()
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建任务'),
    )
    if (saveButton == null) throw new Error('Missing create task button')
    await act(async () => saveButton.click())

    expect(invoke).toHaveBeenCalledWith(
      'scheduled-task:create',
      expect.objectContaining({
        skipIfSessionRunning: false,
        continueOnError: false,
      }),
    )
  })

  it('shows an existing one-time execution in local wall-clock time when editing', async () => {
    const runAt = '2026-08-01T04:30:00-08:00'
    const onceTask = {
      id: 'task-once',
      name: '单次检查',
      promptTemplate: '检查一次',
      triggerType: 'once',
      runAt,
      intervalSeconds: null,
      cronExpression: null,
      enabled: true,
      nextRunAt: '2026-08-01 12:30:00',
    } as ScheduledTaskItem
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'scheduled-task:list') return { tasks: [onceTask] }
      return {}
    })

    await act(async () => {
      root.render(
        <SessionSchedulePanel
          open
          session={{ id: 'session-1', title: '代理巡检' }}
          onClose={() => undefined}
        />,
      )
    })

    const editButton = container.querySelector<HTMLButtonElement>('button[title="编辑"]')
    if (editButton == null) throw new Error('Missing edit task button')
    act(() => editButton.click())

    const runAtInput = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')
    if (runAtInput == null) throw new Error('Missing one-time run input')
    const date = new Date(runAt)
    const pad = (value: number) => String(value).padStart(2, '0')
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    expect(runAtInput.value).toBe(expected)
  })

  it('shows why a task was automatically paused after an error', async () => {
    const pausedTask = {
      id: 'task-paused',
      name: '失败后暂停',
      promptTemplate: '检查服务',
      triggerType: 'interval',
      intervalSeconds: 300,
      cronExpression: null,
      runAt: null,
      enabled: false,
      lastError: 'Provider request failed',
      nextRunAt: null,
    } as ScheduledTaskItem
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'scheduled-task:list') return { tasks: [pausedTask] }
      return {}
    })

    await act(async () => {
      root.render(
        <SessionSchedulePanel
          open
          session={{ id: 'session-1', title: '代理巡检' }}
          onClose={() => undefined}
        />,
      )
    })

    expect(container.textContent).toContain('已暂停：Provider request failed')
  })
})
