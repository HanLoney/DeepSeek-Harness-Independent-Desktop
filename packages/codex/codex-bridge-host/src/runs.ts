/**
 * In-memory registry of bridge runs the panel polls.
 *
 * A run records its stage, a monotonic progress fraction, and a bounded log as
 * the operation proceeds, so a browser can render live progress without the
 * operation pushing frames. Runs are deliberately NOT session events: an
 * import may run with no session open at all, and the panel is the only
 * consumer of this state.
 *
 * The registry bounds two things. The log keeps the most recent
 * {@link LOG_LIMIT} lines, because a long import folds tens of thousands of
 * lines and an unbounded log would grow without limit in a long-lived host
 * process. The run table keeps the most recent {@link RUN_LIMIT} runs, so a
 * browser that starts runs and never polls them cannot pin memory forever.
 *
 * @module @deepseek-ai/dsh-codex-bridge-host/runs
 */

import type { BridgeLogLine, BridgeRun, BridgeRunResult, BridgeRunStatus } from './types.ts'

/** Maximum log lines retained per run. */
export const LOG_LIMIT = 500

/** Maximum runs retained, oldest evicted first. */
export const RUN_LIMIT = 50

/** Mutable run record the registry owns while its operation is in flight. */
interface RunRecord {
  readonly id: string
  readonly direction: 'import' | 'export'
  readonly target: string
  status: BridgeRunStatus
  progress: number | undefined
  stage: string
  readonly log: BridgeLogLine[]
  result: BridgeRunResult | undefined
}

/**
 * Progress sink handed to one operation, which reports through it.
 *
 * The sink is the operation's only handle on its run: it can advance the
 * stage, move progress forward, append a line, and settle. It cannot read the
 * run or reach another run, so two concurrent runs cannot disturb each other.
 */
export interface RunReporter {
  /** Set the current stage label. */
  stage(label: string): void
  /**
   * Advance progress, which the registry clamps and never lets move backward.
   * @param fraction - the completed fraction, clamped to `[0, 1]`.
   */
  progress(fraction: number): void
  /**
   * Append one log line.
   * @param level - severity the panel colours.
   * @param text - the line to record.
   */
  log(level: 'info' | 'warn' | 'error', text: string): void
  /**
   * Settle the run, after which no further report is accepted.
   * @param result - the terminal summary the panel renders.
   */
  settle(result: BridgeRunResult): void
}

/** Coerce a reported fraction into the retained `[0, 1]` range. */
function clamp(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Registry of live and recently settled runs, keyed by id.
 *
 * The registry is a plain class rather than a cordis service: it has one
 * consumer (this package's RPC channel), and a service definition earns its
 * place only when roles evolve independently.
 */
export class RunRegistry {
  private readonly records = new Map<string, RunRecord>()

  /**
   * Open a run and return the reporter its operation reports through.
   * @param direction - the operation this run performs.
   * @param target - thread id (import) or session id (export).
   * @returns the new run's id and its reporter.
   */
  open(direction: 'import' | 'export', target: string): { id: string; reporter: RunReporter } {
    const id = `run-${crypto.randomUUID()}`
    const record: RunRecord = {
      id,
      direction,
      target,
      status: 'running',
      progress: undefined,
      stage: 'starting',
      log: [],
      result: undefined,
    }
    this.records.set(id, record)
    this.evict()
    return { id, reporter: this.reporterFor(record) }
  }

  /**
   * Read one run as the wire snapshot the panel renders.
   * @param id - run id the panel holds.
   * @returns the run snapshot, or `undefined` once it has been evicted.
   */
  read(id: string): BridgeRun | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    return {
      id: record.id,
      direction: record.direction,
      target: record.target,
      status: record.status,
      ...record.progress !== undefined ? { progress: record.progress } : {},
      stage: record.stage,
      log: [...record.log],
      ...record.result !== undefined ? { result: record.result } : {},
    }
  }

  /** Build the reporting face for one record, which is inert once it settles. */
  private reporterFor(record: RunRecord): RunReporter {
    return {
      stage: (label) => { if (record.status === 'running') record.stage = label },
      progress: (fraction) => {
        if (record.status !== 'running') return
        const next = clamp(fraction)
        // Progress only moves forward, so a late report cannot rewind the bar.
        record.progress = record.progress === undefined ? next : Math.max(record.progress, next)
      },
      log: (level, text) => {
        if (record.status !== 'running') return
        record.log.push({ at: Date.now(), level, text })
        if (record.log.length > LOG_LIMIT) record.log.splice(0, record.log.length - LOG_LIMIT)
      },
      settle: (result) => {
        if (record.status !== 'running') return
        record.status = result.ok ? 'completed' : 'failed'
        record.stage = result.ok ? 'done' : 'failed'
        record.progress = 1
        record.result = result
      },
    }
  }

  /** Drop the oldest settled runs once the table exceeds its bound. */
  private evict(): void {
    if (this.records.size <= RUN_LIMIT) return
    for (const [id, record] of this.records) {
      if (this.records.size <= RUN_LIMIT) return
      if (record.status !== 'running') this.records.delete(id)
    }
  }
}
