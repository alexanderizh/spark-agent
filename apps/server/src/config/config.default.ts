import { join } from 'path'
import { UserEntity } from '../entity/user.entity'
import { CloudAgentEntity } from '../entity/cloud-agent.entity'
import { CloudWorkflowEntity } from '../entity/cloud-workflow.entity'
import { CloudAppSettingEntity } from '../entity/cloud-app-setting.entity'
import { SyncRecordEntity } from '../entity/sync-record.entity'

export default {
  keys: 'spark-agent-server-keys-change-in-production',

  koa: {
    port: 7001,
    globalPrefix: '/api',
  },

  typeorm: {
    dataSource: {
      default: {
        type: 'postgres',
        host: process.env.PG_HOST || 'localhost',
        port: Number(process.env.PG_PORT) || 5432,
        username: process.env.PG_USER || 'spark',
        password: process.env.PG_PASSWORD || 'spark_dev',
        database: process.env.PG_DATABASE || 'spark_agent',
        synchronize: false,
        logging: process.env.NODE_ENV !== 'production',
        entities: [
          UserEntity,
          CloudAgentEntity,
          CloudWorkflowEntity,
          CloudAppSettingEntity,
          SyncRecordEntity,
        ],
      },
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'spark-dev-jwt-secret-change-in-production',
    expiresIn: '15m',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: 0,
  },

  auth: {
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    smsCodeExpiry: 300, // 5 minutes
    smsCodePrefix: 'sms:code:',
    refreshTokenPrefix: 'auth:refresh:',
    tokenBlacklistPrefix: 'auth:blacklist:',
  },

  oauth: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:7001/api/auth/oauth/github/callback',
    },
    wechat: {
      appId: process.env.WECHAT_APP_ID || '',
      appSecret: process.env.WECHAT_APP_SECRET || '',
      callbackUrl: process.env.WECHAT_CALLBACK_URL || 'http://localhost:7001/api/auth/oauth/wechat/callback',
    },
  },
}
