import { describe, expect, it } from 'vitest'
import { AuthService } from './AuthService'

describe('AuthService base URL configuration', () => {
  it('rejects runtime cloud auth base URL changes', () => {
    const auth = new AuthService({
      defaultBaseUrl: 'https://default.example/',
      keytarService: 'SparkAgent.CloudAuth',
    })

    expect(() => auth.setBaseUrl('https://cloud.example/')).toThrow('暂不支持修改')
  })
})
