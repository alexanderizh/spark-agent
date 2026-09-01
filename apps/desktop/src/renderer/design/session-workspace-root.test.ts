import { describe, expect, it } from 'vitest'

import {
  NO_PROJECT_WORKSPACE_NAME,
  resolvePathAgainstWorkspaceRoot,
  resolveSessionWorkspaceRootPathForDisplay,
} from './session-workspace-root'

describe('session workspace root for display', () => {
  it('shows a no-project session child directory', () => {
    expect(
      resolveSessionWorkspaceRootPathForDisplay(
        { name: NO_PROJECT_WORKSPACE_NAME, rootPath: '/data/projects/no-project' },
        'session-1',
      ),
    ).toBe('/data/projects/no-project/session-1')
  })

  it('keeps project roots unchanged', () => {
    expect(
      resolveSessionWorkspaceRootPathForDisplay(
        { name: 'Spark Agent', rootPath: '/data/projects/spark-agent/' },
        'session-1',
      ),
    ).toBe('/data/projects/spark-agent/')
  })

  it('preserves Windows separators', () => {
    expect(
      resolveSessionWorkspaceRootPathForDisplay(
        { name: NO_PROJECT_WORKSPACE_NAME, rootPath: 'D:\\SparkWork\\no-project\\' },
        'session-1',
      ),
    ).toBe('D:\\SparkWork\\no-project\\session-1')
  })

  it('resolves relative artifacts against the session root', () => {
    expect(
      resolvePathAgainstWorkspaceRoot('./output/report.md', '/data/no-project/session-1'),
    ).toBe('/data/no-project/session-1/output/report.md')
    expect(
      resolvePathAgainstWorkspaceRoot('D:\\output\\report.md', '/data/no-project/session-1'),
    ).toBe('D:\\output\\report.md')
  })
})
