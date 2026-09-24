/** Electron host for the existing dsh Web product. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, shell, Tray } from 'electron'
import { loadConfig, runtimeDependencyPath } from './config.mjs'
import { allowsRendererPermission } from './permissions.mjs'
import { install as installWidgetPlugin } from './widget/install.mjs'
import { resolveDshHome } from './widget/home.mjs'
import { startWidget } from './widget/window.mjs'
import { registerShortcut } from './widget/shortcut-registration.mjs'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const configPath = join(app.getPath('userData'), 'desktop-config.json')
const titleBarHeight = 36
let config
let backend
let mainWindow
let tray
let widget
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

async function availablePort(requested) {
  if (requested !== 0) return requested
  return await new Promise((resolvePort, rejectPort) => {
    const probe = createServer()
    probe.once('error', rejectPort)
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => rejectPort(new Error('Could not allocate a local backend port')))
        return
      }
      const port = address.port
      probe.close(error => error === undefined ? resolvePort(port) : rejectPort(error))
    })
  })
}

async function startBackend() {
  const port = await availablePort(config.backend.port)
  return await new Promise((resolveReady, rejectReady) => {
    const errors = []
    const workspace = config.backend.workspace === '' ? app.getPath('documents') : resolve(config.backend.workspace)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.ELECTRON_NO_ATTACH_CONSOLE
    backend = spawn(nodeBin(), [...backendArgs(), 'web', '--port', String(port)], {
      cwd: workspace,
      env: {
        ...environment,
        ...app.isPackaged ? {} : { TSX_TSCONFIG_PATH: join(sourceRoot, 'tsconfig.base.json') },
      },
      shell: false,
      windowsHide: true,
    })

    let settled = false
    let probeTimer
    let output = ''
    const finish = (url) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (probeTimer !== undefined) clearInterval(probeTimer)
      resolveReady(url)
    }
    const probe = () => {
      if (settled) return
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
        .then(response => {
          if (response.ok || response.status < 500) finish(`http://127.0.0.1:${port}`)
        })
        .catch(() => {})
    }
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      if (probeTimer !== undefined) clearInterval(probeTimer)
      backend.kill()
      rejectReady(new Error(`The Harness backend did not become ready within 45 seconds.\n${errors.join('')}`))
    }, 45_000)
    probeTimer = setInterval(probe, 250)

    backend.stdout.setEncoding('utf8')
    backend.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match !== null) finish(match[1])
    })
    backend.stderr.setEncoding('utf8')
    backend.stderr.on('data', chunk => errors.push(chunk))
    backend.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (probeTimer !== undefined) clearInterval(probeTimer)
      rejectReady(error)
    })
    backend.on('exit', (code, signal) => {
      if (settled) {
        if (!quitting) void dialog.showErrorBox('DeepSeek Harness stopped', `Backend exited with ${signal ?? `code ${String(code)}`}.`)
        return
      }
      settled = true
      clearTimeout(timeout)
      if (probeTimer !== undefined) clearInterval(probeTimer)
      rejectReady(new Error(`Harness backend exited with ${signal ?? `code ${String(code)}`}.\n${errors.join('')}`))
    })
  })
}

/**
 * The paths the widget needs, resolved from this module's own location.
 * @param {string} url - the backend's base URL.
 * @returns {object} the options {@link startWidget} takes.
 */
function widgetOptions(url) {
  return {
    userDataPath: app.getPath('userData'),
    backendUrl: url,
    assetsRoot: fileURLToPath(new URL('./widget', import.meta.url)),
    preloadPath: fileURLToPath(new URL('./widget/preload.cjs', import.meta.url)),
    iconPath: fileURLToPath(new URL('./assets/icon.png', import.meta.url)),
  }
}

/**
 * Read the widget's stored settings from the running backend.
 *
 * The endpoint belongs to the widget's own settings plugin, so this answers
 * `null` whenever the panel is not installed — a profile the user cannot
 * write, or a backend still starting. The caller falls back to the local
 * desktop config in that case, which is why the two are not merged here.
 * @param {string} url - the backend's base URL.
 * @returns {Promise<{enabled: boolean, muted: boolean} | null>} the stored settings, or null when unavailable.
 */
async function readWidgetSettings(url) {
  try {
    const response = await fetch(`${url}/desktop-widget/config`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return null
    const body = await response.json()
    if (body === null || typeof body !== 'object' || body.ok !== true) return null
    return { enabled: body.value.enabled !== false, muted: body.value.muted === true }
  } catch {
    // No answer means no stored settings to honor. The widget keeps whatever
    // state it has and the next poll tries again.
    return null
  }
}

/**
 * Follow the widget's settings panel and start, stop, or mute the widget to
 * match.
 *
 * Only a *change* in the stored value acts. A manual quit from the tray or the
 * right-click menu therefore stays quit — the panel still reads "shown", and
 * the tray's own entry is the way back — instead of being undone by the next
 * poll a few seconds later.
 * @param {string} url - the backend's base URL.
 * @param {{enabled: boolean, muted: boolean}} baseline - the state startup actually applied.
 */
function watchWidgetSettings(url, baseline) {
  let previous = baseline
  const timer = setInterval(() => {
    void (async () => {
      const value = await readWidgetSettings(url)
      if (value === null) return
      const seen = previous
      previous = value
      if (seen.enabled !== value.enabled) {
        if (value.enabled) {
          widget = await startWidget(widgetOptions(url))
          widget.setMuted(value.muted === true)
        } else {
          widget?.close()
          widget = undefined
        }
      } else if (seen.muted !== value.muted) {
        widget?.setMuted(value.muted === true)
      }
    })()
  }, 2000)
  timer.unref()
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
  registerShortcut(globalShortcut, config.shortcuts.toggleWindow, toggleWindow, 'toggleWindow')
  registerShortcut(globalShortcut, config.shortcuts.reload, () => mainWindow?.reload(), 'reload')
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
    widget?.close()
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
      // Before the backend, because the settings panel is a client plugin the
      // backend only sees while it is starting up. A profile the user cannot
      // write is not fatal: the widget still runs from its tray and right-click
      // menus, only the panel is missing.
      if (config.widget.enabled) {
        try {
          installWidgetPlugin({
            dshHome: resolveDshHome(),
            pluginRoot: fileURLToPath(new URL('./widget/plugin', import.meta.url)),
          })
        } catch (error) {
          console.warn('desktop: widget settings panel not installed —', error instanceof Error ? error.message : String(error))
        }
      }
      const url = await startBackend()
      await createWindow(url)
      // The desktop config is the composition default; the stored settings are
      // what the user last chose in the panel, and they win. The panel is only
      // reachable once the backend serves it, which is why this is read here
      // rather than at config-load time.
      const baseline = config.widget.enabled
        ? await readWidgetSettings(url) ?? { enabled: true, muted: false }
        : { enabled: false, muted: false }
      if (baseline.enabled) {
        widget = await startWidget(widgetOptions(url))
        widget.setMuted(baseline.muted)
      }
      watchWidgetSettings(url, baseline)
    } catch (error) {
      dialog.showErrorBox('DeepSeek Harness Desktop failed to start', error instanceof Error ? error.message : String(error))
      quitting = true
      app.quit()
    }
  })
}
