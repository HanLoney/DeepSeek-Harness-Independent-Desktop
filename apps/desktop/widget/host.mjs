/** Desktop widget host: derives live task progress and serves the widget surface. */

import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

/**
 * Wire shape of one progress snapshot. The widget's renderer is the only
 * consumer, so this module owns the whole vocabulary: every field below is
 * read by widget/renderer.js and by nothing else.
 */

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 10_000

/** Sessions the host keeps folded state for; the least recent are evicted. */
const MAX_RECORDS = 200

/**
 * Derive the phase a session event moves the widget into. Pure: the caller
 * owns the current snapshot and applies the result.
 * @param {string} type - session event type (turn/start, tool/call, ...).
 * @returns {string | undefined} the phase this event opens, or undefined when it moves nothing.
 */
export function phaseForEvent(type) {
  switch (type) {
    case 'turn/start':
    case 'step/start':
    case 'user/message':
      return 'thinking'
    case 'tool/call':
      return 'tools'
    case 'assistant/chunk':
      return 'streaming'
    case 'assistant/message':
      return 'thinking'
    // A turn that ends badly must not look like a turn that finished cleanly.
    case 'turn/end':
      return 'idle'
    case 'turn/blocked':
      return 'blocked'
    default:
      return undefined
  }
}

/**
 * Fold one raw session event into a mutable per-session progress record.
 * Unknown event types leave the record untouched: the session log is
 * merge-extensible, so a widget that only understands the task-shaped family
 * must ignore everything else rather than guess.
 * @param {object} record - mutable record for one session.
 * @param {object} event - the session/event frame's event field.
 * @param {number} now - millisecond clock for elapsed-time accounting.
 */
export function applyEvent(record, entry, now) {
  // History pages wrap every event in an envelope; the mux stream sends the
  // bare event. Accepting both keeps one fold for either source.
  const event = entry.event ?? entry
  const phase = phaseForEvent(event.type)
  if (phase !== undefined) {
    if (phase !== 'idle' && record.phase === 'idle') record.turnStartedAt = now
    record.phase = phase
  }
  const data = event.data ?? {}
  switch (event.type) {
    case 'turn/start':
      record.turn = data.turn ?? record.turn
      record.step = 0
      break
    case 'step/start':
      record.step = data.step ?? record.step
      break
    case 'tool/call':
      record.activeTools.push({ callId: data.callId, name: data.name, startedAt: now })
      break
    case 'tool/result': {
      const index = record.activeTools.findIndex(tool => tool.callId === data.callId)
      if (index !== -1) record.activeTools.splice(index, 1)
      break
    }
    case 'assistant/message': {
      // Token totals come from the tokenUsage projection alone. Folding this
      // event's usage too would double-count, because the projection reports
      // the same tokens for the whole log and lands slightly later.
      const reasoning = data.usage?.reasoningTokens
      if (reasoning !== undefined) record.tokens.reasoning += reasoning
      break
    }
    case 'turn/end':
      // The reason is what tells a finished task from a failed one, so the
      // whale can react differently instead of just going quiet.
      record.outcome = data.reason?.kind ?? 'completed'
      record.step = 0
      // A turn cannot leave a tool running: a cancelled turn drops its in-flight
      // calls, and keeping them would pin a stale row in the bubble forever.
      record.activeTools.length = 0
      break
    default:
      break
  }
  record.lastEventAt = now
}

/**
 * Fold one projection value change into a record. The projection keys are the
 * session-projection seam's own vocabulary; a deployment without the owning
 * plugin never sends them, which leaves the corresponding widget slot empty
 * rather than inventing a value.
 * @param {object} record - mutable record for one session.
 * @param {string} key - projection key (todos, goal, sessionStats).
 * @param {unknown} value - the frame's whole current value for that key.
 */
export function applyProjection(record, key, value) {
  if (key === 'todos') {
    const items = Array.isArray(value) ? value : []
    record.todos = items.map(item => ({
      content: String(item.content ?? ''),
      status: String(item.status ?? 'pending'),
    }))
    return
  }
  if (key === 'goal') {
    // null is the clear tombstone the projection publishes after a goal is
    // cleared, not an absent value: it must drop the displayed goal.
    record.goal = value === null || typeof value !== 'object'
      ? null
      : {
          objective: String(value.goal?.objective ?? ''),
          phase: String(value.goal?.phase ?? 'active'),
          roundsStarted: Number(value.roundsStarted ?? 0),
        }
    return
  }
  if (key === 'title' && typeof value === 'string') {
    record.title = value
    return
  }
  if (key === 'tokenUsage' && value !== null && typeof value === 'object') {
    record.tokens.input = Number(value.uncachedInputTokens ?? 0)
    record.tokens.output = Number(value.outputTokens ?? 0)
    record.tokens.cacheRead = Number(value.cacheReadTokens ?? 0)
    return
  }
  if (key === 'sessionStats' && value !== null && typeof value === 'object') {
    record.stats = {
      turns: Number(value.turns ?? 0),
      steps: Number(value.steps ?? 0),
      llmMs: Number(value.llmMs ?? 0),
      toolMs: Number(value.toolMs ?? 0),
    }
  }
}

