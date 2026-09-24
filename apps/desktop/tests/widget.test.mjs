import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEvent, applyProjection, emptyRecord, isActive, phaseForEvent, snapshotOf, WidgetHost,
} from '../widget/host.mjs'

test('maps session event types onto widget phases', () => {
  assert.equal(phaseForEvent('turn/start'), 'thinking')
  assert.equal(phaseForEvent('step/start'), 'thinking')
  assert.equal(phaseForEvent('tool/call'), 'tools')
  assert.equal(phaseForEvent('assistant/chunk'), 'streaming')
  assert.equal(phaseForEvent('assistant/message'), 'thinking')
  assert.equal(phaseForEvent('turn/end'), 'idle')
  // The session log is merge-extensible: an event this widget does not know
  // must move nothing rather than guess a phase.
  assert.equal(phaseForEvent('some/future-event'), undefined)
})

test('folds a turn into phase, counters and tool lifetime', () => {
  const record = emptyRecord('s1')
  applyEvent(record, { type: 'turn/start', data: { turn: 3 } }, 1000)
  assert.equal(record.phase, 'thinking')
  assert.equal(record.turn, 3)
  assert.equal(record.turnStartedAt, 1000)

  applyEvent(record, { type: 'step/start', data: { turn: 3, step: 2 } }, 1100)
  assert.equal(record.step, 2)

  applyEvent(record, { type: 'tool/call', data: { callId: 'c1', name: 'pwsh' } }, 1200)
  applyEvent(record, { type: 'tool/call', data: { callId: 'c2', name: 'read' } }, 1300)
  assert.equal(record.phase, 'tools')
  assert.deepEqual(record.activeTools.map(tool => tool.name), ['pwsh', 'read'])

  applyEvent(record, { type: 'tool/result', data: { callId: 'c1' } }, 1400)
  assert.deepEqual(record.activeTools.map(tool => tool.name), ['read'])

  applyEvent(record, {
    type: 'assistant/message',
    data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, reasoningTokens: 7 } },
  }, 1500)
  // Token totals are the projection's, not this event's: folding the event's
  // usage as well would double-count the same tokens.
  assert.deepEqual(record.tokens, { input: 0, output: 0, cacheRead: 0, reasoning: 7 })
  applyProjection(record, 'tokenUsage', {
    uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0,
  })
  assert.equal(record.tokens.output, 20)

  applyEvent(record, { type: 'turn/end', data: { turn: 3, reason: 'success' } }, 1600)
  assert.equal(record.phase, 'idle')
  // Elapsed time anchors on the turn's start, so it survives the idle phase.
  assert.equal(snapshotOf(record, 4600).elapsedMs, 3600)
})

test('takes token totals from the whole-log projection, not per-step usage', () => {
  const record = emptyRecord('s1')
  // The projection reports the running total for the entire log, so repeated
  // frames replace it rather than accumulating — a widget that added them
  // would report a multiple of the real figure.
  applyProjection(record, 'tokenUsage', { uncachedInputTokens: 10, outputTokens: 1 })
  applyProjection(record, 'tokenUsage', { uncachedInputTokens: 30, outputTokens: 3 })
  assert.equal(record.tokens.input, 30)
  assert.equal(record.tokens.output, 3)
})

test('folds projection values for todos, goal and stats', () => {
  const record = emptyRecord('s1')
  applyProjection(record, 'todos', [
    { content: 'first', status: 'completed' },
    { content: 'second', status: 'in_progress' },
  ])
  assert.equal(record.todos.length, 2)

  applyProjection(record, 'goal', {
    goal: { objective: 'ship the widget', phase: 'active' },
    roundsStarted: 4,
  })
  assert.equal(record.goal.objective, 'ship the widget')
  assert.equal(record.goal.roundsStarted, 4)

  applyProjection(record, 'sessionStats', { turns: 2, steps: 5, llmMs: 900, toolMs: 300 })
  assert.equal(record.stats.steps, 5)

  // A cleared goal is the tombstone value, not an absent key.
  applyProjection(record, 'goal', null)
  assert.equal(record.goal, null)
})

