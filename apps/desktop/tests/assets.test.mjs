import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('ships PNG and multi-size Windows icon assets', async () => {
  const [png, ico] = await Promise.all([
    readFile(new URL('../assets/icon.png', import.meta.url)),
    readFile(new URL('../assets/icon.ico', import.meta.url)),
  ])
  assert.deepEqual(png.subarray(0, pngSignature.length), pngSignature)
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 9)
  for (let index = 0; index < 9; index += 1) {
    const entry = 6 + index * 16
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    assert.deepEqual(ico.subarray(offset, offset + pngSignature.length), pngSignature)
    assert.ok(offset + length <= ico.length)
  }
})

test('ships a transparent draggable desktop title bar', async () => {
  const css = await readFile(new URL('../assets/desktop-titlebar.css', import.meta.url), 'utf8')
  assert.match(css, /-webkit-app-region:\s*drag/)
  assert.match(css, /#root/)
  assert.match(css, /\[data-slot='conversation\.session\.header'\]\s*>\s*header/)
  assert.match(css, /padding-top:\s*calc\(12px \+ var\(--dsh-desktop-titlebar-height\)\)/)
  assert.doesNotMatch(css, /backdrop-filter|background\s*:/)
})
