import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { defaultConfig, normalizeConfig, runtimeDependencyPath } from '../config.mjs'

test('fills defaults and preserves supported custom values', () => {
  assert.deepEqual(normalizeConfig({}), defaultConfig)
  assert.deepEqual(normalizeConfig({
    window: { minWidth: 700, width: 1200, transparent: true, backgroundColor: '#11223344' },
    behavior: { closeToTray: false },
    shortcuts: { toggleWindow: null },
    appearance: { customCss: 'custom.css' },
    backend: { port: 4321, workspace: 'D:\\work' },
  }), {
    ...defaultConfig,
    window: { ...defaultConfig.window, minWidth: 700, width: 1200, transparent: true, backgroundColor: '#11223344' },
    behavior: { ...defaultConfig.behavior, closeToTray: false },
    shortcuts: { ...defaultConfig.shortcuts, toggleWindow: null },
    appearance: { customCss: 'custom.css' },
    backend: { port: 4321, workspace: 'D:\\work' },
  })
})

test('rejects invalid values with their config path', () => {
  assert.throws(() => normalizeConfig({ backend: { port: 70_000 } }), /backend\.port/)
  assert.throws(() => normalizeConfig({ window: { width: 800 } }), /window\.width/)
  assert.throws(() => normalizeConfig({ shortcuts: { reload: 42 } }), /shortcuts\.reload/)
  assert.throws(() => normalizeConfig({ window: { backgroundColor: 'black' } }), /window\.backgroundColor/)
})

test('resolves dependencies from the packaged runtime', () => {
  assert.equal(
    runtimeDependencyPath(join('app', 'resources'), '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join('app', 'resources', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  )
})
