import { describe, expect, it } from 'vitest'
import { providerFilesErrorMessage } from './providerFiles.utils'

describe('ProviderFilesPanel errors', () => {
  it('maps provider status failures to actionable messages', () => {
    expect(providerFilesErrorMessage(new Error('xAI Files HTTP 401'))).toContain('API Key')
    expect(providerFilesErrorMessage(new Error('xAI Files HTTP 403'))).toContain('权限')
    expect(providerFilesErrorMessage(new Error('xAI Files HTTP 429'))).toContain('稍后重试')
    expect(providerFilesErrorMessage(new Error('network offline'))).toContain('network offline')
  })
})
