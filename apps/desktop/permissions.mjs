/** Permission policy shared by Electron session callbacks and unit tests. */

/**
 * Decide whether the main application frame may write sanitized text to the
 * host clipboard.
 * @param appOrigin - Origin selected for the local Harness backend.
 * @param requestingUrl - URL or origin reported by Electron.
 * @param permission - Electron permission name.
 * @param isMainFrame - Whether the requesting frame is the main frame.
 * @returns Whether Electron may grant this permission.
 */
export function allowsRendererPermission(appOrigin, requestingUrl, permission, isMainFrame) {
  if (permission !== 'clipboard-sanitized-write' || !isMainFrame) return false
  try {
    return new URL(requestingUrl).origin === appOrigin
  } catch {
    return false
  }
}
