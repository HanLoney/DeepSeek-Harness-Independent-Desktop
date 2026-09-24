/**
 * Run registry behavior: progress monotonicity, log bounding, eviction, and the
 * settlement that freezes a run against further reports.
 */
import { describe, expect, it } from 'vitest'
import { LOG_LIMIT, RUN_LIMIT, RunRegistry } from '../src/runs.ts'

describe('RunRegistry', () => {
  it('opens a run in the running state with no progress', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 'thread-1')
    const run = registry.read(id)
    expect(run).toMatchObject({
      id,
      direction: 'import',
      target: 'thread-1',
      status: 'running',
      stage: 'starting',
      log: [],
    })
    expect(run?.progress).toBeUndefined()
    expect(run?.result).toBeUndefined()
    void reporter
  })

  it('reports the stage, progress, and log lines an operation produces', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('export', 'session-1')
    reporter.stage('reading session')
    reporter.progress(0.5)
    reporter.log('info', 'hello')
    reporter.log('warn', 'careful')
    const run = registry.read(id)
    expect(run?.stage).toBe('reading session')
    expect(run?.progress).toBe(0.5)
    expect(run?.log.map(l => `${l.level}:${l.text}`)).toEqual(['info:hello', 'warn:careful'])
  })

  it('never lets progress move backward', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 't')
    reporter.progress(0.8)
    reporter.progress(0.2)
    expect(registry.read(id)?.progress).toBe(0.8)
  })

  it('clamps an over-range fraction to the ceiling', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 't')
    reporter.progress(5)
    expect(registry.read(id)?.progress).toBe(1)
  })

  it('clamps a reported fraction into range and floors a non-finite one', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 't')
    reporter.progress(-3)
    expect(registry.read(id)?.progress).toBe(0)
    reporter.progress(Number.NaN)
    expect(registry.read(id)?.progress).toBe(0)
  })

  it('bounds the retained log to the most recent lines', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 't')
    for (let index = 0; index < LOG_LIMIT + 20; index += 1) reporter.log('info', `line ${String(index)}`)
    const log = registry.read(id)?.log ?? []
    expect(log).toHaveLength(LOG_LIMIT)
    expect(log[0]?.text).toBe('line 20')
    expect(log.at(-1)?.text).toBe(`line ${String(LOG_LIMIT + 19)}`)
  })

  it('settles a successful run and freezes it against further reports', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('import', 't')
    reporter.settle({ ok: true, summary: 'done', facts: [{ label: 'a', value: '1' }] })
    reporter.stage('late')
    reporter.log('error', 'late')
    const run = registry.read(id)
    expect(run?.status).toBe('completed')
    expect(run?.stage).toBe('done')
    expect(run?.progress).toBe(1)
    expect(run?.result?.summary).toBe('done')
    expect(run?.log).toEqual([])
  })

  it('settles a failed run as failed', () => {
    const registry = new RunRegistry()
    const { id, reporter } = registry.open('export', 't')
    reporter.settle({ ok: false, summary: 'Export failed', facts: [] })
    expect(registry.read(id)?.status).toBe('failed')
    expect(registry.read(id)?.stage).toBe('failed')
  })

  it('evicts the oldest settled runs once the table exceeds its bound', () => {
    const registry = new RunRegistry()
    const ids: string[] = []
    for (let index = 0; index < RUN_LIMIT + 5; index += 1) {
      const { id, reporter } = registry.open('import', `t${String(index)}`)
      reporter.settle({ ok: true, summary: 's', facts: [] })
      ids.push(id)
    }
    expect(registry.read(ids[0] ?? '')).toBeUndefined()
    expect(registry.read(ids.at(-1) ?? '')?.status).toBe('completed')
  })

  it('reports an unknown run as undefined', () => {
    expect(new RunRegistry().read('missing')).toBeUndefined()
  })
})
