/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { injectBootTheme } from './boot-theme.ts'
import {
  DEFAULT_BACKGROUND_OPACITY, DEFAULT_PREFERENCE, isBackgroundDataUrl, MAX_PROMPT_LENGTH,
  THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_BACKGROUND_OPACITY, DEFAULT_PREFERENCE, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  MAX_BACKGROUND_LENGTH, MAX_PROMPT_LENGTH, isBackgroundDataUrl,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)
const DEFAULT_SETTINGS: ThemeSettings = {
  preference: DEFAULT_PREFERENCE, background: '', backgroundOpacity: DEFAULT_BACKGROUND_OPACITY, prompt: '',
}

/** Read the registered preference or use the schema default without a settings provider. */
function readPreference(ctx: Context): ThemePreference {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PREFERENCE
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return DEFAULT_PREFERENCE
  return section.preference
}

/**
 * Register the durable theme section and initial-theme index transform when
 * their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx: Context): void {
  let current = DEFAULT_SETTINGS
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema, {
      validate: (value) => {
        if (!isBackgroundDataUrl(value.background)) {
          throw new Error('ui-theme background must be a base64 image data URL')
        }
        if (value.prompt.length > MAX_PROMPT_LENGTH) {
          throw new Error(`ui-theme prompt must be at most ${String(MAX_PROMPT_LENGTH)} characters`)
        }
      },
    })
    current = scope.get()
    const stop = scope.watch((next) => { current = next })
    settingsCtx.effect(() => () => {
      stop()
      current = DEFAULT_SETTINGS
    }, 'client-ui-theme: durable customization source')
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'ui-theme:custom-prompt',
      order: 10,
      text: () => current.prompt,
    })
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectBootTheme(html, readPreference(ctx))),
      'client-ui-theme: initial theme bootstrap',
    )
  })
}
