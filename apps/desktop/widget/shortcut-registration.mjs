/**
 * Register one optional desktop shortcut without making startup depend on it.
 * @param {{ register: (accelerator: string, callback: () => void) => boolean }} registry - Electron's global shortcut registry.
 * @param {string | null} accelerator - shortcut to register, or null to disable it.
 * @param {() => void} action - action invoked by the shortcut.
 * @param {string} name - configuration key used in diagnostics.
 * @param {(message: string) => void} warn - warning sink.
 * @returns {boolean} whether the shortcut was registered or disabled.
 */
export function registerShortcut(registry, accelerator, action, name, warn = console.warn) {
  if (accelerator === null) return true
  if (registry.register(accelerator, action)) return true
  warn(`desktop: cannot register ${name} shortcut ${JSON.stringify(accelerator)}; the shortcut may already be in use`)
  return false
}
