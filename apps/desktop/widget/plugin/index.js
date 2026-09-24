/**
 * Task widget settings, host half.
 *
 * The widget's window belongs to the Electron desktop host, not to this
 * process, so this half owns exactly one thing: the durable `desktop-widget`
 * settings namespace that says whether the widget is enabled. The host reads it
 * over the route below.
 *
 * The route exists because `dsh-host-apiproxy` gates the generic settings RPC
 * behind a hardcoded namespace allowlist, so a plugin cannot expose its own
 * namespace to the browser through `settingsScope`. The panel and the desktop
 * host both talk to `/desktop-widget/config`, which writes through the same
 * settings service — one document, one schema, one validation path.
 * @module dsh-plugin-desktop-widget
 */

import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Loader entry name; also the client bundle id the settings panel loads under. */
export const name = 'desktop-widget'

/** Durable settings namespace; also the settings-panel section id. */
export const SETTINGS_NAMESPACE = 'desktop-widget'

/** Route prefix carrying the settings endpoint. */
const ROUTE_PREFIX = '/desktop-widget'

/** Services this plugin consumes. */
export const inject = ['webServer']

/** The widget's durable settings, validated on every read and write. */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  muted: z.boolean().default(false),
})

/** The loader validates the composition entry with the same contract. */
export const Config = SettingsSchema

/**
 * Coerce a stored section into the exact fields this plugin acts on, tolerating
 * a partial or absent value.
 * @param raw - the stored namespace value, possibly partial.
 * @returns fully populated settings.
 */
function normalize(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: value.enabled !== false,
    muted: value.muted === true,
  }
}

/**
 * Register the settings namespace and serve it to the browser and the desktop
 * host.
 * @param ctx - plugin context carrying the web server.
 * @param config - the composition entry, the layer below stored settings.
 */
export function apply(ctx, config) {
  let source = () => config
  let current = normalize(config)

  // Registration waits for the settings service itself: it is optional here,
  // and a deployment without one leaves the composition entry as the value.
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), SettingsSchema, config, {
    setSource: (next) => { source = next },
    onChange: () => { current = normalize(source()) },
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    async handler(req, res) {
      /** Send one plain-text status and close. */
      const fail = (status, message) => {
        res.statusCode = status
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end(message)
      }
      /** Send one JSON body. */
      const json = (status, body) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
        return fail(405, 'unsupported method')
      }
      const requested = new URL(req.url ?? '/', 'http://localhost').pathname
      const tail = requested.slice(ROUTE_PREFIX.length).replace(/^\/+/u, '')
      if (tail !== 'config') return fail(404, 'not found')

      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 4096) return fail(413, 'config too large')
        }
        let patch
        try {
          patch = JSON.parse(body)
        } catch {
          return json(400, { ok: false, error: 'config is not valid JSON' })
        }
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          return json(400, { ok: false, error: 'config must be a JSON object' })
        }
        // The schema is the field list, so an unknown key is refused here
        // rather than stored and silently ignored by every later read.
        const known = Object.keys(SettingsSchema.dict)
        const unknown = Object.keys(patch).filter(key => !known.includes(key))
        if (unknown.length > 0) return json(400, { ok: false, error: `unknown fields: ${unknown.join(', ')}` })
        const settingsService = ctx.get('settings')
        if (settingsService === undefined) return json(503, { ok: false, error: 'no settings service in this deployment' })
        try {
          await settingsService.update(SETTINGS_NAMESPACE, patch)
        } catch (error) {
          return json(400, { ok: false, error: `save failed: ${String(error?.message ?? error)}` })
        }
        // Echo what was persisted rather than the live value: the watcher that
        // refreshes it is asynchronous, so reading it here would race.
        return json(200, { ok: true, value: normalize({ ...current, ...patch }) })
      }

      return json(200, { ok: true, value: current })
    },
  }), 'desktop-widget: settings route')
}
