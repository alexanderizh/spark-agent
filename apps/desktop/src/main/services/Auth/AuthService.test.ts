import { describe, expect, it } from 'vitest'
import { AuthService } from './AuthService'

describe('AuthService base URL persistence', () => {
  it('notifies the host after the cloud auth base URL changes', () => {
    const changes: string[] = []
    const auth = new AuthService({
      defaultBaseUrl: 'https://default.example/',
      keytarService: 'SparkAgent.CloudAuth',
      onBaseUrlChanged: (url: string) => changes.push(url),
    })

    const result = auth.setBaseUrl('https://cloud.example/')

    expect(result).toEqual({ baseUrl: 'https://cloud.example' })
    expect(changes).toEqual(['https://cloud.example'])
  })
})
