/** Presentation-logic tests: the renderer's decisions, without a DOM. */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advance, baselineTracker, isFailure, mmss, phaseLabel, pick, shouldRetract,
  statsItems, todoSummary, tokens, whaleArt,
} from '../widget/view.mjs'

/** A session snapshot with every field the view layer reads. */
function session(overrides = {}) {
  return {
    sessionId: 's1',
    phase: 'idle',
    outcome: null,
    elapsedMs: 0,
    activeTools: [],
    tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0 },
    todos: { items: [], done: 0, total: 0 },
    goal: null,
    stats: null,
    title: null,
    ...overrides,
  }
}

test('formats durations as m:ss and clamps negatives', () => {
  assert.equal(mmss(0), '0:00')
  assert.equal(mmss(59_400), '0:59')
  assert.equal(mmss(60_000), '1:00')
  assert.equal(mmss(7_000_000), '116:40')
  // A clock that runs backwards mid-turn must not print a negative duration.
  assert.equal(mmss(-5_000), '0:00')
})

test('formats token counts compactly', () => {
  assert.equal(tokens(0), '0')
  assert.equal(tokens(999), '999')
  assert.equal(tokens(1_000), '1.0k')
  assert.equal(tokens(56_389), '56.4k')
})

test('labels a running session by phase and a finished one by outcome', () => {
  assert.equal(phaseLabel(session({ phase: 'tools' })), '执行工具')
  assert.equal(phaseLabel(session({ phase: 'idle', outcome: 'completed' })), '完成')
  assert.equal(phaseLabel(session({ phase: 'idle', outcome: 'aborted' })), '已取消')
  // A phase and an outcome this widget has never seen are shown verbatim: a
  // guessed label would claim a turn succeeded when it may have failed.
  assert.equal(phaseLabel(session({ phase: 'future-phase' })), 'future-phase')
  assert.equal(phaseLabel(session({ phase: 'idle', outcome: 'future-outcome' })), 'future-outcome')
})

test('treats error and blocked outcomes as failures', () => {
  assert.equal(isFailure(session({ phase: 'idle', outcome: 'error' })), true)
  assert.equal(isFailure(session({ phase: 'idle', outcome: 'blocked' })), true)
  // A cancelled turn is not styled as a failure: the user asked for it.
  assert.equal(isFailure(session({ phase: 'idle', outcome: 'aborted' })), false)
  assert.equal(isFailure(session({ phase: 'tools', outcome: 'error' })), false)
})

test('gives a completed turn the celebration artwork and other endings none', () => {
  assert.equal(whaleArt(session({ phase: 'idle', outcome: 'completed' }), true), 'celebrate')
  assert.equal(whaleArt(session({ phase: 'idle', outcome: 'error' }), true), 'idle')
  assert.equal(whaleArt(session({ phase: 'idle', outcome: null }), true), 'idle')
})

test('uses the balloon artwork for every running phase', () => {
  // The bubble panel is positioned inside a thought balloon that only the
  // working artwork draws. A face-only artwork during a running phase would
  // leave the panel's text outside the balloon it is meant to be spoken into.
  for (const phase of ['thinking', 'streaming', 'tools', 'blocked']) {
    assert.equal(whaleArt(session({ phase }), true), 'thinking', phase)
    assert.equal(whaleArt(session({ phase }), false), 'thinking', phase)
  }
})

test('stops celebrating once the celebration window closes', () => {
  // A completed turn keeps its outcome for the rest of the session's life, and
  // the celebration animation loops. Deriving the artwork from the outcome
  // alone leaves the whale celebrating forever.
  const done = session({ phase: 'idle', outcome: 'completed' })
  assert.equal(whaleArt(done, true), 'celebrate')
  assert.equal(whaleArt(done, false), 'idle')
  // A running turn is unaffected: it is working, not celebrating.
  assert.equal(whaleArt(session({ phase: 'tools' }), false), 'thinking')
})

test('shows statistic chips only once each figure exists', () => {
  assert.deepEqual(statsItems(session()), [])
  const full = session({
    tokens: { input: 0, output: 56_389, cacheRead: 0, reasoning: 0 },
    stats: { turns: 4, steps: 85, llmMs: 1, toolMs: 482_000 },
  })
  assert.deepEqual(statsItems(full), [
    { kind: 'tokens', value: '56.4k' },
    { kind: 'steps', label: '步骤', value: '85' },
    { kind: 'toolMs', label: '工具', value: '8:02' },
  ])
})

test('summarizes todo progress including the in-progress item', () => {
  const todos = {
    items: [
      { content: 'done one', status: 'completed' },
      { content: 'current one', status: 'in_progress' },
      { content: 'later one', status: 'pending' },
    ],
    done: 1,
    total: 3,
  }
  assert.deepEqual(todoSummary(todos), {
    done: 1, total: 3, percent: 33, current: 'current one',
  })
  // A cleared list must not divide by zero or name a phantom item.
  assert.deepEqual(todoSummary({ items: [], done: 0, total: 0 }), {
    done: 0, total: 0, percent: 0, current: '待办已清空',
  })
})

test('earns a start cue when a task begins and a done cue when it finishes', () => {
  const idle = baselineTracker(session())
  const running = session({ phase: 'thinking' })
  const { tracker, sounds } = advance(idle, running, 1_000)
  assert.deepEqual(sounds, ['start'])

  const finished = session({ phase: 'idle', outcome: 'completed' })
  assert.deepEqual(advance(tracker, finished, 2_000).sounds, ['done'])
})

