/**
 * Electron host for the desktop task widget.
 *
 * This module is the widget's only door into the application: it starts the
 * widget's own HTTP surface on the existing loopback backend, opens the
 * frameless window, and stops both again. Nothing else in apps/desktop knows
 * the widget exists beyond one call to stop().
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from 'electron'
import { WidgetHost, seedBaseline } from './host.mjs'

const WIDTH = 440
// Sized around the working whale, which is the widest artwork: it draws the
// thought balloon the bubble panel is positioned inside.
const HEIGHT = 400
const SAVE_DEBOUNCE_MS = 400

/** Default geometry: the bottom-right corner of the primary display. */
function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - WIDTH - 24, y: area.y + area.height - HEIGHT - 24 }
}

/**
 * Pull a stored position fully back onto one connected display.
 *
 * A window saved while a monitor was attached would otherwise open offscreen
 * with no way to reach it, so the position is corrected rather than rejected:
 * rejection would discard a still-mostly-valid corner just because a few
 * pixels hang off an edge.
 * @param {{ x: number, y: number }} position - the stored position.
 * @returns {{ x: number, y: number }} a position fully inside a display.
 */
function clamped(position) {
  const displays = screen.getAllDisplays()
  const owner = displays.find((display) => {
    const area = display.workArea
    return position.x + WIDTH > area.x && position.x < area.x + area.width
      && position.y + HEIGHT > area.y && position.y < area.y + area.height
  })
  if (owner === undefined) return defaultPosition()
  const area = owner.workArea
  return {
    x: Math.min(Math.max(position.x, area.x), area.x + area.width - WIDTH),
    y: Math.min(Math.max(position.y, area.y), area.y + area.height - HEIGHT),
  }
}

/** Read the saved geometry, falling back to the default corner. */
function loadPosition(statePath) {
  try {
    const stored = JSON.parse(readFileSync(statePath, 'utf8'))
    if (Number.isInteger(stored.x) && Number.isInteger(stored.y)) return clamped(stored)
  } catch {
    // Absent or unreadable state is the first-run case: fall through to the
    // default corner rather than failing the widget.
  }
  return defaultPosition()
}

/**
 * Ports Chromium refuses to load from, which an OS-assigned port can land on.
 * Loading `http://127.0.0.1:<port>` from any of them fails with ERR_UNSAFE_PORT
 * and leaves the widget window permanently blank, so a port in this set is
 * rejected and another is requested. The list is Chromium's own `kRestrictedPorts`
 * for the ranges an ephemeral allocation can actually reach.
 */
const RESTRICTED_PORTS = new Set([
  2049, // nfs
  4045, // npp
  6000, // x11
  6665, 6666, 6667, 6668, 6669, // irc
  6697, // ircs
  10080, // amanda
])

/**
 * Bind a loopback server on a port Chromium will actually load.
 * @param {import('node:http').Server} server - the server to bind.
 * @returns {Promise<number>} the bound port.
 */
async function listenOnUsablePort(server) {
  // Bounded: each attempt asks the OS for a fresh ephemeral port, and a port in
  // the restricted set is rare, so a handful of tries is not a meaningful wait.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const onError = (error) => { server.removeListener('listening', onListening); reject(error) }
      const onListening = () => { server.removeListener('error', onError); resolve(server.address().port) }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ host: '127.0.0.1', port: 0 })
    })
    if (!RESTRICTED_PORTS.has(port)) return port
    await new Promise(resolve => { server.close(resolve) })
  }
  throw new Error('Could not bind the widget server on a port Chromium will load')
}

/**
 * Persist a window position, creating the state directory on first write.
 * @param {string} statePath - where the geometry is stored.
 * @param {BrowserWindow} window - the window to record.
 */
function writePosition(statePath, window) {
  if (window.isDestroyed()) return
  const [x, y] = window.getPosition()
  try {
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ x, y }) + '\n')
  } catch {
    // A geometry write that fails costs the next launch its position and
    // nothing else, so it never disturbs the running widget.
  }
}

/**
 * Open the widget's window and its data plane: the loopback server, then the
 * frameless window that paints it.
 * @param {{ userDataPath: string, backendUrl: string, assetsRoot: string, iconPath: string, preloadPath: string }} options - resolved paths.
 * @returns {Promise<{ window: BrowserWindow, statePath: string, close: () => void }>} the window, its geometry path, and a handle stopping the window, the server, and the upstream socket.
 */
async function openWindow(options) {
  const statePath = join(options.userDataPath, 'widget-state.json')
  const host = new WidgetHost(options.backendUrl, options.assetsRoot)
  const server = createServer((req, res) => {
    // The widget surface is loopback-only by construction: the window loads
    // from 127.0.0.1 and the socket never binds a public interface.
    void host.handle(req, res)
  })
  const port = await listenOnUsablePort(server)
  const origin = 'http://127.0.0.1:' + port

  void seedBaseline(host, options.backendUrl)

  const position = loadPosition(statePath)
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: options.iconPath,
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.once('ready-to-show', () => { window.showInactive() })
  // A crashed renderer would leave a permanently blank frame on top of the
  // desktop, so the window reloads itself instead of staying broken.
  window.webContents.on('render-process-gone', () => { window.reload() })

  // The window is larger than its artwork, so it starts click-through and the
  // renderer reports when the pointer crosses a drawn part. Without this the
  // transparent margin would swallow clicks meant for whatever sits below.
  window.setIgnoreMouseEvents(true, { forward: true })
  const onInteractive = (event, interactive) => {
    if (event.sender !== window.webContents) return
    window.setIgnoreMouseEvents(interactive !== true, { forward: true })
  }
  ipcMain.on('whale:interactive', onInteractive)

  const savePosition = () => { writePosition(statePath, window) }
  let saveTimer
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(savePosition, SAVE_DEBOUNCE_MS)
  }
  // A frameless drag reports 'moved' while the drag is in flight and no other
  // event carries the final position, so both feed the same debounced save.
  window.on('moved', scheduleSave)
  window.on('move', scheduleSave)

  // The upstream subscription starts only once the window can be shown: a
  // failure past this point still runs close(), and nothing has subscribed yet.
  host.start()
  await window.loadURL(origin + '/widget/')

  return {
    window,
    statePath,
    close() {
      clearTimeout(saveTimer)
      savePosition()
      ipcMain.removeListener('whale:interactive', onInteractive)
      host.close()
      if (!window.isDestroyed()) window.destroy()
      server.close()
    },
  }
}

