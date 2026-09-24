/**
 * Verify generate_image selects JSON generations or multipart edits, rejects
 * malformed image tokens, and auto-routes current-message image blocks to the
 * edits endpoint. The image gateway boundary is stubbed; the tool registry
 * and attachment/credential services run on a real Context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, type ImageGenSettings } from '../src/index.ts'

type RegisteredTool = { name: string; execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<unknown> }
type ExecInput = { signal?: AbortSignal; agent: { session: Record<string, unknown>; options: Record<string, unknown> }; parent?: unknown }

function harness(config: Partial<ImageGenSettings> = {}) {
  let tool: RegisteredTool | undefined
  const settings: ImageGenSettings = {
    apiKeyEnv: 'TEST_API_KEY',
    baseURL: 'https://gateway.test/v1',
    model: 'gpt-image-2',
    size: '1024x1024',
    saveToWorkspace: false,
    ...config,
  }

  const ctx = new Context()
  ctx.provide('logger', { info() {}, warn() {}, error() {} })
  ctx.provide('webServer', { register: () => () => {} })
  ctx.provide('tools', { register: (registered: RegisteredTool) => { tool = registered; return () => { tool = undefined } } })
  ctx.provide('attachments', {
    imageLimits: { mediaTypes: ['image/png', 'image/jpeg'], maxImageBytes: 10_000_000, maxMessageImageBytes: 10_000_000 },
    async readImage(ref: { attachmentId: string; mediaType: string }) {
      return { ref: { attachmentId: ref.attachmentId, mediaType: ref.mediaType }, data: new Uint8Array([1, 2, 3, 4]) }
    },
    async saveImage() {
      return { attachmentId: 'out-1', mediaType: 'image/png', bytes: 8, width: 2, height: 2 }
    },
  })
  ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test', source: 'file' }), set: async () => {} })
  ctx.provide('settings', {
    writable: true,
    documentPath: 'settings.yaml',
    register: (_namespace: string, _schema: unknown, options: { base: Partial<ImageGenSettings> }) => ({
      get: () => ({ ...settings, ...options.base }),
      watch: () => {},
    }),
    update: async () => {},
  })

  // The composition entry carries the same values the settings scope
  // resolves, so assertions never depend on inject-wiring timing.
  apply(ctx, settings)
  return { ctx, tool: () => tool }
}

const outputImage = Buffer.from('PNG-test')
const calls: { url: string; init: RequestInit }[] = []

describe('generate_image request selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    calls.length = 0
  })

  it('sends JSON generations without references and multipart edits with them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, async json() { return { data: [{ b64_json: outputImage.toString('base64') }] } }, async text() { return '' } }
    }))
    const app = harness()
    const exec: ExecInput = { agent: { session: { deriveMessages: () => [], requestHeader: () => ({ config: {} }), header: { cwd: '' } }, options: {} } }

    await app.tool()!.execute({ prompt: 'new picture' }, exec as never)
    expect(calls[0]?.url).toBe('https://gateway.test/v1/images/generations')
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe('application/json')

    const sourceToken = Buffer.from(JSON.stringify({ attachmentId: 'sha256:reference-image', mediaType: 'image/png', bytes: 4, width: 2, height: 2 }), 'utf8').toString('base64url')
    calls.length = 0
    await app.tool()!.execute({ prompt: 'edit this picture', images: [sourceToken] }, exec as never)
    expect(calls[0]?.url).toBe('https://gateway.test/v1/images/edits')
    expect(calls[0]?.init.body).toBeInstanceOf(FormData)
  })

  it('rejects malformed image tokens before any request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, async json() { return { data: [{ b64_json: outputImage.toString('base64') }] } }, async text() { return '' } })))
    const app = harness()
    const exec: ExecInput = { agent: { session: { deriveMessages: () => [], requestHeader: () => ({ config: {} }), header: { cwd: '' } }, options: {} } }
    await expect(app.tool()!.execute({ prompt: 'edit invalid', images: ['not-a-token'] }, exec as never)).rejects.toThrow(/图片引用无效/)
    expect(calls).toHaveLength(0)
  })

  it('auto-routes the latest user message image to the edits endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, async json() { return { data: [{ b64_json: outputImage.toString('base64') }] } }, async text() { return '' } }
    }))
    const app = harness()
    const currentUserImage = { attachmentId: 'sha256:user-upload', mediaType: 'image/jpeg', bytes: 5, width: 3, height: 2 }
    const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Use this character reference' }, { type: 'image', attachment: currentUserImage }] }]
    const exec: ExecInput = { agent: { session: { deriveMessages: () => messages, requestHeader: () => ({ config: {} }), header: { cwd: '' } }, options: {} } }

    await app.tool()!.execute({ prompt: 'create using this character reference' }, exec as never)
    expect(calls[0]?.url).toBe('https://gateway.test/v1/images/edits')
    const parts = [...(calls[0]?.init.body as FormData).entries()]
    const imageParts = parts.filter(([key]) => key === 'image')
    expect(imageParts).toHaveLength(1)
    const part = imageParts[0]?.[1]
    expect(String(typeof part === 'string' ? part : (part as { name?: string }).name).endsWith('.jpeg')).toBe(true)
  })
})
