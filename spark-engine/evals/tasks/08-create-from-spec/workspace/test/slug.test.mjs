import assert from 'node:assert/strict'
import test from 'node:test'
import { slugify } from '../src/slug.js'

test('builds a url slug', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('  A--B  '), 'a-b')
  assert.equal(slugify('---'), '')
  assert.equal(slugify('Café au lait'), 'caf-au-lait')
})
