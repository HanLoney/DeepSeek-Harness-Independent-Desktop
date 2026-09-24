/**
 * Codex bridge settings section: the two lists of work (Codex threads to
 * import, DSH sessions to export), a dry-run switch for exports, and the
 * progress region of the active run.
 *
 * The section owns no files itself — every list row and every log line comes
 * from the Host over the bridge RPC channel. It renders the active run as a
 * progress bar plus a scrolling log, which is the whole reason this exists
 * instead of the command line: an import of a multi-shard Codex thread takes
 * long enough that a person wants to watch it.
 */

import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { CodexBridgeState, CodexBridgeStore } from './store.ts'
import type { en } from './locales.ts'
import styles from './CodexBridgeSection.module.css'

/** Injected dependencies of {@link CodexBridgeSection} (slot `inject`). */
export interface CodexBridgeSectionInjected {
  /** The page store, loaded on mount and polled while a run is in flight. */
  controller: CodexBridgeStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<CodexBridgeState>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type CodexBridgeSectionProps = Partial<CodexBridgeSectionInjected>

/** Map each log severity to the class its line renders with. */
const LOG_LEVEL_CLASS = { info: 'logInfo', warn: 'logWarn', error: 'logError' } as const

/** Render a run's log lines, newest last. */
function Log({ state, t }: { state: CodexBridgeState; t: CodexBridgeSectionInjected['t'] }): React.ReactNode {
  const run = state.run
  if (run === undefined) return <p className={styles.hint}>{t('noRun')}</p>
  const statusText = run.status === 'running' ? t('running') : run.status === 'completed' ? t('completed') : t('failed')
  return (
    <div className={styles.run}>
      <div className={styles.runHead}>
        <span className={styles.runTarget}>{run.target}</span>
        <span className={styles[run.status]}>{statusText}</span>
        <span className={styles.stage}>{t('stage')}: {run.stage}</span>
      </div>
      {run.progress !== undefined && (
        <div className={styles.bar} role="progressbar" aria-valuenow={Math.round(run.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.barFill} style={{ inlineSize: `${String(Math.round(run.progress * 100))}%` }} />
        </div>
      )}
      <ul className={styles.log}>
        {run.log.map((line, index) => (
          // Log lines are append-only and never reordered, so the index is stable.
          <li key={index} className={styles[LOG_LEVEL_CLASS[line.level]]}>{line.text}</li>
        ))}
      </ul>
      {run.result !== undefined && (
        <div className={styles.result}>
          <p className={styles.resultSummary}>{run.result.summary}</p>
          <dl className={styles.facts}>
            {run.result.facts.map(fact => (
              <div key={fact.label} className={styles.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

/**
 * Render the Codex bridge section.
 * @param props - the slot's injected face.
 */
export function CodexBridgeSection({ controller, useSnapshot, t }: CodexBridgeSectionProps): React.ReactNode {
  /* v8 ignore next -- the slot always injects both faces */
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  const state = useSnapshot(s => s)
  const busy = state.run?.status === 'running'

  useEffect(() => {
    void controller.load()
    return () => { controller.dispose() }
  }, [controller])

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>

      <div className={styles.tabs}>
        <Button
          variant={state.direction === 'import' ? 'primary' : 'outline'}
          onClick={() => { controller.selectDirection('import') }}
        >{t('threadsHeading')}</Button>
        <Button
          variant={state.direction === 'export' ? 'primary' : 'outline'}
          onClick={() => { controller.selectDirection('export') }}
        >{t('sessionsHeading')}</Button>
        <Button variant="outline" onClick={() => { void controller.load() }}>{t('refresh')}</Button>
      </div>

      {state.error !== undefined && <p className={styles.error}>{state.error}</p>}
      {state.listStatus === 'loading' && <p className={styles.hint}>{t('loading')}</p>}
      {state.listStatus === 'error' && <p className={styles.error}>{t('loadFailed')}</p>}
      {state.listStatus === 'ready' && state.direction === 'import' && (
        state.threads.length === 0
          ? <p className={styles.hint}>{t('emptyThreads')}</p>
          : <div className={styles.projectGroups}>
            {[...new Map(state.threads.map(thread => [thread.project ?? t('noProject'), state.threads.filter(item => (item.project ?? t('noProject')) === (thread.project ?? t('noProject')))])).entries()].map(([project, threads]) => (
              <section key={project} className={styles.projectGroup}>
                <div className={styles.projectHeader}>
                  <h3 className={styles.projectHeading}>{t('project')}: {project} <span className={styles.projectCount}>({threads.length})</span></h3>
                  <Button variant="outline" disabled={busy} onClick={() => { void controller.importProject(project, threads.map(thread => thread.id)) }}>{t('importProject')}</Button>
                </div>
                <ul className={styles.rows}>
                  {threads.map(thread => (
                    <li key={thread.id} className={styles.row}>
                      <div className={styles.rowText}>
                        <span className={styles.rowTitle}>{thread.title ?? t('untitled')}</span>
                        <span className={styles.rowMeta}>{thread.id} · {t('shards').replace('{count}', String(thread.shards))}</span>
                      </div>
                      <Button variant="primary" disabled={busy} onClick={() => { void controller.importThread(thread.id) }}>{t('import')}</Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
      )}

      {state.listStatus === 'ready' && state.direction === 'export' && (
        state.sessions.length === 0
          ? <p className={styles.hint}>{t('emptySessions')}</p>
          : <ul className={styles.rows}>
            {state.sessions.map(session => (
              <li key={session.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{session.id}</span>
                  <span className={styles.rowMeta}>{t('project')}: {session.project} · {t('bytes')}: {session.bytes}</span>
                </div>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => { void controller.exportSession(session.id) }}
                >{t('export')}</Button>
              </li>
            ))}
          </ul>
      )}

      {state.direction === 'export' && (
        <label className={styles.dryRun}>
          <input type="checkbox" checked={state.dryRun} onChange={() => { controller.toggleDryRun() }} />
          {t('dryRun')}
        </label>
      )}

      <h3 className={styles.logHeading}>{t('logHeading')}</h3>
      <Log state={state} t={t} />
    </section>
  )
}
