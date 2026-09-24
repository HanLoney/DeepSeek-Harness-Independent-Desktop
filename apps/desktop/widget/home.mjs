/**
 * Where the harness home lives, from the desktop host's point of view.
 *
 * The host spawns `dsh web` as a child process, and that child resolves its
 * home the same way this does, so a widget that writes into a different
 * directory would wire a profile nothing reads. `DSH_HOME` wins when set; the
 * default mirrors the harness's own (`~/.dsh`).
 * @module widget/home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Name of the environment variable that overrides the harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the harness home the same way the spawned backend does.
 * @param {Record<string, string | undefined>} [env] - the environment to read.
 * @returns {string} the absolute harness home.
 */
export function resolveDshHome(env = process.env) {
  const configured = env[DSH_HOME_ENV]?.trim() ?? ''
  return resolve(configured === '' ? join(homedir(), '.dsh') : configured)
}
