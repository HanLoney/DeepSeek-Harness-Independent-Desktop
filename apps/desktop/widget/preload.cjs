/**
 * Preload for the widget window.
 *
 * The window runs with sandbox and context isolation on, so the renderer cannot
 * touch Electron directly. It needs two things: telling the window whether the
 * pointer is over a drawn part, so the rest of the always-on-top surface stays
 * click-through to the desktop below; and running the commands a right click on
 * the whale offers. Dismissing and reopening the widget outlive this window, so
 * the renderer sends the intent and the host owns the action.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whaleNative', {
  /**
   * Report whether the pointer currently sits over widget content.
   * @param {boolean} interactive - true while the pointer is over the whale or the bubble.
   */
  setInteractive: (interactive) => { ipcRenderer.send('whale:interactive', interactive) },

  /** Ask the host to show the widget's context menu at the pointer. */
  openMenu: () => { ipcRenderer.send('whale:context') },

  /** Begin a window move the renderer is driving from pointer deltas. */
  dragStart: () => { ipcRenderer.send('whale:drag', { phase: 'start' }) },

  /**
   * Move the window by a pointer delta.
   * @param {number} dx - horizontal delta in screen pixels.
   * @param {number} dy - vertical delta in screen pixels.
   */
  dragMove: (dx, dy) => { ipcRenderer.send('whale:drag', { phase: 'move', dx, dy }) },

  /** Finish the move and persist the resulting position. */
  dragEnd: () => { ipcRenderer.send('whale:drag', { phase: 'end' }) },

  /**
   * Report the renderer's current sound state, so the tray label agrees with it.
   * @param {boolean} muted - true while sound is off.
   */
  setMuted: (muted) => { ipcRenderer.send('whale:muted', muted) },

  /**
   * Receive a mute choice made outside this window — the tray, the right-click
   * menu, or the settings panel. The payload is the mute state the sender
   * wants, which is the same polarity the settings document stores.
   * @param {(muted: boolean) => void} handler - runs with the state to apply.
   */
  onSound: (handler) => { ipcRenderer.on('whale:sound', (_event, muted) => { handler(muted === true) }) },
})
