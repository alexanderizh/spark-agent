import 'dotenv/config'
import { DataSource } from 'typeorm'
import { UserEntity } from './entity/user.entity'
import { CloudAgentEntity } from './entity/cloud-agent.entity'
import { CloudWorkflowEntity } from './entity/cloud-workflow.entity'
import { CloudAppSettingEntity } from './entity/cloud-app-setting.entity'
import { SyncRecordEntity } from './entity/sync-record.entity'

export default new DataSource({
  type: 'postgres',
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  username: process.env.PG_USER || 'spark',
  password: process.env.PG_PASSWORD || 'spark_dev',
  database: process.env.PG_DATABASE || 'spark_agent',
  synchronize: false,
  entities: [
    UserEntity,
    CloudAgentEntity,
    CloudWorkflowEntity,
    CloudAppSettingEntity,
    SyncRecordEntity,
  ],
  migrations: ['migrations/*.ts'],
})
