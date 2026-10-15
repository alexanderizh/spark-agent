import { readFileSync, writeFileSync } from 'node:fs'

const config = JSON.parse(readFileSync('config.json', 'utf8'))
config.retries = 3
writeFileSync('config.json', `${JSON.stringify(config, null, 2)}\n`)
