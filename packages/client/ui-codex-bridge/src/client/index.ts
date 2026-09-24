/**
 * Codex bridge settings surface, browser half. It registers one settings
 * section that lists the Codex threads a Host can import and the DSH sessions
 * it can export, and renders the progress of whichever run is active.
 *
 * Section content is supplied by the registrant, per the settings contract:
 * the shell owns navigation and modal visibility, this plugin owns every
 * string and the whole interaction.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { CodexBridgeSection } from './CodexBridgeSection.tsx'
import type { CodexBridgeSectionInjected } from './CodexBridgeSection.tsx'
import { CodexBridgeStore } from './store.ts'
import { en, NS, zh, type CodexBridgeKey } from './locales.ts'

export type { CodexBridgeSectionInjected, CodexBridgeSectionProps } from './CodexBridgeSection.tsx'
export type { CodexBridgeState } from './store.ts'
export type { CodexBridgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Codex bridge page copy. */
    'settings.codexBridge': CodexBridgeKey
  }
}

/** Required services (cordis fiber inject): the slot ledger and dictionaries. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Mount the Codex bridge settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-codex-bridge: dictionaries')

  const controller = new CodexBridgeStore(connection)
  const useSnapshot = bindSnapshotSelector(controller)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'codex-bridge',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): CodexBridgeSectionInjected => ({ controller, useSnapshot, t }),
  }, CodexBridgeSection))
}
