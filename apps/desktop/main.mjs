/** Electron host for the existing dsh Web product. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, shell, Tray } from 'electron'
import { loadConfig, runtimeDependencyPath } from './config.mjs'
import { allowsRendererPermission } from './permissions.mjs'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const configPath = join(app.getPath('userData'), 'desktop-config.json')
const titleBarHeight = 36
let config
let backend
let mainWindow
let tray
let quitting = false

function appIcon() {
  return nativeImage.createFromBuffer(readFileSync(new URL('./assets/icon.png', import.meta.url)))
}

function dshBin() {
  return runtimeDependencyPath(process.resourcesPath, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

function nodeBin() {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node'
  if (app.isPackaged) return runtimeDependencyPath(process.resourcesPath, 'node', 'bin', executable)
  return join(sourceRoot, 'apps', 'desktop', 'runtime-package', 'node_modules', 'node', 'bin', executable)
}

function backendArgs() {
  if (app.isPackaged) return [dshBin()]
  return [
    '--import',
    pathToFileURL(require.resolve('tsx/esm')).href,
    join(sourceRoot, 'apps', 'cli', 'src', 'bin.ts'),
  ]
}

function startBackend() {
  return new Promise((resolveReady, rejectReady) => {
    const errors = []
    const workspace = config.backend.workspace === '' ? app.getPath('documents') : resolve(config.backend.workspace)
    backend = spawn(nodeBin(), [...backendArgs(), 'web', '--port', String(config.backend.port)], {
      cwd: workspace,
      env: {
        ...process.env,
        ...app.isPackaged ? {} : { TSX_TSCONFIG_PATH: join(sourceRoot, 'tsconfig.base.json') },
      },
      shell: false,
      windowsHide: true,
    })

    let settled = false
    let output = ''
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      backend.kill()
      rejectReady(new Error(`The Harness backend did not become ready within 45 seconds.\n${errors.join('')}`))
    }, 45_000)

    backend.stdout.setEncoding('utf8')
    backend.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match === null || settled) return
      settled = true
      clearTimeout(timeout)
      resolveReady(match[1])
    })
    backend.stderr.setEncoding('utf8')
    backend.stderr.on('data', chunk => errors.push(chunk))
    backend.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectReady(error)
    })
    backend.on('exit', (code, signal) => {
      if (settled) {
        if (!quitting) void dialog.showErrorBox('DeepSeek Harness stopped', `Backend exited with ${signal ?? `code ${String(code)}`}.`)
        return
      }
      settled = true
      clearTimeout(timeout)
      rejectReady(new Error(`Harness backend exited with ${signal ?? `code ${String(code)}`}.\n${errors.join('')}`))
    })
  })
}

function customCssPath() {
  if (config.appearance.customCss === '') return undefined
  return isAbsolute(config.appearance.customCss)
    ? config.appearance.customCss
    : resolve(dirname(configPath), config.appearance.customCss)
}

async function injectCustomCss() {
  if (mainWindow === undefined) return
  if (config.window.frame) {
    await mainWindow.webContents.insertCSS(readFileSync(new URL('./assets/desktop-titlebar.css', import.meta.url), 'utf8'))
  }
  const path = customCssPath()
  if (path !== undefined) await mainWindow.webContents.insertCSS(readFileSync(path, 'utf8'))
}

function toggleWindow() {
  if (mainWindow === undefined) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function restart() {
  quitting = true
  app.relaunch()
  app.quit()
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '应用',
      submenu: [
        { label: '显示/隐藏窗口', click: toggleWindow },
        { label: '打开桌面配置所在文件夹', click: () => shell.showItemInFolder(configPath) },
        { label: '重新加载桌面配置', click: restart },
        { type: 'separator' },
        { label: '退出', click: () => { quitting = true; app.quit() } },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ]))
}

function installTray(icon) {
  if (!config.behavior.closeToTray) return
  tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('DeepSeek Harness Desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleWindow },
    { label: '重新加载配置', click: restart },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', toggleWindow)
}

function registerShortcut(accelerator, action, name) {
  if (accelerator === null) return
  if (!globalShortcut.register(accelerator, action)) {
    throw new Error(`Cannot register ${name} shortcut ${JSON.stringify(accelerator)}`)
  }
}

async function createWindow(url) {
  const icon = appIcon()
  mainWindow = new BrowserWindow({
    ...config.window,
    icon,
    show: false,
    title: 'DeepSeek Harness',
    ...config.window.frame && {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#111827',
        height: titleBarHeight,
      },
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const origin = new URL(url).origin
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === origin) return
    event.preventDefault()
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
  })
  mainWindow.webContents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => (
    allowsRendererPermission(origin, requestingOrigin, permission, details.isMainFrame)
  ))
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      contents === mainWindow.webContents
      && allowsRendererPermission(origin, details.requestingUrl, permission, details.isMainFrame),
    )
  })
  mainWindow.on('close', (event) => {
    if (quitting || !config.behavior.closeToTray) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.once('ready-to-show', () => {
    if (!config.behavior.startMinimized) mainWindow.show()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    void injectCustomCss().catch(error => dialog.showErrorBox('Custom CSS failed', error.message))
  })

  installMenu()
  installTray(icon)
  registerShortcut(config.shortcuts.toggleWindow, toggleWindow, 'toggleWindow')
  registerShortcut(config.shortcuts.reload, () => mainWindow?.reload(), 'reload')
  await mainWindow.loadURL(url)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    backend?.kill()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !config?.behavior.closeToTray) app.quit()
  })
  app.on('activate', () => mainWindow?.show())

  // Electron emits ready after the ESM entry finishes evaluating. Chaining the
  // promise lets module evaluation finish; a top-level await here deadlocks.
  void app.whenReady().then(async () => {
    try {
      config = loadConfig(configPath)
      await createWindow(await startBackend())
    } catch (error) {
      dialog.showErrorBox('DeepSeek Harness Desktop failed to start', error instanceof Error ? error.message : String(error))
      quitting = true
      app.quit()
    }
  })
}
