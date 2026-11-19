import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatDrafts } from './chat-draft'
import { SubmitError } from './relay'

const target = { deviceId: 'desktop-a', sessionId: 'shared' }

test('leaving and reopening a chat retains the pending request and its unresolved draft', async () => {
  const drafts = new ChatDrafts()
  const firstView = drafts.forTarget(target)
  let notifications = 0
  const leave = firstView.subscribe(() => notifications++)
  firstView.setText('  same message  ')
  let reject!: (reason: Error) => void
  const receipt = new Promise<never>((_, fail) => {
    reject = fail
  })
  let submissions = 0
  const submit = (text: string) => {
    assert.equal(text, 'same message')
    submissions++
    return receipt
  }
  const pending = firstView.send(submit)
  assert.equal(notifications, 2)
  leave()

  const reopened = drafts.forTarget({ ...target })
  assert.equal(reopened.getSnapshot().status, 'sending')
  assert.equal(await reopened.send(submit), false)
  reject(new SubmitError('unconfirmed', new Error('lost receipt')))
  assert.equal(await pending, false)
  assert.equal(notifications, 2)

  const locked = drafts.forTarget(target).getSnapshot()
  assert.equal(locked.status, 'unconfirmed')
  assert.equal(locked.text, '  same message  ')
  reopened.setText('different text')
  assert.equal(reopened.getSnapshot(), locked)
  assert.equal(await reopened.send(submit), false)
  assert.equal(submissions, 1)
  for (const other of [
    drafts.forTarget({ ...target, deviceId: 'desktop-b' }),
    drafts.forTarget({ ...target, sessionId: 'another' }),
    new ChatDrafts().forTarget(target),
  ]) {
    assert.equal(other.getSnapshot().status, 'idle')
    assert.equal(other.getSnapshot().text, '')
  }

  reopened.resolveUnconfirmed(locked, false)
  assert.equal(reopened.getSnapshot().status, 'idle')
  assert.equal(reopened.getSnapshot().text, '  same message  ')
  reopened.resolveUnconfirmed(locked, true)
  assert.equal(reopened.getSnapshot().text, '  same message  ')
})

test('a confirmed queue clears the draft, but a local rejection leaves it editable', async () => {
  const draft = new ChatDrafts().forTarget(target)
  draft.setText('message')
  assert.equal(
    await draft.send(async () => {
      throw new SubmitError('not-sent', new Error('offline'))
    }),
    false,
  )
  assert.equal(draft.getSnapshot().status, 'idle')
  assert.equal(draft.getSnapshot().text, 'message')
  assert.equal(await draft.send(async () => ({ started: false })), true)
  assert.deepEqual(draft.getSnapshot(), { status: 'idle', text: '', notice: '已加入电脑端队列' })
})