/**
 * Start the widget: one tray for its lifetime, and a window inside it.
 *
 * The tray outlives the window. A frameless window that skips the taskbar has
 * no other way back, so dismissing the widget would otherwise be irreversible
 * short of restarting the application; this menu is that way back, which is why
 * the tray is created before the first window and destroyed only by close().
 * @param {{ userDataPath: string, backendUrl: string, assetsRoot: string, iconPath: string, preloadPath: string }} options - resolved paths.
 * @returns {Promise<{ close: () => void }>} handle stopping the widget, its tray, and its window.
 */
export async function startWidget(options) {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath).resize({ width: 20, height: 20 }))
  tray.setToolTip('任务挂件')

  let live = null
  let muted = false
  let closed = false

  function refreshTray() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: label(), click: toggleVisible },
      { label: muted ? '开启声音' : '静音', click: toggleSound, enabled: live !== null },
      { type: 'separator' },
      { label: '退出挂件', click: shutdown, enabled: live !== null },
    ]))
  }

  function label() {
    if (live === null) return '打开挂件'
    return live.window.isVisible() ? '隐藏挂件' : '显示挂件'
  }

  function shutdown() {
    live?.close()
    live = null
    refreshTray()
  }

  async function boot() {
    live = await openWindow(options)
    // The renderer and the window manager can both change visibility, so the
    // label follows the window's real state rather than the clicks that started
    // here.
    live.window.on('show', refreshTray)
    live.window.on('hide', refreshTray)
    refreshTray()
  }

  function toggleVisible() {
    if (closed) return
    if (live === null) { void boot(); return }
    if (live.window.isVisible()) live.window.hide()
    else live.window.showInactive()
  }

  /**
   * Flip the sound state, for the tray and the right-click menu.
   *
   * The renderer owns the choice — a double click on the bubble makes the same
   * one — so this asks it for the new value and waits for it to report back
   * through `whale:muted`. Assuming the answer here would put the labels ahead
   * of the state they describe if the window happened to be gone.
   */
  function toggleSound() {
    if (live === null) return
    live.window.webContents.send('whale:sound', !muted)
  }

  /**
   * Apply an absolute sound state, as the settings panel reports it. A no-op
   * when the value already holds, so a poll that finds no change does not
   * restart the cue.
   * @param {boolean} value - true while sound is off.
   */
  function setMuted(value) {
    if (muted === value) return
    live?.window.webContents.send('whale:sound', value)
  }

  /** The commands a right click offers, in the order they are shown. */
  function widgetMenu() {
    return Menu.buildFromTemplate([
      { label: '隐藏挂件', click: () => { live?.window.hide() } },
      { label: muted ? '开启声音' : '静音', click: toggleSound },
      { type: 'separator' },
      { label: '退出挂件', click: shutdown },
    ])
  }

  // The renderer owns the sound decision, because a double click on the bubble
  // makes the same one; the menu reads the renderer's answer instead of keeping
  // a copy that could disagree with it.
  const onContext = (event) => {
    if (event.sender !== live?.window.webContents) return
    widgetMenu().popup({ window: live.window })
  }
  const onMuted = (event, value) => {
    if (event.sender !== live?.window.webContents) return
    muted = value === true
    refreshTray()
  }
  // The window moves from pointer deltas rather than through a drag region, so
  // that the whole drawn box stays right-clickable. The origin is captured at
  // the start of the move, because the pointer's screen position is the only
  // frame of reference that does not shift as the window follows it.
  let dragOrigin = null
  const onDrag = (event, message) => {
    if (event.sender !== live?.window.webContents || live === null) return
    if (message.phase === 'start') {
      const [x, y] = live.window.getPosition()
      dragOrigin = { x, y }
      return
    }
    if (dragOrigin === null) return
    if (message.phase === 'move') {
      live.window.setPosition(Math.round(dragOrigin.x + message.dx), Math.round(dragOrigin.y + message.dy))
      return
    }
    dragOrigin = null
    writePosition(live.statePath, live.window)
  }
  ipcMain.on('whale:drag', onDrag)
  ipcMain.on('whale:context', onContext)
  ipcMain.on('whale:muted', onMuted)

  tray.on('click', toggleVisible)
  await boot()

  return {
    setMuted,
    close() {
      closed = true
      ipcMain.removeListener('whale:drag', onDrag)
      ipcMain.removeListener('whale:context', onContext)
      ipcMain.removeListener('whale:muted', onMuted)
      shutdown()
      tray.destroy()
    },
  }
}
