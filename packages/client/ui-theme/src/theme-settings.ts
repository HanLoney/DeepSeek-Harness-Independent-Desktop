/** Appearance and personalization preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Default visible strength of a configured application background. */
export const DEFAULT_BACKGROUND_OPACITY = 0.48

/** Maximum persisted image data URL length for the user background. */
export const MAX_BACKGROUND_LENGTH = 2_000_000

/** Maximum persisted custom prompt length. */
export const MAX_PROMPT_LENGTH = 12_000

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Optional image data URL projected behind the application surfaces. */
  background: string
  /** Visible background strength from fully hidden (0) to fully visible (1). */
  backgroundOpacity: number
  /** Optional user-authored prompt section added to model requests. */
  prompt: string
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  background: z.string().max(MAX_BACKGROUND_LENGTH).default(''),
  backgroundOpacity: z.number().min(0).max(1).default(DEFAULT_BACKGROUND_OPACITY),
  prompt: z.string().max(MAX_PROMPT_LENGTH).default(''),
})

/**
 * Validate one persisted background data URL at the Host settings boundary.
 * @param value - persisted string crossing the settings boundary.
 * @returns whether the value is empty or a supported base64 image data URL within the size limit.
 */
export function isBackgroundDataUrl(value: string): boolean {
  return value === '' || (value.length <= MAX_BACKGROUND_LENGTH
    && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value))
}

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
