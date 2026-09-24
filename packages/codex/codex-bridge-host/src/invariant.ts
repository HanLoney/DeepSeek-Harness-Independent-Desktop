/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-codex-bridge-host`.
 * @module @deepseek-ai/dsh-codex-bridge-host/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-codex-bridge-host'

/** Cordis companion plugin name. */
export const name = 'codex-bridge-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no session-event type and appends no
 * session events — it exposes an RPC channel over two on-disk formats. Its
 * durable relationship is asserted where it is observable instead: the bridge
 * tests re-read every artifact and rollout this package writes.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
