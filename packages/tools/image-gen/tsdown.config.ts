import { defineConfig } from 'tsdown'

/**
 * Bundles the published lib artifacts. The host runtime ships as checked-in
 * upstream JavaScript under src/ (tsc's allowJs copies carry it into
 * lib/types) and the browser classic script bundles directly from
 * src/client.js; this config emits lib/index.js, lib/invariant.js, and
 * lib/client.js.
 */
export default defineConfig(() => ({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    client: 'src/client.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
