/** Staging helpers for the Electron application archive. */
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Copy the desktop manifest's distributable files and write the minimal
 * packaged manifest consumed by Electron.
 * @param {string} source - Desktop application source directory.
 * @param {string} target - Empty or replaceable staging directory.
 * @param {{ name: string, productName: string, version: string, license: string, files: string[] }} manifest - Desktop package manifest.
 * @returns {Promise<void>} Completion after every archive input is written.
 */
export async function stageElectronPackage(source, target, manifest) {
  const packagedManifest = {
    name: manifest.name,
    productName: manifest.productName,
    version: manifest.version,
    private: true,
    type: 'module',
    main: 'main.mjs',
    license: manifest.license,
  }
  await mkdir(target, { recursive: true })
  await Promise.all([
    ...manifest.files.map(path => cp(join(source, path), join(target, path), { recursive: true })),
    writeFile(join(target, 'package.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`),
  ])
}
