const { join } = require('path')
const { config } = require('dotenv')

const env = process.env.NODE_ENV || 'development'
const envFile = env === 'production' ? '.env.production' : '.env'
config({ path: join(__dirname, envFile) })

const { Bootstrap } = require('@midwayjs/bootstrap')
Bootstrap.configure({
  baseDir: join(__dirname, 'dist'),
}).run()
