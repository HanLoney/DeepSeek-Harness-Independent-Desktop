/**
 * Profile wiring for the task widget's settings panel.
 *
 * The panel is a client plugin, and the browser half of a client plugin is
 * discovered only through a loader entry whose `name` resolves as a package:
 * the client-modules scanner resolves `<name>/package.json` and serves
 * `exports["./client"]`. So the panel needs two things in the user's profile —
 * the package in the profile's own `node_modules`, and one row naming it.
 *
 * The package goes in the profile's `node_modules`, never the sibling
 * `profiles/node_modules`. That sibling is the harness's own flat module
 * fallback: it holds one *symlink* per package in the installation's dependency
 * closure, and its heal step throws on a real directory at one of those names.
 * A name outside that closure is only accidentally safe there, and the
 * profile's own directory is the first place Node looks anyway.
 *
 * This module owns both and nothing else. It fences its row in the profile's
 * patch layer instead of replacing the file, so a profile edited by hand keeps
 * every line of it, and {@link uninstall} removes exactly what
 * {@link install} added — down to the template's own comments. That symmetry is
 * what lets the whole widget directory be deleted without leaving a dangling
 * row behind.
 * @module widget/install
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Package name of the settings plugin; also the loader entry name and bundle id. */
const PLUGIN_NAME = 'dsh-plugin-desktop-widget'

/** Loader entry id, distinct from the package name so a profile can retarget it. */
const ENTRY_ID = 'desktop-widget'

/** Opens the block this module owns. */
const BEGIN = '# >>> desktop widget: settings panel (managed by apps/desktop) >>>'

/** Closes the block this module owns. */
const END = '# <<< desktop widget: settings panel <<<'

/**
 * The profile patch template, mirroring `PROFILE_PATCH_TEMPLATE` in
 * `dsh-app-boot`'s profile module. A profile this module reaches before the
 * harness has initialized it gets these exact bytes; otherwise the harness sees
 * a file already present and never writes its header.
 * `widget-settings.test.mjs` asserts this copy against the source of record.
 */
const PROFILE_PATCH_TEMPLATE = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
  '',
].join('\n')

/**
 * The loader row, verbatim. Kept as one string so install and uninstall cannot
 * disagree about what was written.
 * @returns the fenced YAML block, newline-terminated.
 */
function managedBlock() {
  return [
    BEGIN,
    "# The widget's settings panel. Its browser half is discovered from the",
    "# package's dsh.client manifest and served at",
    '# /plugins/' + PLUGIN_NAME + '/client.js, so the name below must stay the',
    '# package name — it is the id the client scanner matches on. Delete this',
    '# block to hide the panel; the widget itself keeps working from its tray',
    '# and right-click menus.',
    '- insert:',
    '    - id: ' + ENTRY_ID,
    "      name: '" + PLUGIN_NAME + "'",
    // The row's config is the layer below stored settings, and the loader
    // validates it against the plugin's schema, so it must be present.
    '      config: {}',
    END,
    '',
  ].join('\n')
}

/**
 * Whether a line carries patch content rather than a comment or blank.
 * @param {string} line - one line of the patch file.
 * @returns {boolean} true for a line the loader reads as a patch entry.
 */
function isRow(line) {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('#')
}

/**
 * Read the patch list with a managed block, if any, removed.
 *
 * The shipped template is comment lines above an empty document (`[]`). That
 * `[]` is the whole patch list, so leaving it in place while appending a row
 * would produce two YAML documents and the loader would refuse the file; it is
 * dropped when, and only when, it is the only entry the file carries. The
 * template's comments are kept either way, so a round trip through
 * {@link install} and {@link uninstall} restores the file the user started
 * with.
 * @param {string} text - the current patch file contents.
 * @returns {string} the contents without the managed block, head-trimmed.
 */
function stripManaged(text) {
  const kept = []
  let inside = false
  for (const line of text.split('\n')) {
    if (line.trim() === BEGIN) { inside = true; continue }
    if (line.trim() === END) { inside = false; continue }
    if (!inside) kept.push(line)
  }
  const rows = kept.filter(isRow)
  const body = rows.length === 1 && rows[0] === '[]'
    ? kept.filter(line => line.trim() !== '[]')
    : kept
  return body.join('\n').replace(/^(?:[ \t]*\n)+/u, '').trimEnd()
}

/**
 * Install the settings plugin into a profile: the package, then the row.
 *
 * Both steps are idempotent and run on every launch. A write is skipped when
 * the file already holds exactly these bytes, so the bundle's content hash —
 * and with it the rev the browser uses as its cache key — stays stable across
 * launches instead of forcing a panel reload on each boot.
 *
 * A profile the harness has never initialized has no patch file, and the
 * harness writes its template only when that file is absent — so a file created
 * here first would permanently deny the profile the template's comment header.
 * This module therefore seeds an absent file with the template itself, which is
 * the same content the harness would have written, and edits it from there.
 * @param {{ profileName?: string, dshHome: string, pluginRoot: string }} options - profile identity, the harness home, and the plugin source directory.
 * @returns {{ installed: boolean, patchPath: string }} whether the wiring changed, and the file it touched.
 */
export function install(options) {
  const profileName = options.profileName ?? 'web'
  const target = join(options.dshHome, 'profiles', profileName, 'node_modules', PLUGIN_NAME)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(options.pluginRoot, target, {
    recursive: true,
    force: true,
    filter: from => !from.includes('node_modules'),
  })

  const patchPath = join(options.dshHome, 'profiles', profileName, 'cordis.patch.yml')
  mkdirSync(dirname(patchPath), { recursive: true })
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : PROFILE_PATCH_TEMPLATE
  const body = stripManaged(existing)
  const next = body === '' ? managedBlock() : body + '\n\n' + managedBlock()
  if (next === existing) return { installed: false, patchPath }
  writeFileSync(patchPath, next)
  return { installed: true, patchPath }
}

/**
 * Remove everything {@link install} added.
 *
 * Both halves are disposable: without them the widget runs from its tray and
 * right-click menus exactly as it did before the panel existed. A patch list
 * left with no entries regains the empty document the template ships, so the
 * profile is byte-identical to its state before the first install.
 * @param {{ profileName?: string, dshHome: string }} options - profile identity and the harness home.
 * @returns {{ removed: boolean, patchPath: string }} whether anything was removed.
 */
export function uninstall(options) {
  const profileName = options.profileName ?? 'web'
  const target = join(options.dshHome, 'profiles', profileName, 'node_modules', PLUGIN_NAME)
  const hadPackage = existsSync(target)
  rmSync(target, { recursive: true, force: true })

  const patchPath = join(options.dshHome, 'profiles', profileName, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return { removed: hadPackage, patchPath }
  const existing = readFileSync(patchPath, 'utf8')
  const body = stripManaged(existing)
  const next = body.split('\n').filter(isRow).length === 0
    ? (body === '' ? '' : body + '\n') + '[]\n'
    : body + '\n'
  if (next === existing) return { removed: hadPackage, patchPath }
  writeFileSync(patchPath, next)
  return { removed: true, patchPath }
}