/**
 * Build an empty record for one session.
 * @param {string} sessionId - the session this record tracks.
 * @returns {object} a fresh record.
 */
export function emptyRecord(sessionId) {
  return {
    sessionId,
    phase: 'idle',
    outcome: null,
    turn: 0,
    step: 0,
    activeTools: [],
    tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0 },
    todos: [],
    goal: null,
    stats: null,
    title: null,
    turnStartedAt: 0,
    lastEventAt: 0,
  }
}

/**
 * Project one record onto the wire snapshot, dropping the fields the renderer
 * does not read and resolving elapsed times against the current clock.
 * @param {object} record - the mutable record.
 * @param {number} now - millisecond clock.
 * @returns {object} the JSON snapshot for one session.
 */
export function snapshotOf(record, now) {
  const done = record.todos.filter(item => item.status === 'completed').length
  return {
    sessionId: record.sessionId,
    phase: record.phase,
    outcome: record.outcome,
    turn: record.turn,
    step: record.step,
    elapsedMs: record.turnStartedAt === 0 ? 0 : Math.max(0, now - record.turnStartedAt),
    activeTools: record.activeTools.map(tool => ({
      name: tool.name,
      elapsedMs: Math.max(0, now - tool.startedAt),
    })),
    tokens: { ...record.tokens },
    todos: { items: record.todos, done, total: record.todos.length },
    goal: record.goal,
    stats: record.stats,
    title: record.title,
  }
}

/**
 * Whether a snapshot carries anything worth showing. An idle session with no
 * todo list, no goal, and no tokens has nothing to draw, and the widget window
 * hides itself rather than floating an empty frame.
 * @param {object} snapshot - one projected session snapshot.
 * @returns {boolean} true when the widget has something to display.
 */
export function isActive(snapshot) {
  return snapshot.phase !== 'idle'
    || snapshot.todos.total > 0
    || snapshot.goal !== null
    || snapshot.tokens.output > 0
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  // .mjs as well as .js: the renderer imports ES modules, and a module served
  // as octet-stream is refused by the browser before its code runs.
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
}

/**
 * Owns the widget's data plane: one upstream mux socket, one folded record per
 * session, and the HTTP surface the Electron window loads.
 *
 * The carrier is deliberately one-way and lossy-tolerant. Upstream pushes
 * frames; the renderer polls the state route, so a reloaded window recovers on
 * its next poll and the widget never needs a second transport.
 */
export class WidgetHost {
  #backendUrl
  #root
  #records = new Map()
  #socket
  #reconnectMs = RECONNECT_MIN_MS
  #closed = false
  #cancelReconnect

  /**
   * @param {string} backendUrl - loopback origin of the dsh backend.
   * @param {string} root - widget asset directory.
   */
  constructor(backendUrl, root) {
    this.#backendUrl = backendUrl
    // Normalize once: the containment check below compares resolved paths, so
    // a root passed with forward slashes would reject every legitimate asset
    // on Windows.
    this.#root = resolve(root)
  }

  /** Start the upstream subscription. Reconnects until closed. */
  start() {
    this.#open()
  }

