/**
 * Drive the plugin's apply() on a real Context with stub services, capture
 * the webServer route it registers, and exercise both arms of
 * /image-gen/config: the read arm, the write arm with credential separation,
 * and rejection of bad values. This catches route bugs before a full app
 * restart is spent on them.
 */
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { apply, type ImageGenSettings } from '../src/index.ts'

type RouteHandler = (req: NodeJS.ReadableStream & Record<string, unknown>, res: RouteResponse) => Promise<void> | void
type RouteSpec = { kind: string; path: string; handler: RouteHandler }
type RouteResponse = {
  statusCode: number
  headers: Record<string, string>
  setHeader(key: string, value: string): void
  end(text?: string): void
}
type RouteResult = { status: number; body: string }

function harness(config: Partial<ImageGenSettings> = {}) {
  let route: RouteSpec | undefined
  const base: ImageGenSettings = {
    apiKeyEnv: 'TEST_API_KEY',
    baseURL: 'https://example.test/v1',
    model: 'image-model',
    size: '1024x1024',
    saveToWorkspace: true,
    ...config,
  }
  let current: ImageGenSettings = { ...base }
  const updates: Record<string, unknown>[] = []
  const credentialValues = new Map<string, string>([['TEST_API_KEY', 'test-secret']])

  const ctx = new Context()
  ctx.provide('logger', { info() {}, warn() {}, error() {} })
  ctx.provide('webServer', {
    register: (spec: RouteSpec) => {
      route = spec
      return () => { route = undefined }
    },
  })
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('attachments', {
    async readImage() { throw new Error('not used by the config route') },
    async saveImage() { throw new Error('not used by the config route') },
  })
  ctx.provide('credentials', {
    resolve: async (name: string) => credentialValues.has(name) ? { value: credentialValues.get(name), source: 'file' } : undefined,
    set: async (name: string, value: string) => { credentialValues.set(name, value) },
  })
  ctx.provide('settings', {
    writable: true,
    documentPath: 'settings.yaml',
    register: (_namespace: string, _schema: unknown, options: { base: Partial<ImageGenSettings> }) => ({
      get: () => ({ ...current, ...options.base }),
      watch: () => {},
    }),
    update: async (_namespace: string, patch: Record<string, unknown>) => {
      updates.push(patch)
      current = { ...current, ...patch } as ImageGenSettings
    },
  })

  // The composition entry carries the same values the settings scope
  // resolves, so assertions never depend on inject-wiring timing.
  apply(ctx, base)
  return {
    ctx,
    route: () => route,
    current: () => current,
    updates: () => updates,
  }
}

function call(spec: RouteSpec | undefined, method: string, path: string, body?: unknown): Promise<RouteResult> {
  return new Promise((resolve) => {
    expect(spec).toBeDefined()
    const req = method === 'POST' && body !== undefined
      ? Readable.from([Buffer.from(JSON.stringify(body))])
      : Readable.from([])
    Object.assign(req, { method, url: path })
    const res: RouteResponse = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) { this.headers[key.toLowerCase()] = value },
      end(text) { resolve({ status: this.statusCode, body: text ?? '' }) },
    }
    void Promise.resolve(spec!.handler(req as unknown as NodeJS.ReadableStream & Record<string, unknown>, res))
  })
}

describe('image-gen configuration route', () => {
  it('reads resolved settings without exposing the API key', async () => {
    const app = harness()
    const result = await call(app.route(), 'GET', '/image-gen/config')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({
      ok: true,
      value: app.current(),
      apiKeyConfigured: true,
      writable: true,
      file: 'settings.yaml',
    })
    expect(result.body).not.toContain('test-secret')
  })

  it('stores API credentials separately and persists only the sent fields', async () => {
    const app = harness()
    const result = await call(app.route(), 'POST', '/image-gen/config', { size: '1536x1024', apiKey: 'new-secret' })
    expect(result.status).toBe(200)
    expect(app.current().size).toBe('1536x1024')
    expect(app.updates()).toEqual([{ size: '1536x1024', apiKeyEnv: 'IMAGE_GEN_API_KEY' }])
    expect(result.body).not.toContain('new-secret')
    expect(JSON.parse(result.body).apiKeyConfigured).toBe(true)
  })

  it('rejects invalid size patches and unsupported methods', async () => {
    const app = harness()
    expect((await call(app.route(), 'POST', '/image-gen/config', { size: 'tiny' })).status).toBe(400)
    expect((await call(app.route(), 'POST', '/image-gen/config', { nope: 1 })).status).toBe(400)
    expect((await call(app.route(), 'PUT', '/image-gen/config')).status).toBe(405)
  })
})
