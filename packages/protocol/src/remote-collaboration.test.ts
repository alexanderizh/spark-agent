import { describe, expect, it } from 'vitest'
import { serializeRemoteCollaborationMessageFingerprintPayload } from './remote-collaboration.js'

describe('remote collaboration request fingerprint payload', () => {
  it('normalizes message whitespace and includes attachment and question reply identity', () => {
    const base = serializeRemoteCollaborationMessageFingerprintPayload({
      text: '  Build the project  ',
      attachmentRefs: ['artifact-a'],
    })
    expect(
      serializeRemoteCollaborationMessageFingerprintPayload({
        text: 'Build the project',
        attachmentRefs: ['artifact-a'],
      }),
    ).toBe(base)
    expect(
      serializeRemoteCollaborationMessageFingerprintPayload({
        text: '',
        attachmentRefs: [],
        questionReply: { questionId: 'question-a', answers: { '0': 'yes' } },
      }),
    ).not.toBe(
      serializeRemoteCollaborationMessageFingerprintPayload({ text: '', attachmentRefs: [] }),
    )
  })
})
