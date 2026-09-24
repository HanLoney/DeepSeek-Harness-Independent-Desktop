/**
 * Page store for the Codex bridge settings section.
 *
 * One store owns the whole page: the two lists, the selected direction, the
 * active run, and its polled log. The store is a plain observable source with
 * no hook members — the slot renderer binds it to `useSnapshot` — and it holds
 * viewing state only. Every fact it displays is fetched from the Host, which
 * owns the files.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  listSessions, listThreads, readRun, startExport, startImport, startImportBatch,
  type BridgeRun, type CodexThreadSummary, type DshSessionSummary,
} from './bridge-api.ts'

/** Poll interval while a run is in flight. */
export const POLL_INTERVAL_MS = 500

/** Everything the page renders. */
export interface CodexBridgeState {
  /** Which list is showing. */
  direction: 'import' | 'export'
  /** Loading state of the active list. */
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Codex threads, newest first. */
  threads: CodexThreadSummary[]
  /** DSH sessions, newest first. */
  sessions: DshSessionSummary[]
  /** The Codex home the thread list was read from. */
  codexHome: string
  /** The session root the session list was read from. */
  sessionRoot: string
  /** Whether the export runs without writing. */
  dryRun: boolean
  /** The active or most recent run. */
  run: BridgeRun | undefined
  /** A transport-level failure that is not part of a run. */
  error: string | undefined
}

/**
 * The page store: reads the two lists, starts runs, and polls the active one.
 *
 * Polling stops as soon as a run settles, so an idle panel makes no requests.
 * Starting a run while one is in flight is refused rather than queued: the
 * page shows one operation at a time, which is how its log region reads.
 */
export class CodexBridgeStore {
  private readonly listeners = new Set<() => void>()
  private snapshot: CodexBridgeState = {
    direction: 'import',
    listStatus: 'idle',
    threads: [],
    sessions: [],
    codexHome: '',
    sessionRoot: '',
    dryRun: true,
    run: undefined,
    error: undefined,
  }
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param connection - the browser connection handle the Host channel is called through.
   */
  constructor(private readonly connection: ConnectionHandle) {}

  /**
   * Read the current page snapshot.
   * @returns the state the section renders.
   */
  getSnapshot(): CodexBridgeState {
    return this.snapshot
  }

  /**
   * Subscribe to page changes.
   * @param listener - called after each change.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Apply a partial state change and notify subscribers. */
  private set(patch: Partial<CodexBridgeState>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Switch between the import and export lists.
   * @param direction - the list to show.
   */
  selectDirection(direction: 'import' | 'export'): void {
    this.set({ direction })
  }

  /** Toggle whether an export writes. */
  toggleDryRun(): void {
    this.set({ dryRun: !this.snapshot.dryRun })
  }

  /** Load both lists. */
  async load(): Promise<void> {
    this.set({ listStatus: 'loading', error: undefined })
    try {
      const [threads, sessions] = await Promise.all([
        listThreads(this.connection),
        listSessions(this.connection),
      ])
      this.set({
        listStatus: 'ready',
        threads: threads.threads,
        sessions: sessions.sessions,
        codexHome: threads.codexHome,
        sessionRoot: sessions.sessionRoot,
      })
    } catch (error) {
      this.set({ listStatus: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Start an import for one thread and begin polling it.
   * @param threadId - the Codex thread to import.
   */
  async importThread(threadId: string): Promise<void> {
    await this.start('import', threadId)
  }

  /**
   * Start an import for every thread in one project group.
   * @param project - the displayed project label.
   * @param threadIds - its Codex thread ids.
   */
  async importProject(project: string, threadIds: string[]): Promise<void> {
    if (this.snapshot.run?.status === 'running' || threadIds.length === 0) return
    this.set({ error: undefined })
    try {
      const id = await startImportBatch(this.connection, threadIds)
      this.set({ run: { id, direction: 'import', target: project, status: 'running', stage: 'starting', log: [] } })
      this.poll(id)
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Start an export for one session and begin polling it.
   * @param sessionId - the DSH session to export.
   */
  async exportSession(sessionId: string): Promise<void> {
    await this.start('export', sessionId)
  }

  /** Refuse concurrent starts, then open a run and poll it to settlement. */
  private async start(direction: 'import' | 'export', target: string): Promise<void> {
    if (this.snapshot.run?.status === 'running') return
    this.set({ error: undefined })
    try {
      const id = direction === 'import'
        ? await startImport(this.connection, target)
        : await startExport(this.connection, target, this.snapshot.dryRun)
      this.set({ run: { id, direction, target, status: 'running', stage: 'starting', log: [] } })
      this.poll(id)
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Poll one run until it settles, one timer at a time. */
  private poll(id: string): void {
    this.stopPolling()
    const tick = async (): Promise<void> => {
      try {
        const run = await readRun(this.connection, id)
        // A newer start may have replaced the run this timer belonged to.
        if (this.snapshot.run?.id !== id) return
        if (run !== undefined) this.set({ run })
        if (run === undefined || run.status === 'running') {
          this.timer = setTimeout(() => { void tick() }, POLL_INTERVAL_MS)
          return
        }
        this.stopPolling()
      } catch (error) {
        this.set({ error: error instanceof Error ? error.message : String(error) })
        this.stopPolling()
      }
    }
    void tick()
  }

  /** Clear the poll timer, if one is armed. */
  private stopPolling(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Stop polling; called when the section unmounts. */
  dispose(): void {
    this.stopPolling()
    this.listeners.clear()
  }
}
