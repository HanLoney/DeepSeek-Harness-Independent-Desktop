/** Stage a symlink-free production runtime for Electron's extraResources. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = join(import.meta.dirname, 'runtime-package')
const staging = join(import.meta.dirname, 'runtime')
const packageStaging = join(import.meta.dirname, 'package')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

if (staging === root || root.startsWith(staging + sep)) {
  throw new Error(`prepare-runtime: refusing to clear ${staging}: it contains the repository root.`)
}

await run(pnpm, [
  'exec',
  'tsx',
  'scripts/verify-runtime-closure.ts',
  '--manifest',
  'apps/desktop/runtime-package/package.json',
])
await rm(staging, { recursive: true, force: true })
await rm(packageStaging, { recursive: true, force: true })
await run(pnpm, [
  '--filter',
  'dsh-desktop-runtime',
  'deploy',
  '--legacy',
  '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.confirmModulesPurge=false',
  '--config.link-workspace-packages=true',
  staging,
])
await restoreDirectDependencies()
await materializeLinks(join(staging, 'node_modules'))

const required = [
  join(staging, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(staging, 'node_modules', '@deepseek-ai', 'cordis-plugin-group', 'package.json'),
  join(staging, 'node_modules', '@deepseek-ai', 'dsh-scope', 'package.json'),
  join(staging, 'node_modules', '@deepseek-ai', 'dsh-timeout', 'package.json'),
  join(staging, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
]
const missing = required.filter(path => !existsSync(path))
if (missing.length > 0) throw new Error(`prepare-runtime: staged files are missing:\n${missing.join('\n')}`)
// Legacy deploy installs the filtered source in production mode. Restore the
// shared workspace so repeated local desktop builds keep their dev tools.
await run(pnpm, ['install', '--frozen-lockfile', '--config.confirmModulesPurge=false'])
await stageElectronPackage()
console.log(`prepare-runtime: staged packaged runtime in ${staging}`)

async function stageElectronPackage() {
  const manifest = JSON.parse(await readFile(join(import.meta.dirname, 'package.json'), 'utf8'))
  const packagedManifest = {
    name: manifest.name,
    productName: manifest.productName,
    version: manifest.version,
    private: true,
    type: 'module',
    main: 'main.mjs',
    license: manifest.license,
  }
  await mkdir(packageStaging, { recursive: true })
  await Promise.all([
    cp(join(import.meta.dirname, 'assets'), join(packageStaging, 'assets'), { recursive: true }),
    copyFile(join(import.meta.dirname, 'config.mjs'), join(packageStaging, 'config.mjs')),
    copyFile(join(import.meta.dirname, 'main.mjs'), join(packageStaging, 'main.mjs')),
    writeFile(join(packageStaging, 'package.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`),
  ])
}

async function restoreDirectDependencies() {
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort()
  for (const dependency of dependencies) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    await rm(destination, { recursive: true, force: true })
    const dependencySource = join(source, 'node_modules', dependency)
    if (!existsSync(dependencySource)) {
      throw new Error(`prepare-runtime: direct dependency ${dependency} is absent from the deploy and source trees.`)
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(dependencySource, 'node_modules')
    await cp(dependencySource, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

async function materializeLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      if (entry.name === '.bin') {
        await rm(path, { recursive: true, force: true })
        continue
      }
      const target = await realpath(path)
      await rm(path, { recursive: true, force: true })
      await cp(target, path, { recursive: true, dereference: true })
      continue
    }
    if (metadata.isDirectory()) await materializeLinks(path)
  }
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, CI: 'true' },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`prepare-runtime: ${command} failed with ${signal ?? `code ${String(code)}`}.`))
    })
  })
}
