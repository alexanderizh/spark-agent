import 'dotenv/config'
import { join } from 'path'
import { Bootstrap } from '@midwayjs/bootstrap'
import { MainConfiguration } from './configuration'

const srcDir = join(import.meta.dirname || __dirname)

Bootstrap.configure({
  baseDir: srcDir,
  imports: [MainConfiguration],
}).run()
