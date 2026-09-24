/**
 * The RPC channel a browser calls, driven through a real Connection host over a
 * real HTTP route. These tests register the channel's fetcher on a live server,
 * so the request path (client envelope -> Connection decode -> endpoint handler
 * -> response envelope) is exercised end to end rather than by calling `apply`'s
 * internals.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebRoute, WebUpgradeRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, CHANNEL } from '../src/index.ts'

/** Structural webServer fake that records the routes a plugin registers. */
function fakeHttpServer(routes: WebRoute[], upgrades: WebUpgradeRoute[]): WebServer {
  const fake: Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> = {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
  return fake as WebServer
}

/** Boot one composed plugin over a live loopback server and return its base URL. */
async function bootstrap(): Promise<{ url: string; dispose: () => Promise<void> }> {
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  const server = createServer((request, response) => {
    const route = routes.find(candidate => request.url?.startsWith(candidate.path) === true)
    void route?.handler(request, response)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo

  const ctx = new Context()
  ctx.provide('webServer', fakeHttpServer(routes, upgrades))
  // The connection node half binds the gateway; this spec drives the channel
  // through it, so the real plugin is loaded rather than a hand-built stand-in.
  const connection = await import('@deepseek-ai/dsh-client-connection')
  const fiber = ctx.plugin({ inject: [...connection.inject], apply: connection.apply })
  await fiber.await()
  const pluginFiber = ctx.plugin({ inject: ['connection'], apply })
  await pluginFiber.await()
  return {
    url: `http://127.0.0.1:${String(port)}`,
    dispose: async () => {
      await pluginFiber.dispose()
      await fiber.dispose()
      server.close()
    },
  }
}

/** Post one client request to a channel endpoint and return the decoded result. */
async function call(url: string, method: string, payload: unknown): Promise<unknown> {
  const request: ClientRequest = {
    type: 'client-request',
    rpcId: RpcId('spec'),
    method,
    payload,
  }
  const response = await fetch(`${url}${CHANNEL}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = await response.json() as { result: unknown }
  return body.result
}

let live: Awaited<ReturnType<typeof bootstrap>> | undefined
afterEach(async () => { await live?.dispose(); live = undefined })

describe('codex bridge RPC channel', () => {
  it('answers threads/list with this machine\u2019s Codex threads', async () => {
    live = await bootstrap()
    const result = await call(live.url, 'threads/list', {}) as {
      ok: boolean
      value: { codexHome: string; threads: { id: string; shards: number; cwd?: string; project?: string }[] }
    }
    expect(result.ok).toBe(true)
    expect(result.value.codexHome).toContain('.codex')
    for (const thread of result.value.threads) {
      expect(thread.id).toMatch(/^[0-9a-f-]{36}$/u)
      expect(thread.shards).toBeGreaterThan(0)
      if (thread.project !== undefined) expect(thread.cwd).toBeDefined()
    }
  })

  it('answers sessions/list with the artifacts under the session root', async () => {
    live = await bootstrap()
    const result = await call(live.url, 'sessions/list', {}) as {
      ok: boolean
      value: { sessionRoot: string; sessions: { id: string; bytes: number }[] }
    }
    expect(result.ok).toBe(true)
    expect(result.value.sessionRoot).toContain('sessions')
    for (const session of result.value.sessions) {
      // A session directory is named for its id; subagent sessions use a bare
      // uuid while top-level sessions use the `session-<uuid>` form.
      expect(session.id).toMatch(/^(session-)?[0-9a-f-]{36}$/u)
      expect(session.bytes).toBeGreaterThan(0)
    }
  })

  it('reports an unknown endpoint as an internal RPC error rather than throwing', async () => {
    live = await bootstrap()
    const result = await call(live.url, 'nope/nope', {}) as { ok: boolean; error: { message: string } }
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain('unknown codex-bridge endpoint')
  })

  it('refuses a project import without non-empty thread ids', async () => {
    live = await bootstrap()
    for (const threadIds of [undefined, [], ['']]) {
      const result = await call(live.url, 'runs/start-import-batch', { threadIds }) as { ok: boolean; error: { message: string } }
      expect(result.ok).toBe(false)
      expect(result.error.message).toBe('threadIds must be a non-empty array of strings')
    }
  })

  it('imports project threads sequentially and reports individual failures', async () => {
    live = await bootstrap()
    const started = await call(live.url, 'runs/start-import-batch', { threadIds: ['missing-one', 'missing-two'] }) as {
      ok: boolean
      value: { id: string }
    }
    expect(started.ok).toBe(true)
    let run: { status: string; result?: { summary: string; facts: { label: string; value: string }[] } } | undefined
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = await call(live.url, 'runs/read', { id: started.value.id }) as { value: { run: typeof run | null } }
      run = read.value.run ?? undefined
      if (run?.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(run?.status).toBe('failed')
    expect(run?.result?.summary).toBe('Imported 0 of 2 thread(s)')
    expect(run?.result?.facts).toContainEqual({ label: 'failed', value: '2' })
  })

  it('refuses an import without a thread id', async () => {
    live = await bootstrap()
    const result = await call(live.url, 'runs/start-import', {}) as { ok: boolean; error: { message: string } }
    expect(result.ok).toBe(false)
    expect(result.error.message).toBe('threadId is required')
  })

  it('opens an import run, records its failure, and lets a later read see it', async () => {
    live = await bootstrap()
    const started = await call(live.url, 'runs/start-import', { threadId: 'no-such-thread' }) as {
      ok: boolean
      value: { id: string }
    }
    expect(started.ok).toBe(true)
    // The run proceeds detached; poll until it settles.
    let run: { status: string; log: { text: string }[] } | undefined
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = await call(live.url, 'runs/read', { id: started.value.id }) as {
        value: { run: { status: string; log: { text: string }[] } | null }
      }
      run = read.value.run ?? undefined
      if (run?.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(run?.status).toBe('failed')
    expect(run?.log.some(line => line.text.includes('no Codex rollout found'))).toBe(true)
  })

  it('refuses a read without an id', async () => {
    live = await bootstrap()
    const result = await call(live.url, 'runs/read', {}) as { ok: boolean; error: { message: string } }
    expect(result.ok).toBe(false)
    expect(result.error.message).toBe('runs/read requires an id')
  })
})
