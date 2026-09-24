/**
 * Widget renderer: polls the host's state route and paints the whale bubble.
 *
 * Every paint is a pure function of the newest snapshot, so a reloaded window,
 * a reconnected backend and the first paint all take the same path. The
 * decisions behind each paint — artwork, labels, sound cues, retraction — live
 * in view.mjs, which has no DOM and is therefore tested directly.
 */

import {
  advance, baselineTracker, isFailure, mmss, phaseLabel, pick, shouldRetract,
  statsItems, todoSummary, whaleArt,
} from './view.mjs'

const POLL_MS = 400
const LINGER_MS = 6000

/** Artwork roles: each file carries one state, never a decorative duplicate. */
const ART = {
  idle: '/widget/assets/DSniang1.png',
  thinking: '/widget/assets/DSniang02.png',
  celebrate: '/widget/assets/bubble-petpet.gif',
  coin: '/widget/assets/bubble-money1.gif',
}

const SOUND = {
  start: '/widget/assets/Ya1.mp3',
  tool: '/widget/assets/D1.mp3',
  done: '/widget/assets/minecraft-exp-orb.wav',
  fail: '/widget/assets/D2.mp3',
  goal: '/widget/assets/task-end-a.wav',
  toggle: '/widget/assets/Ya2.mp3',
}

const el = id => document.getElementById(id)
const whale = el('whale')
const bubble = el('bubble')
const titleEl = el('title')
const phaseEl = el('phase')
const clockEl = el('clock')
const toolsEl = el('tools')
const todosEl = el('todos')
const todosCountEl = el('todos-count')
const todosFillEl = el('todos-fill')
const todosCurrentEl = el('todos-current')
const goalEl = el('goal')
const goalRoundsEl = el('goal-rounds')
const goalTextEl = el('goal-text')
const statsEl = el('stats')
const muteEl = el('mute')

let soundOn = true

/** Play one effect; a blocked or missing asset stays silent and never breaks the paint. */
function play(kind) {
  if (!soundOn) return
  const audio = new Audio(SOUND[kind])
  audio.volume = 0.4
  audio.play().catch(() => {})
}

/**
 * Paint the whale for the current phase and outcome.
 * @param {object} session - one session snapshot.
 * @param {boolean} celebrating - whether the session is inside its celebration window.
 */
function paintWhale(session, celebrating) {
  const art = whaleArt(session, celebrating)
  const src = ART[art]
  if (!whale.src.endsWith(src)) whale.src = src
  // The stylesheet sizes each artwork; the balloon one is much larger because
  // the bubble's text is positioned inside a balloon drawn into it. The text
  // reads the same state, because only that artwork gives it a balloon to sit
  // in — the closing states place it on a surface of its own instead.
  whale.dataset.art = art
  bubble.dataset.art = art
  // Only the resting whale is still: every working state bobs, so the window
  // reads as busy even when the bubble has retracted. The text rides the same
  // motion from the same decision, because the balloon it sits in is painted
  // into the artwork — animating one without the other slides them apart.
  const working = art !== 'idle'
  whale.classList.toggle('working', working)
  bubble.classList.toggle('working', working)
}

/** Replace a node's children with the given rows. */
function fill(node, rows) {
  node.replaceChildren(...rows)
}

/** Build one row with a leading label and a trailing value. */
function row(className, label, value) {
  const line = document.createElement('div')
  line.className = className
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = label
  const detail = document.createElement('span')
  detail.className = 'ms'
  detail.textContent = value
  line.append(name, detail)
  return line
}

function render(session, celebrating) {
  paintWhale(session, celebrating)

  titleEl.textContent = session.title ?? ''
  titleEl.hidden = session.title === null || session.title === ''

  phaseEl.textContent = phaseLabel(session)
  phaseEl.dataset.phase = session.phase
  phaseEl.dataset.failure = String(isFailure(session))
  clockEl.textContent = mmss(session.elapsedMs)

  fill(toolsEl, session.activeTools.slice(0, 3).map(tool =>
    row('tool', tool.name, mmss(tool.elapsedMs))))

  const todos = todoSummary(session.todos)
  todosEl.hidden = todos.total === 0
  if (todos.total > 0) {
    todosCountEl.textContent = todos.done + ' / ' + todos.total
    todosFillEl.style.width = todos.percent + '%'
    todosCurrentEl.textContent = todos.current
  }

  goalEl.hidden = session.goal === null
  if (session.goal !== null) {
    goalTextEl.textContent = session.goal.objective
    goalRoundsEl.textContent = session.goal.roundsStarted + ' 轮'
  }

  const items = statsItems(session)
  fill(statsEl, items.map((item) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    if (item.kind === 'tokens') {
      const coin = document.createElement('img')
      coin.className = 'coin'
      coin.src = ART.coin
      coin.alt = ''
      chip.append(coin)
    } else {
      const label = document.createElement('span')
      label.textContent = item.label + ' '
      chip.append(label)
    }
    const value = document.createElement('b')
    value.textContent = item.value
    chip.append(value)
    return chip
  }))
  statsEl.hidden = items.length === 0
}

/**
 * The widget stays a desktop pet; only the bubble retracts once a finished
 * task has been readable for a moment.
 * @param {object} session - the session being shown.
 */
function update(session, now) {
  const { tracker, sounds } = advance(trackerState, session, now)
  trackerState = tracker
  for (const cue of sounds) play(cue)

  // The celebration animation loops, so it is bounded by the same window that
  // bounds the bubble; an outcome-only rule would celebrate forever.
  const retracted = shouldRetract(tracker, now, LINGER_MS)
  render(session, !retracted)
  bubble.hidden = retracted
}

