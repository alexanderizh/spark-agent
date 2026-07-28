import { describe, expect, it } from 'vitest'
import { resolveStandaloneNodeRuntimePath } from '../StandaloneNodeRuntime.js'

describe('resolveStandaloneNodeRuntimePath', () => {
  it('uses the separately packaged Node executable in production', () => {
    expect(
      resolveStandaloneNodeRuntimePath({
        packaged: true,
        resourcesPath: '/Applications/SparkWork.app/Contents/Resources',
        platform: 'darwin',
        env: {},
        processExecutable: '/Applications/SparkWork.app/Contents/MacOS/SparkWork',
        exists: (candidate) => candidate.endsWith('/runtime/node/node'),
      }),
    ).toBe('/Applications/SparkWork.app/Contents/Resources/runtime/node/node')
  })

  it('fails closed instead of treating the Electron executable as Node', () => {
    expect(() =>
      resolveStandaloneNodeRuntimePath({
        packaged: true,
        resourcesPath: 'C:\\Program Files\\SparkWork\\resources',
        platform: 'win32',
        env: { SPARK_STANDALONE_NODE: 'C:\\Program Files\\SparkWork\\SparkWork.exe' },
        processExecutable: 'C:\\Program Files\\SparkWork\\SparkWork.exe',
        exists: (candidate) => candidate.endsWith('SparkWork.exe'),
      }),
    ).toThrow('standalone Node runtime')
  })

  it('ignores environment overrides in packaged builds', () => {
    expect(
      resolveStandaloneNodeRuntimePath({
        packaged: true,
        resourcesPath: 'C:\\Program Files\\SparkWork\\resources',
        platform: 'win32',
        env: { SPARK_STANDALONE_NODE: 'C:\\Users\\attacker\\node.exe' },
        processExecutable: 'C:\\Program Files\\SparkWork\\SparkWork.exe',
        exists: () => true,
      }),
    ).toBe('C:\\Program Files\\SparkWork\\resources\\runtime\\node\\node.exe')
  })

})
