import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { stageElectronPackage } from '../package-staging.mjs'

test('stages every distributable desktop file for app.asar', async () => {
  const source = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const target = await mkdtemp(join(tmpdir(), 'dsh-desktop-package-'))
  try {
    await stageElectronPackage(source, target, manifest)
    assert.deepEqual((await readdir(target)).sort(), [
      'assets',
      'config.mjs',
      'main.mjs',
      'package.json',
      'permissions.mjs',
    ])
    const packagedManifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    assert.equal(packagedManifest.version, manifest.version)
    assert.equal(packagedManifest.main, 'main.mjs')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
