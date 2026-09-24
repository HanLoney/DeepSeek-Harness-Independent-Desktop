/**
 * Pure presentation logic for the widget renderer.
 *
 * Kept free of the DOM so the decisions that are easy to get wrong — which
 * artwork a session maps to, which sound a state transition earns, when the
 * bubble retracts — can be tested directly instead of only observed by
 * watching a live window.
 */

/** Turn phases the widget displays, in the order the harness enters them. */
export const PHASE_TEXT = {
  idle: '空闲',
  thinking: '思考中',
  streaming: '生成回答',
  tools: '执行工具',
  blocked: '已中断',
}

/**
 * Labels for the reasons a turn can end. The vocabulary is merge-extensible,
 * so an unknown kind is shown verbatim rather than replaced by a default: a
 * guessed label would claim a failed turn succeeded.
 */
export const OUTCOME_TEXT = {
  completed: '完成',
  aborted: '已取消',
  error: '出错',
  blocked: '已阻塞',
  'max-tokens': '超出上限',
  interrupted: '已中断',
}

/** Outcomes that mean the turn did not finish its work. */
const FAILURE_OUTCOMES = ['error', 'blocked']

/**
 * Format a duration as m:ss.
 * @param {number} ms - duration in milliseconds.
 * @returns {string} the formatted duration.
 */
export function mmss(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
}

/**
 * Format a token count compactly.
 * @param {number} value - token count.
 * @returns {string} the formatted count.
 */
export function tokens(value) {
  return value < 1000 ? String(value) : (value / 1000).toFixed(1) + 'k'
}

/**
 * The header label for a session: its outcome once the turn has ended, its
 * phase while it runs, or the raw value when a phase or outcome is one this
 * widget does not know.
 * @param {object} session - one session snapshot.
 * @returns {string} the label to display.
 */
export function phaseLabel(session) {
  if (session.phase !== 'idle') return PHASE_TEXT[session.phase] ?? session.phase
  if (session.outcome === null) return PHASE_TEXT.idle
  return OUTCOME_TEXT[session.outcome] ?? session.outcome
}

/**
 * Whether a finished session ended badly, for styling.
 * @param {object} session - one session snapshot.
 * @returns {boolean} true when the turn failed or was blocked.
 */
export function isFailure(session) {
  return session.phase === 'idle' && FAILURE_OUTCOMES.includes(session.outcome)
}

/**
 * Which artwork state a session maps to.
 *
 * Every running phase uses the balloon artwork, because that is the one drawing
 * the thought balloon the bubble panel sits inside: a visible bubble over a
 * face-only artwork would leave the panel floating beside the whale rather than
 * inside a balloon. Celebration is passed in rather than derived from the
 * outcome, because a completed turn keeps that outcome for the rest of the
 * session's life and the celebration animation loops.
 * @param {object} session - one session snapshot.
 * @param {boolean} celebrating - whether the session is inside its celebration window.
 * @returns {'celebrate' | 'thinking' | 'idle'} the artwork role.
 */
export function whaleArt(session, celebrating) {
  if (session.phase !== 'idle') return 'thinking'
  return session.outcome === 'completed' && celebrating ? 'celebrate' : 'idle'
}

/**
 * The statistic chips to show, in display order.
 * @param {object} session - one session snapshot.
 * @returns {{ kind: string, label?: string, value: string }[]} the chips.
 */
export function statsItems(session) {
  const items = []
  if (session.tokens.output > 0) items.push({ kind: 'tokens', value: tokens(session.tokens.output) })
  if (session.stats !== null && session.stats.steps > 0) {
    items.push({ kind: 'steps', label: '步骤', value: String(session.stats.steps) })
  }
  if (session.stats !== null && session.stats.toolMs > 0) {
    items.push({ kind: 'toolMs', label: '工具', value: mmss(session.stats.toolMs) })
  }
  return items
}

