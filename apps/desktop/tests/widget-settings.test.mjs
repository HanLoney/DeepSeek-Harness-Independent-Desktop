import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { install, uninstall } from '../widget/install.mjs'
import { registerShortcut } from '../widget/shortcut-registration.mjs'
import { resolveDshHome } from '../widget/home.mjs'

const pluginRoot = fileURLToPath(new URL('../widget/plugin/', import.meta.url))

/** The comment header the shipped profile template carries above its empty list. */
const TEMPLATE_HEAD = '# Patch layer for this dsh profile, applied after every bundle layer.\n'

/**
 * Build a throwaway harness home holding one profile's patch file.
 * @param {string} patchText - the patch file contents to start from.
 * @returns {{home: string, patchPath: string, cleanup: () => void}} the fixture.
 */
function fixture(patchText) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-widget-settings-'))
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  const patchPath = join(profile, 'cordis.patch.yml')
  writeFileSync(patchPath, patchText)
  return { home, patchPath, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('installs the plugin package and its loader row', () => {
  const f = fixture(TEMPLATE_HEAD + '[]\n')
  try {
    const result = install({ dshHome: f.home, pluginRoot })
    assert.equal(result.installed, true)

    // The package must land where the loader resolves bare names from; a row
    // naming a package that is not there fails the whole plugin tree at boot.
    const installed = join(f.home, 'profiles', 'web', 'node_modules', 'dsh-plugin-desktop-widget')
    for (const file of ['package.json', 'index.js', 'client.js']) {
      assert.ok(existsSync(join(installed, file)), file + ' is installed')
    }

    const patch = readFileSync(f.patchPath, 'utf8')
    assert.match(patch, /- insert:/)
    assert.match(patch, /name: 'dsh-plugin-desktop-widget'/)
    // The loader validates the row's config against the plugin schema, so an
    // absent one fails the boot rather than defaulting.
    assert.match(patch, /config: \{\}/)
  } finally {
    f.cleanup()
  }
})

test('replaces the empty document instead of adding a second one', () => {
  // The template's `[]` is the whole patch list. Appending a row below it
  // yields two YAML documents and the loader refuses the file outright.
  const f = fixture(TEMPLATE_HEAD + '[]\n')
  try {
    install({ dshHome: f.home, pluginRoot })
    const patch = readFileSync(f.patchPath, 'utf8')
    assert.ok(!/^\[\]$/m.test(patch), 'the empty document is gone')
    assert.equal(patch.match(/^- insert:/gm)?.length, 1)
  } finally {
    f.cleanup()
  }
})

test('is idempotent, so a relaunch does not churn the patch file', () => {
  const f = fixture(TEMPLATE_HEAD + '[]\n')
  try {
    install({ dshHome: f.home, pluginRoot })
    const first = readFileSync(f.patchPath, 'utf8')
    const again = install({ dshHome: f.home, pluginRoot })
    // A rewrite would change the bundle's content hash and make every launch
    // reload the panel, so the second run reports no change and writes nothing.
    assert.equal(again.installed, false)
    assert.equal(readFileSync(f.patchPath, 'utf8'), first)
  } finally {
    f.cleanup()
  }
})

test('uninstall restores the profile byte for byte', () => {
  const template = TEMPLATE_HEAD + '# a second template comment\n[]\n'
  const f = fixture(template)
  try {
    install({ dshHome: f.home, pluginRoot })
    const removed = uninstall({ dshHome: f.home })
    assert.equal(removed.removed, true)
    // Everything install added is gone, including the package: the widget must
    // survive as a feature the profile knows nothing about.
    assert.equal(readFileSync(f.patchPath, 'utf8'), template)
    assert.ok(!existsSync(join(f.home, 'profiles', 'web', 'node_modules', 'dsh-plugin-desktop-widget')))
  } finally {
    f.cleanup()
  }
})

test('leaves a hand-written patch entry alone', () => {
  const f = fixture(TEMPLATE_HEAD + '[]\n- insert:\n    - id: mine\n      name: \'my-plugin\'\n')
  try {
    install({ dshHome: f.home, pluginRoot })
    const patch = readFileSync(f.patchPath, 'utf8')
    // The user's own row is not this module's to touch, and the empty document
    // stays because it is no longer the only entry.
    assert.match(patch, /name: 'my-plugin'/, "the user's row survives")
    assert.match(patch, /^- insert:/m)
  } finally {
    f.cleanup()
  }
})

test('never writes into the harness-owned module fallback', () => {
  // `profiles/node_modules` is the harness's flat fallback: one symlink per
  // package in the installation's dependency closure, healed on every boot, and
  // its heal step throws on a real directory at one of those names. The plugin
  // is not in that closure, so landing there is only accidentally safe — and it
  // would still shadow the fallback for any package that later claims the name.
  const f = fixture(TEMPLATE_HEAD + '[]\n')
  try {
    install({ dshHome: f.home, pluginRoot })
    assert.ok(!existsSync(join(f.home, 'profiles', 'node_modules', 'dsh-plugin-desktop-widget')))
    assert.ok(existsSync(join(f.home, 'profiles', 'web', 'node_modules', 'dsh-plugin-desktop-widget')))
  } finally {
    f.cleanup()
  }
})

test('seeds an uninitialized profile with the harness template', () => {
  // The harness writes its patch template only when the file is absent, so
  // creating one here first would permanently deny the profile that header.
  // The seed must reproduce the template byte for byte to avoid that.
  const home = mkdtempSync(join(tmpdir(), 'dsh-widget-settings-'))
  try {
    install({ dshHome: home, pluginRoot })
    const patchPath = join(home, 'profiles', 'web', 'cordis.patch.yml')
    const patch = readFileSync(patchPath, 'utf8')
    assert.match(patch, /^# Your patch layer for this dsh profile/)
    assert.match(patch, /a top-level YAML array of loader patch entries/)
    // The template's own `[]` is the whole patch list, so the row replaces it
    // rather than joining it — two YAML documents would fail the whole boot.
    assert.ok(!/^\[\]$/m.test(patch), 'the empty document is gone')
    assert.match(patch, /\n- insert:\n/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('registers shortcuts without making startup fatal on conflicts', () => {
  const warnings = []
  const registry = { register: () => true }
  assert.equal(registerShortcut(registry, 'Ctrl+1', () => {}, 'toggleWindow', message => warnings.push(message)), true)
  assert.deepEqual(warnings, [])

  const conflict = { register: () => false }
  assert.equal(registerShortcut(conflict, 'Ctrl+2', () => {}, 'reload', message => warnings.push(message)), false)
  assert.match(warnings[0], /reload shortcut/)
  assert.match(warnings[0], /may already be in use/)

  assert.equal(registerShortcut(conflict, null, () => {}, 'disabled', message => warnings.push(message)), true)
  assert.equal(warnings.length, 1)
})
test('keeps the seeded template identical to the harness source of record', async () => {
  // A drifted copy silently changes what a first-run profile contains, and the
  // harness never rewrites the file, so nothing else would notice.
  const installer = readFileSync(fileURLToPath(new URL('../widget/install.mjs', import.meta.url)), 'utf8')
  const boot = readFileSync(fileURLToPath(new URL('../../../packages/boot/app-boot/src/profile.ts', import.meta.url)), 'utf8')
  // The source of record is a TS template literal, so its escaped backticks
  // are the literal character here.
  const source = boot.match(/const PROFILE_PATCH_TEMPLATE = `([\s\S]*?)`\n/)[1].replaceAll('\\`', '`')
  const lines = source.split('\n').filter(line => line !== '')
  assert.ok(lines.length > 0, 'the source template was located')
  for (const line of lines) {
    assert.ok(installer.includes(line), 'seeded template is missing: ' + line)
  }
})

test('registers the client bundle under the package name', () => {
  // The client-modules scanner loads `/plugins/<package>/client.js` and fails
  // the whole boot when the bundle registers itself under any other id, so the
  // id in the module-loader call is the package name, not the entry id.
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  const client = readFileSync(join(pluginRoot, 'client.js'), 'utf8')
  assert.equal(manifest.name, 'dsh-plugin-desktop-widget')
  assert.equal(manifest.dsh.client.platform, 'web')
  // The bundle is served from the package's `./client` export.
  assert.equal(manifest.exports['./client'].default, './client.js')
  assert.match(client, /__ModuleLoader__\.load\(\{\s*id: 'dsh-plugin-desktop-widget'/)
})

test('resolves the harness home the way the spawned backend does', () => {
  // DSH_HOME is what the desktop host passes to its backend child, so reading a
  // different directory here would wire a profile nothing ever loads.
  assert.equal(resolveDshHome({ DSH_HOME: 'C:\\harness-home' }), 'C:\\harness-home')
  // An empty or blank value falls back to the default rather than resolving to
  // the current directory.
  assert.match(resolveDshHome({ DSH_HOME: '   ' }), /\.dsh$/)
  assert.match(resolveDshHome({}), /\.dsh$/)
})
