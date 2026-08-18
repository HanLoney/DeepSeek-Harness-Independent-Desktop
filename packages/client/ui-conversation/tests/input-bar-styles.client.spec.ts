/** Composer style contracts controlled by the global theme presenter. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url)), 'utf8')

describe('InputBar.module.css', () => {
  it('lets the card fill follow a custom background', () => {
    expect(css).toMatch(
      /\.card\s*\{[^}]*background:\s*var\(--dsh-custom-background-composer-fill,\s*var\(--dsw-specific-input-major\)\)/s,
    )
  })
})