  /** Stop the upstream subscription and cancel any pending reconnect. */
  close() {
    this.#closed = true
    if (this.#cancelReconnect !== undefined) this.#cancelReconnect()
    this.#socket?.close()
    this.#socket = undefined
  }

  /**
   * Seed one projection value read from a session.list baseline.
   * @param {string} sessionId - the owning session.
   * @param {string} key - projection key.
   * @param {unknown} value - the baseline whole value.
   */
  seedProjection(sessionId, key, value) {
    applyProjection(this.#record(sessionId), key, value)
  }

  /**
   * Seed a session's last-activity time from a baseline row.
   * @param {string} sessionId - the owning session.
   * @param {number} at - the session's last-activity timestamp.
   */
  seedRecency(sessionId, at) {
    const record = this.#record(sessionId)
    if (record.lastEventAt === 0) record.lastEventAt = at
  }

  /**
   * The current snapshot for every session with progress to show.
   * @returns {object} the payload the renderer polls for.
   */
  snapshot() {
    const now = Date.now()
    // Ordered by most recent activity: the renderer shows the last entry, so
    // the order is the selection rule and cannot be left to Map insertion.
    const sessions = [...this.#records.values()]
      .sort((a, b) => a.lastEventAt - b.lastEventAt)
      .map(record => snapshotOf(record, now))
      .filter(isActive)
    return { sessions }
  }

  /**
   * Serve one widget request. Asset paths resolve inside the widget root only;
   * a path escaping that root is refused rather than read.
   * @param {import('node:http').IncomingMessage} req - the request.
   * @param {import('node:http').ServerResponse} res - the response.
   * @returns {Promise<void>} completion after the response is written.
   */
  async handle(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/widget/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(this.snapshot()))
      return
    }
    const relative = pathname === '/widget' || pathname === '/widget/'
      ? 'index.html'
      : pathname.slice('/widget/'.length)
    const target = resolve(normalize(join(this.#root, decodeURIComponent(relative))))
    if (target !== this.#root && !target.startsWith(this.#root + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      const body = await readFile(target)
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  }

  #record(sessionId) {
    let record = this.#records.get(sessionId)
    if (record !== undefined) return record
    record = emptyRecord(sessionId)
    this.#records.set(sessionId, record)
    // A long-running desktop touches unboundedly many sessions; the oldest
    // records are dropped so the widget's footprint stays flat. A dropped
    // session that becomes active again is re-created by the next frame it
    // sends, so eviction costs only a stale row, never a missing one.
    while (this.#records.size > MAX_RECORDS) {
      let oldestId
      let oldestAt = Infinity
      for (const [id, entry] of this.#records) {
        if (id !== sessionId && entry.lastEventAt < oldestAt) {
          oldestAt = entry.lastEventAt
          oldestId = id
        }
      }
      if (oldestId === undefined) break
      this.#records.delete(oldestId)
    }
    return record
  }

  #open() {
    if (this.#closed) return
    const url = this.#backendUrl.replace(/^http/, 'ws') + '/api/events.mux'
    const socket = new WebSocket(url)
    this.#socket = socket
    socket.addEventListener('message', (message) => { this.#receive(message.data) })
    socket.addEventListener('open', () => { this.#reconnectMs = RECONNECT_MIN_MS })
    socket.addEventListener('close', () => { this.#scheduleReconnect() })
    socket.addEventListener('error', () => { socket.close() })
  }

  #scheduleReconnect() {
    if (this.#closed) return
    const delay = this.#reconnectMs
    this.#reconnectMs = Math.min(RECONNECT_MAX_MS, this.#reconnectMs * 2)
    const timer = setTimeout(() => { this.#open() }, delay)
    this.#cancelReconnect = () => { clearTimeout(timer) }
  }

  #receive(raw) {
    let frame
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }
    if (frame?.type !== 'server-request') return
    const payload = frame.payload
    const now = Date.now()
    if (payload?.type === 'session/event') {
      applyEvent(this.#record(payload.sessionId), payload.event, now)
      return
    }
    if (payload?.type === 'session/projection') {
      applyProjection(this.#record(payload.sessionId), payload.key, payload.value)
      return
    }
  }
}

/**
 * Seed per-session baseline projections the mux stream does not replay. The
 * stream pushes projection changes only, so a widget opened mid-task would
 * otherwise show no todo list and no goal until each next changes.
 * @param {WidgetHost} host - the host to seed.
 * @param {string} backendUrl - loopback origin of the dsh backend.
 * @returns {Promise<void>} completion after the baseline read settles.
 */
export async function seedBaseline(host, backendUrl) {
  let items
  try {
    const response = await fetch(backendUrl + '/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method: 'session.list',
        payload: {},
      }),
    })
    const body = await response.json()
    if (body?.result?.ok !== true) return
    items = body.result.value.items
  } catch {
    return
  }
  for (const item of items) {
    // The seeded record carries the session's own recency. Without it every
    // baseline record would sit at zero and the snapshot's ordering — which is
    // how the renderer chooses its session — would fall back to Map insertion
    // order, letting an arbitrarily old session win.
    host.seedRecency(item.sessionId, typeof item.updatedAt === 'number' ? item.updatedAt : 0)
    for (const [key, value] of Object.entries(item.projections?.values ?? {})) {
      host.seedProjection(item.sessionId, key, value)
    }
  }
}
