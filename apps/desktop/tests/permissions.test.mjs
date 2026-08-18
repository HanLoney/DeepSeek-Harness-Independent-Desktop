import assert from 'node:assert/strict'
import test from 'node:test'
import { allowsRendererPermission } from '../permissions.mjs'

const appOrigin = 'http://127.0.0.1:4321'

test('allows sanitized clipboard writes from the application main frame', () => {
  assert.equal(allowsRendererPermission(
    appOrigin,
    'http://127.0.0.1:4321/session/one',
    'clipboard-sanitized-write',
    true,
  ), true)
})

test('rejects clipboard writes from another origin or a subframe', () => {
  assert.equal(allowsRendererPermission(
    appOrigin,
    'http://127.0.0.1:4322',
    'clipboard-sanitized-write',
    true,
  ), false)
  assert.equal(allowsRendererPermission(
    appOrigin,
    appOrigin,
    'clipboard-sanitized-write',
    false,
  ), false)
})

test('rejects all other permissions and malformed request URLs', () => {
  assert.equal(allowsRendererPermission(appOrigin, appOrigin, 'clipboard-read', true), false)
  assert.equal(allowsRendererPermission(appOrigin, 'not a URL', 'clipboard-sanitized-write', true), false)
})
