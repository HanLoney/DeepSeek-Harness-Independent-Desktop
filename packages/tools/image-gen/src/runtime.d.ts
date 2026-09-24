/**
 * Declarations for the checked-in upstream host runtime (src/runtime.js). The
 * runtime stays JavaScript because the upstream source tree contains no
 * TypeScript implementation; these declarations describe its loader contract.
 * @module @deepseek-ai/dsh-tool-image-gen
 */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'

/** The user-editable settings read from composition config or the settings document. */
export interface ImageGenSettings {
  apiKeyEnv: string
  baseURL: string
  model: string
  size: '512x512' | '1024x1024' | '1536x1024' | '1024x1536'
  saveToWorkspace: boolean
}

/** Loader entry name. */
export const name: string
/** Services the plugin consumes. */
export const inject: string[]
/** Durable settings namespace; also the settings-panel section id. */
export const SETTINGS_NAMESPACE: string
/** The user-editable contract, shared by the composition entry and the settings document. */
export const SettingsSchema: z<ImageGenSettings>
/** The loader validates the composition entry with the same contract. */
export const Config: z<ImageGenSettings>
/** Register the `generate_image` tool and its byte-serving route. */
export function apply(ctx: Context, config?: Partial<ImageGenSettings>): void
