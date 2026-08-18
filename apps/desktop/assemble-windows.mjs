/** Assemble the prepackaged Windows directory consumed by the NSIS builder. */
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createPackage } from '@electron/asar'
import { editWindowsResources } from 'app-builder-lib/out/util/resEdit.js'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(await readFile(join(import.meta.dirname, 'package.json'), 'utf8'))
const electronDist = join(dirname(require.resolve('electron/package.json')), 'dist')
const target = join(import.meta.dirname, 'release', 'win-unpacked')
const resources = join(target, 'resources')
const executable = join(target, `${manifest.productName}.exe`)
const numericVersion = `${manifest.version.split('-')[0]}.0`

await rm(target, { recursive: true, force: true })
await cp(electronDist, target, { recursive: true })
await rename(join(target, 'electron.exe'), executable)
await editWindowsResources({
  file: executable,
  versionStrings: {
    FileDescription: manifest.productName,
    ProductName: manifest.productName,
    InternalName: manifest.productName,
    OriginalFilename: `${manifest.productName}.exe`,
  },
  fileVersion: numericVersion,
  productVersion: numericVersion,
  iconPath: join(import.meta.dirname, 'assets', 'icon.ico'),
})
await rm(join(resources, 'default_app.asar'), { force: true })
await mkdir(resources, { recursive: true })
await Promise.all([
  createPackage(join(import.meta.dirname, 'package'), join(resources, 'app.asar')),
  cp(join(import.meta.dirname, 'runtime'), join(resources, 'runtime'), { recursive: true }),
])
console.log(`assemble-windows: assembled ${target}`)
