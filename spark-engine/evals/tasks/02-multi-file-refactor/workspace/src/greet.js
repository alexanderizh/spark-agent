import { formatName } from './format-name.js'

export function greet(user) {
  return `Hello, ${formatName(user)}`
}
