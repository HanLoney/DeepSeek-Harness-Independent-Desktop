/**
 * Host half of the Codex bridge panel: the RPC channel a browser calls to list
 * Codex threads, start an import or export, and poll its progress.
 *
 * The channel is registered on `/codex-bridge` through the Connection
 * service's generic RPC registry, so it needs no entry in the API Proxy's
 * method table and no change to any core package. Its authority is `loopback`:
 * the operations read and write files in the user's home directories, which is
 * a capability a non-loopback browser must not reach.
 *
 * Work started here is observed by polling, not by pushing frames. A run's log
 * lives in this package's registry and the panel reads it on an interval, which
 * keeps the whole feature inside one package instead of adding a mux frame and
 * its client fold to the core conversation pipeline.
 *
 * @module @deepseek-ai/dsh-codex-bridge-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { RunRegistry } from './runs.ts'
import { listSessions, listThreads, runExport, runImport, runImportBatch } from './operations.ts'
import type { StartExportRequest, StartImportBatchRequest, StartImportRequest } from './types.ts'

/** The absolute RPC channel this package owns. */
export const CHANNEL = '/codex-bridge'

/** Required services: the Connection transport that carries the channel. */
export const inject = ['connection']

/**
 * Register the bridge RPC channel for this plugin's fiber.
 * @param ctx - the plugin's context, which owns the registration's lifetime.
 */
export function apply(ctx: Context): void {
  const runs = new RunRegistry()

  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      const value = await dispatch(endpoint, payload, runs)
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }, { authority: 'loopback' }), 'codex-bridge-host: RPC channel')
}

/**
 * Route one decoded endpoint to its operation.
 * @param endpoint - channel-relative endpoint name.
 * @param payload - the endpoint's request payload.
 * @param runs - the registry holding this channel's runs.
 * @returns the endpoint's response value.
 */
async function dispatch(endpoint: string, payload: unknown, runs: RunRegistry): Promise<unknown> {
  switch (endpoint) {
    case 'threads/list':
      return listThreads(readOptionalString(payload, 'codexHome'))
    case 'sessions/list':
      return listSessions(readOptionalString(payload, 'sessionRoot'))
    case 'runs/start-import': {
      const request = readImportRequest(payload)
      const { id, reporter } = runs.open('import', request.threadId)
      // The operation runs detached: the browser gets the run id immediately and
      // observes progress by polling, so a long import cannot hold the request.
      void runImport(request, reporter)
      return { id }
    }
    case 'runs/start-import-batch': {
      const request = readImportBatchRequest(payload)
      const { id, reporter } = runs.open('import', `project: ${String(request.threadIds.length)} threads`)
      void runImportBatch(request, reporter)
      return { id }
    }
    case 'runs/start-export': {
      const request = readExportRequest(payload)
      const { id, reporter } = runs.open('export', request.sessionId)
      void runExport(request, reporter)
      return { id }
    }
    case 'runs/read': {
      const id = readOptionalString(payload, 'id')
      if (id === undefined) throw new Error('runs/read requires an id')
      return { run: runs.read(id) ?? null }
    }
    default:
      throw new Error(`unknown codex-bridge endpoint ${JSON.stringify(endpoint)}`)
  }
}

/** Read one optional string field from an untrusted payload. */
function readOptionalString(payload: unknown, field: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Spread an optional wire field only when it is present. */
function optionalSpread(field: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [field]: value }
}

/** Validate one import request at the wire boundary. */
function readImportRequest(payload: unknown): StartImportRequest {
  const threadId = readOptionalString(payload, 'threadId')
  if (threadId === undefined) throw new Error('threadId is required')
  return {
    threadId,
    ...optionalSpread('codexHome', readOptionalString(payload, 'codexHome')),
    ...optionalSpread('sessionRoot', readOptionalString(payload, 'sessionRoot')),
    ...optionalSpread('cwd', readOptionalString(payload, 'cwd')),
  }
}

/** Validate a project import request at the wire boundary. */
function readImportBatchRequest(payload: unknown): StartImportBatchRequest {
  if (typeof payload !== 'object' || payload === null) throw new Error('threadIds are required')
  const raw = (payload as Record<string, unknown>)['threadIds']
  if (!Array.isArray(raw) || raw.length === 0 || raw.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Error('threadIds must be a non-empty array of strings')
  }
  return {
    threadIds: raw as string[],
    ...optionalSpread('codexHome', readOptionalString(payload, 'codexHome')),
    ...optionalSpread('sessionRoot', readOptionalString(payload, 'sessionRoot')),
  }
}

/** Validate one export request at the wire boundary. */
function readExportRequest(payload: unknown): StartExportRequest {
  const sessionId = readOptionalString(payload, 'sessionId')
  if (sessionId === undefined) throw new Error('sessionId is required')
  const dryRun = typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)['dryRun'] === true
    : false
  return {
    sessionId,
    dryRun,
    ...optionalSpread('codexHome', readOptionalString(payload, 'codexHome')),
    ...optionalSpread('sessionRoot', readOptionalString(payload, 'sessionRoot')),
  }
}
