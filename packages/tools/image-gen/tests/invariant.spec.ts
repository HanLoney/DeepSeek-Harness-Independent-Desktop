import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ImageGenInvariant from '../src/invariant.ts'

describe('image-gen invariant companion', () => {
  it('reserves the package name and releases it on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ImageGenInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-tool-image-gen', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-tool-image-gen', () => {})).not.toThrow()
  })
})