test('projects a snapshot the renderer can read', () => {
  const record = emptyRecord('s1')
  applyProjection(record, 'todos', [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'pending' },
  ])
  applyEvent(record, { type: 'tool/call', data: { callId: 'c1', name: 'pwsh' } }, 0)
  const snapshot = snapshotOf(record, 5000)
  assert.equal(snapshot.todos.done, 1)
  assert.equal(snapshot.todos.total, 2)
  assert.deepEqual(snapshot.activeTools.map(tool => tool.elapsedMs), [5000])
})

test('treats a session with nothing to show as inactive', () => {
  const record = emptyRecord('s1')
  assert.equal(isActive(snapshotOf(record, 0)), false)
  applyEvent(record, { type: 'turn/start', data: { turn: 1 } }, 0)
  assert.equal(isActive(snapshotOf(record, 0)), true)
})

test('omits inactive sessions from the served snapshot', () => {
  const host = new WidgetHost('http://127.0.0.1:1', '.')
  assert.deepEqual(host.snapshot(), { sessions: [] })
})
test('drops in-flight tools when a turn ends', () => {
  const record = emptyRecord('s1')
  applyEvent(record, { type: 'turn/start', data: { turn: 1 } }, 0)
  applyEvent(record, { type: 'tool/call', data: { callId: 'c1', name: 'pwsh' } }, 10)
  assert.equal(record.activeTools.length, 1)
  applyEvent(record, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } } }, 20)
  assert.deepEqual(record.activeTools, [])
  assert.equal(snapshotOf(record, 20).activeTools.length, 0)
})

test('records why a turn ended', () => {
  const record = emptyRecord('s1')
  applyEvent(record, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } }, 0)
  assert.equal(snapshotOf(record, 0).outcome, 'error')

  // A reason kind this widget has never seen still lands, so an extended
  // vocabulary degrades to an unknown label instead of a stale one.
  applyEvent(record, { type: 'turn/end', data: { turn: 2, reason: { kind: 'future-kind' } } }, 0)
  assert.equal(snapshotOf(record, 0).outcome, 'future-kind')
})

test('serves assets and refuses paths outside the widget root', async () => {
  const { fileURLToPath } = await import('node:url')
  const { createServer } = await import('node:http')
  const root = fileURLToPath(new URL('../widget/', import.meta.url))
  const host = new WidgetHost('http://127.0.0.1:1', root)
  const server = createServer((req, res) => { void host.handle(req, res) })
  await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const index = await fetch(base + '/widget/')
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type'), /text\/html/)

    const style = await fetch(base + '/widget/widget.css')
    assert.equal(style.status, 200)

    assert.equal((await fetch(base + '/widget/missing.js')).status, 404)
    // Traversal must be refused, not merely resolve to a 404.
    assert.equal((await fetch(base + '/widget/%2e%2e%2f%2e%2e%2fpackage.json')).status, 403)

    const state = await fetch(base + '/widget/state')
    assert.equal(state.status, 200)
    assert.deepEqual(await state.json(), { sessions: [] })
  } finally {
    server.close()
    host.close()
  }
})
test('supplies every option the widget window host reads', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const windowSource = readFileSync(fileURLToPath(new URL('../widget/window.mjs', import.meta.url)), 'utf8')
  const mainSource = readFileSync(fileURLToPath(new URL('../main.mjs', import.meta.url)), 'utf8')

  // An option the host reads but the caller never passes fails silently in
  // Electron — the preload path did exactly that, leaving the window
  // permanently click-through — so the two lists are checked against
  // each other rather than trusted to stay in step by hand.
  const used = [...new Set([...windowSource.matchAll(/options\.([A-Za-z]+)/g)].map(match => match[1]))]
  // The options live in one factory so the startup path and the settings
  // watcher cannot drift apart; read that factory, not the call site.
  const factory = mainSource.slice(mainSource.indexOf('function widgetOptions('))
  const body = factory.slice(0, factory.indexOf('\n}'))
  const passed = [...body.matchAll(/^\s*([A-Za-z]+)[,:]/gm)].map(match => match[1])

  assert.deepEqual(used.filter(name => !passed.includes(name)), [])
  assert.ok(used.includes('preloadPath'), 'the preload path is what keeps the window clickable')
})
test('orders sessions by recency so the renderer picks the newest', () => {
  const host = new WidgetHost('http://127.0.0.1:1', '.')
  // Two sessions with progress, the older one folded first. The snapshot order
  // is the renderer's selection rule, so it cannot follow Map insertion.
  host.seedProjection('old', 'tokenUsage', { outputTokens: 10 })
  host.seedRecency('old', 1_000)
  host.seedProjection('new', 'tokenUsage', { outputTokens: 20 })
  host.seedRecency('new', 2_000)
  assert.deepEqual(host.snapshot().sessions.map(s => s.sessionId), ['old', 'new'])
  host.close()
})