/**
 * Hides the bubble and stills the whale.
 *
 * A retracted bubble is not an idle whale: the window keeps bobbing while a
 * turn runs, because the bubble is what retracts on a finished task, not the
 * artwork.
 */
function idle() {
  bubble.hidden = true
  whale.classList.remove('working')
  trackerState = null
}

let trackerState = null
let polling = false

/**
 * Read the newest snapshot.
 * @returns {Promise<object | undefined>} the payload, or undefined while the backend is not answering.
 */
async function loadState() {
  try {
    const response = await fetch('/widget/state', { cache: 'no-store' })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    // A backend that is restarting or gone leaves the last paint standing; the
    // next tick retries. Only the fetch is inside this block, so no paint error
    // can reach it and be mistaken for an unreachable backend.
    return undefined
  }
}

async function poll() {
  // A slow or stalled backend must not stack requests: without this guard a
  // backend that takes longer than POLL_MS to answer accumulates one fetch per
  // tick, each painting state that is already superseded by the next.
  if (polling) return
  polling = true
  try {
    const payload = await loadState()
    if (payload === undefined) return
    const session = pick(payload.sessions ?? [])
    if (session === undefined) {
      idle()
      return
    }
    const now = Date.now()
    // The first sighting baselines the transition tracker without sound, so a
    // widget opened mid-task does not announce progress that already happened.
    if (trackerState === null || trackerState.sessionId !== session.sessionId) {
      trackerState = baselineTracker(session, now)
    }
    update(session, now)
  } finally {
    polling = false
  }
}

// Click-through: the window is larger than its artwork, so the pointer decides
// whether a click belongs to the widget or passes through to the desktop. Hit
// testing is geometric because the whale is a PNG with transparent margins —
// its box is not its visible silhouette, and only the box is worth claiming.
/**
 * The widget's box on screen: the union of whatever it draws. A pointer inside
 * belongs to the widget, and the transparent margin around the artwork stays
 * click-through to the desktop below.
 * @returns {{ left: number, top: number, right: number, bottom: number } | null} the box, or null while nothing is drawn.
 */
function widgetBox() {
  const boxes = [whale, bubble]
    .filter(node => !node.hidden)
    .map(node => node.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.height > 0)
  if (boxes.length === 0) return null
  return {
    left: Math.min(...boxes.map(rect => rect.left)),
    top: Math.min(...boxes.map(rect => rect.top)),
    right: Math.max(...boxes.map(rect => rect.right)),
    bottom: Math.max(...boxes.map(rect => rect.bottom)),
  }
}

/**
 * Whether a pointer event landed on the widget.
 * @param {MouseEvent} event - the pointer event.
 * @returns {boolean} true inside the widget's box.
 */
function onWidget(event) {
  const box = widgetBox()
  if (box === null) return false
  return event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom
}

// The host opens the window click-through and waits to be told otherwise, so
// this starts false: starting true would make the first hover a no-op and leave
// the window passing clicks to the desktop until the pointer left and returned.
let interactive = false

// The window cannot use -webkit-app-region: drag. The window manager treats a
// drag region as a title bar, and a right click inside one is consumed before
// the page sees it — which is exactly the click the widget's menu needs. The
// renderer moves the window instead, so every drawn part stays both draggable
// and right-clickable.
let drag = null
let muteSuppressedUntil = 0

document.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || !onWidget(event)) return
  drag = { x: event.screenX, y: event.screenY, moved: false }
})

document.addEventListener('mousemove', (event) => {
  if (drag !== null) {
    const dx = event.screenX - drag.x
    const dy = event.screenY - drag.y
    // A few pixels separate a click from a drag, so the double click that mutes
    // the widget is never read as the start of a move.
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return
      drag.moved = true
      window.whaleNative?.dragStart()
    }
    window.whaleNative?.dragMove(dx, dy)
    return
  }
  const hit = onWidget(event)
  if (hit === interactive) return
  interactive = hit
  window.whaleNative?.setInteractive(hit)
})

document.addEventListener('mouseup', () => {
  if (drag === null) return
  if (drag.moved) {
    muteSuppressedUntil = Date.now() + 250
    window.whaleNative?.dragEnd()
  }
  drag = null
})

/**
 * Apply an absolute sound choice, keeping the badge, the host's tray label, and
 * the cue in step.
 *
 * Absolute rather than a toggle because two sources command it — the double
 * click here and the settings panel, which reports the value it stored. A
 * toggle would drift whenever the two disagreed.
 * @param {boolean} muted - whether sound should be off.
 */
function setSound(muted) {
  if (soundOn === !muted) return
  soundOn = !muted
  muteEl.hidden = soundOn
  window.whaleNative?.setMuted(muted)
  if (soundOn) play('toggle')
}

// Sound is a deliberate choice, so it is a double click: a single click on the
// bubble would otherwise mute the widget during an ordinary drag. Two quick
// drags also read as a double click, so a drag suppresses the gesture briefly.
bubble.addEventListener('dblclick', () => {
  if (Date.now() < muteSuppressedUntil) return
  setSound(soundOn)
})

window.whaleNative?.onSound(setSound)

// A right click on the whale offers the commands that have no visible control:
// this window is frameless and skips the taskbar, so without a menu its only
// exit is quitting the application. The menu itself is a native one, built and
// shown by the host, because hiding and quitting outlive this window.
document.addEventListener('contextmenu', (event) => {
  // The stage is a drag region, so the click must be claimed before the window
  // manager takes it as the start of a move.
  event.preventDefault()
  const over = [whale, bubble].some((node) => {
    if (node.hidden) return false
    const rect = node.getBoundingClientRect()
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom
  })
  if (over) window.whaleNative?.openMenu()
})

setInterval(() => { void poll() }, POLL_MS)
void poll()
