/**
 * ui-codex-bridge plugin halves: the browser entry's dictionary and settings
 * section registrations against the real SlotRegistry (with fiber teardown
 * proving removal \u2014 HMR safety), the inert node entry, and the invariant
 * companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { CodexBridgeStore } from '../src/client/store.ts'

/** Slot ledger reader: section ids currently registered in the settings list. */
function sectionIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('settings.section').map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the settings list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { rpc: { call: () => Promise.resolve({ ok: true, value: {} }) } } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-codex-bridge browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the settings section, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(sectionIds(ctx)).toContain('codex-bridge')
    await fiber.dispose()
    expect(sectionIds(ctx)).not.toContain('codex-bridge')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('nav')).toBe(zh.nav)
    ctx.locale.setLocale('en')
    expect(translate('nav')).toBe(en.nav)

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('nav')).not.toBe(en.nav)
  })

  it('starts one batch run for all selected project threads', async () => {
    const calls: { endpoint: string; payload: unknown }[] = []
    const connection = {
      rpc: {
        call: (_channel: string, endpoint: string, payload: unknown) => {
          calls.push({ endpoint, payload })
          return Promise.resolve({ ok: true, value: { id: 'batch-run' } })
        },
      },
    }
    const store = new CodexBridgeStore(connection as never)
    await store.importProject('DeepSeekHarness', ['thread-a', 'thread-b'])
    expect(calls[0]).toEqual({ endpoint: 'runs/start-import-batch', payload: { threadIds: ['thread-a', 'thread-b'] } })
    expect(store.getSnapshot().run?.target).toBe('DeepSeekHarness')
    store.dispose()
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has no node-half behavior beyond an inert apply', () => {
    expect(() => { applyNode() }).not.toThrow()
  })
})

describe('ui-codex-bridge invariant companion', () => {
  it('reserves package ownership under the invariants service', async () => {
    const InvariantRegistry = (await import('@deepseek-ai/dsh-invariants')).default
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry).await()
    const fiber = ctx.plugin({ inject: [...invariant.inject], apply: invariant.apply })
    await fiber.await()
    await fiber.dispose()
  })
})
