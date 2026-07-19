import { describe, expect, it } from 'vitest'
import { getBranchGroups } from './BranchPicker'

describe('getBranchGroups', () => {
  it('groups local and remote branches and sorts each group by latest commit time', () => {
    const groups = getBranchGroups({
      currentBranch: 'main',
      branches: ['main', 'older-local'],
      branchDetails: [
        { name: 'origin/older', kind: 'remote', updatedAt: 100 },
        { name: 'older-local', kind: 'local', updatedAt: 200 },
        { name: 'origin/latest', kind: 'remote', updatedAt: 400 },
        { name: 'main', kind: 'local', updatedAt: 300 },
      ],
    })

    expect(groups.map((group) => group.label)).toEqual(['本地分支', '远程分支'])
    expect(groups[0]?.branches.map((branch) => branch.name)).toEqual(['main', 'older-local'])
    expect(groups[1]?.branches.map((branch) => branch.name)).toEqual([
      'origin/latest',
      'origin/older',
    ])
  })

  it('filters both groups and remains compatible with legacy string-only state', () => {
    expect(
      getBranchGroups(
        { currentBranch: 'main', branches: ['main', 'feature/search'] },
        'search',
      )[0]?.branches.map((branch) => branch.name),
    ).toEqual(['feature/search'])
  })
})
