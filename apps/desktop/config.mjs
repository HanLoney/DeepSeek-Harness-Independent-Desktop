/** Desktop JSON configuration loading and validation. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Values written on first launch and used for omitted fields. */
export const defaultConfig = Object.freeze({
  window: {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
  },
  behavior: {
    closeToTray: true,
    startMinimized: false,
  },
  shortcuts: {
    toggleWindow: 'CommandOrControl+Shift+D',
    reload: 'CommandOrControl+Shift+R',
  },
  appearance: {
    customCss: '',
  },
  backend: {
    port: 0,
    workspace: '',
  },
})

function record(value, path) {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value
}

function boolean(value, fallback, path) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function integer(value, fallback, path, minimum, maximum) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function string(value, fallback, path) {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function shortcut(value, fallback, path) {
  if (value === undefined) return fallback
  if (value === null || typeof value === 'string') return value
  throw new Error(`${path} must be a string or null`)
}

/**
 * Validate a partial desktop configuration and fill omitted values.
 * @param {unknown} value - Parsed JSON value.
 * @returns {typeof defaultConfig} complete desktop configuration.
 */
export function normalizeConfig(value) {
  const root = record(value, 'config')
  const window = record(root.window, 'window')
  const behavior = record(root.behavior, 'behavior')
  const shortcuts = record(root.shortcuts, 'shortcuts')
  const appearance = record(root.appearance, 'appearance')
  const backend = record(root.backend, 'backend')

  const minWidth = integer(window.minWidth, defaultConfig.window.minWidth, 'window.minWidth', 640, 7680)
  const minHeight = integer(window.minHeight, defaultConfig.window.minHeight, 'window.minHeight', 480, 4320)
  const width = integer(window.width, defaultConfig.window.width, 'window.width', minWidth, 7680)
  const height = integer(window.height, defaultConfig.window.height, 'window.height', minHeight, 4320)
  const backgroundColor = string(window.backgroundColor, defaultConfig.window.backgroundColor, 'window.backgroundColor')
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(backgroundColor)) {
    throw new Error('window.backgroundColor must be a six- or eight-digit hex color')
  }

  return {
    window: {
      width,
      height,
      minWidth,
      minHeight,
      frame: boolean(window.frame, defaultConfig.window.frame, 'window.frame'),
      transparent: boolean(window.transparent, defaultConfig.window.transparent, 'window.transparent'),
      alwaysOnTop: boolean(window.alwaysOnTop, defaultConfig.window.alwaysOnTop, 'window.alwaysOnTop'),
      autoHideMenuBar: boolean(window.autoHideMenuBar, defaultConfig.window.autoHideMenuBar, 'window.autoHideMenuBar'),
      backgroundColor,
    },
    behavior: {
      closeToTray: boolean(behavior.closeToTray, defaultConfig.behavior.closeToTray, 'behavior.closeToTray'),
      startMinimized: boolean(behavior.startMinimized, defaultConfig.behavior.startMinimized, 'behavior.startMinimized'),
    },
    shortcuts: {
      toggleWindow: shortcut(shortcuts.toggleWindow, defaultConfig.shortcuts.toggleWindow, 'shortcuts.toggleWindow'),
      reload: shortcut(shortcuts.reload, defaultConfig.shortcuts.reload, 'shortcuts.reload'),
    },
    appearance: {
      customCss: string(appearance.customCss, defaultConfig.appearance.customCss, 'appearance.customCss'),
    },
    backend: {
      port: integer(backend.port, defaultConfig.backend.port, 'backend.port', 0, 65535),
      workspace: string(backend.workspace, defaultConfig.backend.workspace, 'backend.workspace'),
    },
  }
}

/**
 * Resolve a dependency inside the desktop runtime copied beside app.asar.
 * @param {string} resourcesPath - Electron's resources directory.
 * @param {...string} segments - Path below runtime/node_modules.
 * @returns {string} dependency path readable by an external process.
 */
export function runtimeDependencyPath(resourcesPath, ...segments) {
  return join(resourcesPath, 'runtime', 'node_modules', ...segments)
}

/**
 * Read a desktop configuration, creating the default document when absent.
 * @param {string} path - Absolute configuration path.
 * @returns {typeof defaultConfig} validated desktop configuration.
 */
export function loadConfig(path) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(defaultConfig, null, 2)}\n`, { flag: 'wx' })
  }
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot load desktop config ${path}: ${message}`)
  }
}