test('stays silent across a steady poll', () => {
  const running = session({ phase: 'tools', activeTools: [{ name: 'pwsh', elapsedMs: 10 }] })
  const first = advance(baselineTracker(running), running, 1_000).tracker
  assert.deepEqual(advance(first, running, 1_400).sounds, [])
  assert.deepEqual(advance(first, running, 1_800).sounds, [])
})

test('plays a failure cue for an error or blocked turn, but not a cancellation', () => {
  const running = session({ phase: 'tools' })
  const tracker = advance(baselineTracker(running), running, 0).tracker
  assert.deepEqual(advance(tracker, session({ phase: 'idle', outcome: 'error' }), 1).sounds, ['fail'])
  assert.deepEqual(advance(tracker, session({ phase: 'idle', outcome: 'blocked' }), 1).sounds, ['fail'])
  // A turn the user cancelled ends quietly: an alarm would misreport it.
  assert.deepEqual(advance(tracker, session({ phase: 'idle', outcome: 'aborted' }), 1).sounds, [])
})

test('cues a tool only when a new one starts', () => {
  const one = session({ phase: 'tools', activeTools: [{ name: 'pwsh', elapsedMs: 0 }] })
  const first = advance(baselineTracker(one), one, 0).tracker
  assert.deepEqual(advance(first, one, 100).sounds, [])

  const two = session({
    phase: 'tools',
    activeTools: [{ name: 'pwsh', elapsedMs: 0 }, { name: 'edit', elapsedMs: 0 }],
  })
  assert.deepEqual(advance(first, two, 200).sounds, ['tool'])
})

test('celebrates a todo list only when it becomes complete', () => {
  const partial = session({ phase: 'tools', todos: { items: [], done: 1, total: 3 } })
  const tracker = advance(baselineTracker(partial), partial, 0).tracker
  const midway = session({ phase: 'tools', todos: { items: [], done: 2, total: 3 } })
  assert.deepEqual(advance(tracker, midway, 1).sounds, [])

  const complete = session({ phase: 'tools', todos: { items: [], done: 3, total: 3 } })
  assert.deepEqual(advance(advance(tracker, midway, 1).tracker, complete, 2).sounds, ['done'])
})

test('does not sound progress that happened before the widget opened', () => {
  // The first sighting of an already-finished session is a baseline, not a
  // transition: opening the widget must not replay a run the user already saw.
  // baselineTracker captures the finished state as the starting point, which is
  // exactly what the renderer does when it first sees a session.
  const finished = session({
    phase: 'idle', outcome: 'completed', todos: { items: [], done: 3, total: 3 },
  })
  assert.deepEqual(advance(baselineTracker(finished), finished, 0).sounds, [])
})

test('resets the tracker across sessions without firing their cues', () => {
  const first = session({ sessionId: 's1', phase: 'idle', outcome: 'completed', todos: { items: [], done: 3, total: 3 } })
  const tracker = advance(baselineTracker(session({ sessionId: 's1', phase: 'tools' })), first, 0).tracker
  // A second session starting must not read the first one's finished todos or
  // completed turn as this session's progress.
  const second = session({ sessionId: 's2', phase: 'thinking' })
  const next = advance(tracker, second, 5_000)
  assert.deepEqual(next.sounds, [])
  assert.equal(next.tracker.sessionId, 's2')
  assert.equal(next.tracker.done, 0)
  assert.equal(next.tracker.idleSince, null)
})

test('retracts the bubble only after a finished task has lingered', () => {
  const finished = session({ phase: 'idle', outcome: 'completed' })
  // The baseline reads the wall clock, so it is replaced by the advance call
  // under test rather than relied on for a deterministic idle start.
  const tracker = advance(baselineTracker(session({ phase: 'tools' })), finished, 10_000).tracker
  assert.equal(shouldRetract(tracker, 11_000, 6_000), false)
  assert.equal(shouldRetract(tracker, 16_000, 6_000), false)
  assert.equal(shouldRetract(tracker, 16_001, 6_000), true)

  // A running turn never retracts, however long it runs.
  const running = session({ phase: 'tools' })
  const busy = advance(baselineTracker(running), running, 0).tracker
  assert.equal(shouldRetract(busy, 10_000_000, 6_000), false)
})

test('restarts the linger window when a task resumes', () => {
  const finished = session({ phase: 'idle', outcome: 'completed' })
  const linger = advance(baselineTracker(session({ phase: 'tools' })), finished, 0).tracker
  assert.equal(shouldRetract(linger, 7_000, 6_000), true)

  // A new turn clears the idle clock, so the bubble returns and stays.
  const resumed = session({ phase: 'thinking' })
  const running = advance(linger, resumed, 8_000).tracker
  assert.equal(shouldRetract(running, 20_000, 6_000), false)
})
test('picks the running session over a more recently finished one', () => {
  const finished = session({ sessionId: 'done', phase: 'idle' })
  const running = session({ sessionId: 'busy', phase: 'tools' })
  // Ordered oldest-activity-first by the host; the last entry is the newest.
  assert.equal(pick([finished, running]).sessionId, 'busy')
  // With nothing running, the newest entry still shows so a just-finished
  // task stays readable instead of vanishing the moment it completes.
  assert.equal(pick([finished]).sessionId, 'done')
  assert.equal(pick([]), undefined)
})
