import { describe, expect, it, vi } from 'vitest'

import { QUEUED_SEND_TOAST_MESSAGE, isQueuedSend, notifyQueuedSend } from './queued-send-notice'

function makeToast() {
  return { info: vi.fn() }
}

describe('排队发送提示', () => {
  it('submit-turn 返回 started=false（消息入队未起跑）时弹一条 info 弹窗', () => {
    const toast = makeToast()
    expect(notifyQueuedSend(toast, { started: false })).toBe(true)
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith(QUEUED_SEND_TOAST_MESSAGE)
  })

  it('command:execute 返回 queued=true 时同样提示', () => {
    const toast = makeToast()
    expect(notifyQueuedSend(toast, { queued: true })).toBe(true)
    expect(toast.info).toHaveBeenCalledTimes(1)
  })

  it('正常起跑（started=true）不打扰用户', () => {
    const toast = makeToast()
    expect(notifyQueuedSend(toast, { started: true })).toBe(false)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('响应缺字段（旧主进程/异常形态）时按未排队处理，不误报', () => {
    const toast = makeToast()
    expect(notifyQueuedSend(toast, {})).toBe(false)
    expect(notifyQueuedSend(toast, { started: true, queued: false })).toBe(false)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('started=true 同时 queued=true 时以排队为准', () => {
    expect(isQueuedSend({ started: true, queued: true })).toBe(true)
    expect(isQueuedSend({ started: true, queued: false })).toBe(false)
  })
})
