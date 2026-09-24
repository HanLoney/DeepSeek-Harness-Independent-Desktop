/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-image-gen`.
 * @module @deepseek-ai/dsh-tool-image-gen/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-image-gen'

/** Cordis companion plugin name. */
export const name = 'tool-image-gen-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter delegates generated-byte persistence to
 * attachments and owns no event stream or mutable durable relation to inspect.
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
