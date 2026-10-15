import { loadRetries } from './load-config.js'

const retries = loadRetries()
process.stdout.write(`ready:${retries}\n`)
