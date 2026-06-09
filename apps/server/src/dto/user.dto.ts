import { Rule, RuleType } from '@midwayjs/validate'

export class UpdateProfileDTO {
  @Rule(RuleType.string().max(100).optional())
  nickname?: string

  @Rule(RuleType.string().max(500).optional())
  avatarUrl?: string
}

export class ChangePasswordDTO {
  @Rule(RuleType.string().required())
  oldPassword: string

  @Rule(RuleType.string().min(8).max(128).required())
  newPassword: string
}
