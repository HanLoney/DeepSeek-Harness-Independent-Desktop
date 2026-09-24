/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-codex-bridge`.
 * @module @deepseek-ai/dsh-codex-bridge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-codex-bridge'

/** Cordis companion plugin name. */
export const name = 'codex-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this bridge owns no session-event type and holds no live
 * `Session` to observe. It validates the Codex and artifact bytes it reads at
 * its own parse boundaries, before any write, so a malformed input is rejected
 * where it is still a byte rather than asserted later from a running session.
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
