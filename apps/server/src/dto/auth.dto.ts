import { Rule, RuleType } from '@midwayjs/validate'

export class RegisterDTO {
  @Rule(RuleType.string().email().required())
  email: string

  @Rule(RuleType.string().min(8).max(128).required())
  password: string

  @Rule(RuleType.string().max(100).optional())
  nickname?: string
}

export class LoginDTO {
  @Rule(RuleType.string().required())
  account: string

  @Rule(RuleType.string().required())
  password: string

  @Rule(RuleType.string().valid('email', 'phone').default('email'))
  type: string
}

export class SendSmsDTO {
  @Rule(RuleType.string().pattern(/^1[3-9]\d{9}$/).required())
  phone: string
}

export class PhoneLoginDTO {
  @Rule(RuleType.string().pattern(/^1[3-9]\d{9}$/).required())
  phone: string

  @Rule(RuleType.string().length(6).required())
  code: string
}

export class RefreshTokenDTO {
  @Rule(RuleType.string().required())
  refreshToken: string
}