/**
 * Choose the session to show: the most recent one still doing work, falling
 * back to the most recently updated session overall so a finished task stays
 * readable instead of vanishing the moment it completes.
 * @param {object[]} sessions - the snapshot's sessions, oldest activity first.
 * @returns {object | undefined} the session to display.
 */
export function pick(sessions) {
  const active = sessions.filter(session => session.phase !== 'idle')
  return active.at(-1) ?? sessions.at(-1)
}

/**
 * Summarize a todo list.
 * @param {{ items: { content: string, status: string }[], done: number, total: number }} todos - the list snapshot.
 * @returns {{ done: number, total: number, percent: number, current: string }} the display summary.
 */
export function todoSummary(todos) {
  const current = todos.items.find(item => item.status === 'in_progress')
  return {
    done: todos.done,
    total: todos.total,
    percent: todos.total === 0 ? 0 : Math.round((todos.done / todos.total) * 100),
    current: current?.content ?? '待办已清空',
  }
}

/**
 * The state the transition tracker carries between polls.
 * @param {object} session - the session the widget is about to show.
 * @param {number} now - millisecond clock.
 * @returns {object} a tracker baselined on that session.
 */
export function baselineTracker(session, now) {
  return {
    sessionId: session.sessionId,
    phase: session.phase,
    tools: session.activeTools.length,
    done: session.todos.done,
    goalRounds: session.goal?.roundsStarted ?? -1,
    // null, not 0: a millisecond clock legitimately reads zero, and a sentinel
    // that shares a value with a real timestamp makes 'never idle' and 'idle at
    // epoch' indistinguishable.
    idleSince: session.phase === 'idle' ? now : null,
  }
}

/**
 * Advance the transition tracker over the newest snapshot and report which
 * sounds the transition earned.
 *
 * A different session resets the tracker without sound: its counters describe
 * a different task, so comparing them across sessions would read another run's
 * finished todos as this one's progress and fire a completion cue the user
 * never earned.
 * @param {object} prev - the tracker from the previous poll.
 * @param {object} session - the newest session snapshot.
 * @param {number} now - millisecond clock.
 * @returns {{ tracker: object, sounds: string[] }} the next tracker and the cues to play.
 */
export function advance(prev, session, now) {
  const sameSession = prev.sessionId === session.sessionId
  const next = {
    sessionId: session.sessionId,
    phase: session.phase,
    tools: session.activeTools.length,
    done: session.todos.done,
    goalRounds: session.goal?.roundsStarted ?? -1,
    // Only a session the tracker already knows may inherit its idle clock;
    // carrying it across a switch would retract the new session's bubble on
    // the strength of the previous one's idle time.
    idleSince: session.phase !== 'idle' ? null : (sameSession && prev.idleSince !== null ? prev.idleSince : now),
  }
  if (!sameSession) return { tracker: next, sounds: [] }

  const sounds = []
  if (session.phase !== prev.phase) {
    if (prev.phase === 'idle' && session.phase !== 'idle') sounds.push('start')
    if (session.phase === 'idle') {
      if (session.outcome === 'completed') sounds.push('done')
      else if (FAILURE_OUTCOMES.includes(session.outcome)) sounds.push('fail')
    }
  }
  if (session.activeTools.length > prev.tools) sounds.push('tool')
  if (prev.done !== -1 && session.todos.done > prev.done && session.todos.done === session.todos.total) {
    sounds.push('done')
  }
  if (prev.goalRounds !== -1 && next.goalRounds > prev.goalRounds) sounds.push('goal')
  // A turn that finishes with its list already complete would otherwise play
  // the completion cue twice for one event; the duplicate carries no more
  // information than the first.
  return { tracker: next, sounds: [...new Set(sounds)] }
}

/**
 * Whether the bubble should retract.
 * @param {object} tracker - the transition tracker.
 * @param {number} now - millisecond clock.
 * @param {number} lingerMs - how long a finished task stays readable.
 * @returns {boolean} true when the bubble is past its linger window.
 */
export function shouldRetract(tracker, now, lingerMs) {
  return tracker.idleSince !== null && now - tracker.idleSince > lingerMs
}