test('keeps the most recent sessions when the record map is evicted', () => {
  const host = new WidgetHost('http://127.0.0.1:1', '.')
  // A desktop run touches unboundedly many sessions, so the host caps its map.
  // Seeding past the cap must drop the oldest and keep the newest readable.
  const total = 260
  for (let index = 0; index < total; index += 1) {
    host.seedProjection('s' + index, 'tokenUsage', { outputTokens: 1 })
    host.seedRecency('s' + index, index + 1)
  }
  const ids = host.snapshot().sessions.map(s => s.sessionId)
  assert.ok(ids.length <= 200, 'evicted down to the cap, got ' + ids.length)
  assert.equal(ids.at(-1), 's' + (total - 1))
  assert.ok(!ids.includes('s0'), 'the oldest session was evicted')
  host.close()
})
test('gives the renderer every element id it looks up', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const renderer = readFileSync(fileURLToPath(new URL('../widget/renderer.js', import.meta.url)), 'utf8')
  const html = readFileSync(fileURLToPath(new URL('../widget/index.html', import.meta.url)), 'utf8')

  // The renderer resolves nodes once at load, so an id present in one file and
  // absent from the other fails at the first paint — in the widget window,
  // which has no visible console.
  const looked = [...new Set([...renderer.matchAll(/el\('([^']+)'\)/g)].map(match => match[1]))]
  const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]))
  assert.deepEqual(looked.filter(id => !declared.has(id)), [])
  assert.ok(looked.length > 10, 'the renderer looks up its whole surface')
})

test('stacks the bubble above the artwork that draws its balloon', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const css = readFileSync(fileURLToPath(new URL('../widget/widget.css', import.meta.url)), 'utf8')

  // The bubble is positioned inside a thought balloon painted into the working
  // artwork. Both are positioned with no z-index by default, so the artwork —
  // which comes later in the DOM — would cover the panel and hide every figure
  // behind the balloon, with nothing failing anywhere.
  // Strip comments first, so a selector named in prose cannot stand in for the
  // rule that carries the stacking level.
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const zIndex = (selector) => {
    const rule = rules.find(match => match[1].split(',').map(s => s.trim()).includes(selector))
    assert.ok(rule, selector + ' has a rule block')
    return Number(/z-index:\s*(\d+)/.exec(rule[2])?.[1] ?? 0)
  }
  assert.ok(zIndex('#whale') >= 1, 'the artwork has a stacking level')
  assert.ok(zIndex('.bubble') > zIndex('#whale'), 'the bubble paints above the artwork')
})

