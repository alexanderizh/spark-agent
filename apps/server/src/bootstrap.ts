import 'dotenv/config'
import { Bootstrap } from '@midwayjs/bootstrap'
import { MainConfiguration as Configuration } from './configuration'

Bootstrap.configure({
  imports: [Configuration],
}).run()
