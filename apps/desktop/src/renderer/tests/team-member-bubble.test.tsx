// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamMemberBubble } from '../design/components/TeamMemberBubble'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../design/teamAvatar', () => ({
  deriveTeamAvatar: () => ({
    color: '#3b82f6',
  }),
}))

vi.mock('../design/components/AvatarImage', () => ({
  AvatarImage: ({ name }: { name: string }) => <div className="avatar-image-mock">{name}</div>,
}))

describe('TeamMemberBubble', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
  })

  it('hides the bubble body when there is no visible message content', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <TeamMemberBubble
          memberAgentId="agent-1"
          memberName="Reviewer"
          avatarSrc=""
          textContent=""
        >
          {'   '}
        </TeamMemberBubble>,
      )
    })

    expect(container.querySelector('.team-member-bubble-body')).toBeNull()
    expect(container.textContent).toContain('Reviewer')
  })

  it('keeps the bubble body when there is structured visible content', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <TeamMemberBubble
          memberAgentId="agent-1"
          memberName="Reviewer"
          avatarSrc=""
          textContent=""
        >
          <div className="document-output-card">Generated brief.pdf</div>
        </TeamMemberBubble>,
      )
    })

    expect(container.querySelector('.team-member-bubble-body')).not.toBeNull()
    expect(container.textContent).toContain('Generated brief.pdf')
  })

  it('renders peer origin marker when the bubble comes from peer messaging', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <TeamMemberBubble
          memberAgentId="agent-1"
          memberName="Reviewer"
          avatarSrc=""
          origin="peer"
          metaLabel="广播"
          textContent="Heads up"
        >
          {'Heads up'}
        </TeamMemberBubble>,
      )
    })

    expect(container.querySelector('.team-member-bubble.is-peer-origin')).not.toBeNull()
    expect(container.querySelector('.team-member-origin-pill.peer')?.textContent).toBe('广播')
  })
})
