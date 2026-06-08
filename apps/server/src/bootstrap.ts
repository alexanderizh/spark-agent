import 'reflect-metadata'
import 'dotenv/config'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { Bootstrap } from '@midwayjs/bootstrap'

const __dirname = join(fileURLToPath(import.meta.url), '..')

Bootstrap.configure({
  baseDir: __dirname,
}).run()