test('gives the text a surface for every artwork, balloon or not', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const css = readFileSync(fileURLToPath(new URL('../widget/widget.css', import.meta.url)), 'utf8')
  const renderer = readFileSync(fileURLToPath(new URL('../widget/renderer.js', import.meta.url)), 'utf8')
  const { whaleArt } = await import('../widget/view.mjs')

  // Only the working artwork draws a balloon. The closing states must place the
  // text on a surface of its own, or it renders as loose glyphs on the desktop.
  const arts = new Set([
    whaleArt({ phase: 'tools' }, false), whaleArt({ phase: 'idle', outcome: 'completed' }, true),
    whaleArt({ phase: 'idle', outcome: 'error' }, false),
  ])
  const styled = new Set([...css.matchAll(/\.bubble\[data-art="([^"]+)"\]/g)].map(m => m[1]))
  assert.deepEqual([...arts].filter(art => !styled.has(art)), [])
  // The base rule must not carry geometry, which only one artwork can satisfy.
  const base = /\.bubble\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.ok(!/(^|\s)(left|bottom|width)\s*:/.test(base), 'geometry comes from the artwork state')
  assert.match(renderer, /bubble\.dataset\.art = art/)
})

test('breathes the balloon text with the artwork that draws its balloon', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const css = readFileSync(fileURLToPath(new URL('../widget/widget.css', import.meta.url)), 'utf8')
  const renderer = readFileSync(fileURLToPath(new URL('../widget/renderer.js', import.meta.url)), 'utf8')

  // The balloon is part of the artwork, so animating the image alone slides it
  // out from under text that stays put. Both must carry the motion, from the
  // same decision and the same timing declaration.
  assert.match(css, /#whale\.working,\s*\n\s*\.bubble\.working\s*\{[^}]*animation:/)
  assert.match(renderer, /bubble\.classList\.toggle\('working', working\)/)
  assert.match(renderer, /whale\.classList\.toggle\('working', working\)/)

  // The text rides the rise but not the swell: scaling small glyphs blurs them.
  const textFrames = /@keyframes bob-text\s*\{([^@]*)\}\s*$/m.exec(css)?.[1] ?? ''
  assert.ok(!textFrames.includes('scale'), 'the text keyframes do not scale')
})

test('keeps attribute hiding working against layout rules', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const css = readFileSync(fileURLToPath(new URL('../widget/widget.css', import.meta.url)), 'utf8')

  // Several hidden elements carry a class with its own `display`, which outranks
  // the user agent's `[hidden]` rule. Without an overriding rule the renderer's
  // `node.hidden = true` sets the attribute and changes nothing on screen.
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/)
})

test('references only assets that ship with the widget', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../widget/', import.meta.url))
  const present = new Set(readdirSync(new URL('../widget/assets/', import.meta.url)))

  // Assets are the part of this feature that cannot be regenerated, so a
  // renamed or missing file must fail a test rather than a silent 404 in the
  // widget window.
  for (const file of ['renderer.js', 'widget.css', 'index.html']) {
    const source = readFileSync(root + file, 'utf8')
    for (const match of source.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) {
      assert.ok(present.has(match[1]), file + ' references missing asset ' + match[1])
    }
  }
})
test('serves every widget module with an executable content type', async () => {
  const { fileURLToPath } = await import('node:url')
  const { createServer } = await import('node:http')
  const root = fileURLToPath(new URL('../widget/', import.meta.url))
  const host = new WidgetHost('http://127.0.0.1:1', root)
  const server = createServer((req, res) => { void host.handle(req, res) })
  await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const base = 'http://127.0.0.1:' + server.address().port + '/widget/'
  try {
    // A module served as octet-stream never executes: the browser refuses it
    // before the import resolves, and the widget window goes blank.
    for (const file of ['renderer.js', 'view.mjs']) {
      const response = await fetch(base + file)
      assert.equal(response.status, 200, file + ' must be served')
      assert.match(response.headers.get('content-type'), /text\/javascript/, file + ' must be executable')
    }
  } finally {
    server.close()
    host.close()
  }
})
test('never binds a port Chromium refuses to load', async () => {
  // An OS-assigned port can land on one Chromium blocks, and loading the
  // widget from it fails with ERR_UNSAFE_PORT and a permanently blank window.
  // The chosen port is asserted against Chromium's restricted set directly.
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const source = readFileSync(fileURLToPath(new URL('../widget/window.mjs', import.meta.url)), 'utf8')
  assert.match(source, /RESTRICTED_PORTS/, 'the restricted set is declared')
  assert.match(source, /listenOnUsablePort\(server\)/, 'the server binds through the guard')
  assert.ok(!/port: 0 \}\)\)\n\s*const port/.test(source), 'no direct unguarded bind remains')
  // The ports an ephemeral allocation can realistically reach are all covered.
  for (const port of [2049, 4045, 6000, 6665, 6666, 6667, 6668, 6669, 6697, 10080]) {
    assert.match(source, new RegExp('\\b' + port + '\\b'), 'port ' + port + ' is listed')
  }
})
