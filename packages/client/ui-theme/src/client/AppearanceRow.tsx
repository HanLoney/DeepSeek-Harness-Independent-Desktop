/**
 * Appearance preference row registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes,
 * background image controls, and the personalized-prompt editor.
 * Registered by this package — the theme feature owns its own settings
 * surface. Selection follows the persisted preference, never the resolved
 * active theme.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MAX_BACKGROUND_LENGTH, MAX_PROMPT_LENGTH, isBackgroundDataUrl, type ThemePreference,
} from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Persist an image data URL as the application background. */
  setBackground: (value: string) => void
  /** Persist and publish the visible background strength. */
  setBackgroundOpacity: (value: number) => void
  /** Persist the model-facing custom prompt. */
  setPrompt: (value: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

const BACKGROUND_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const BACKGROUND_QUALITIES = [0.86, 0.7, 0.54, 0.38] as const
const MAX_BACKGROUND_EDGE = 2_560

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(reader.error ?? new Error('image read failed')) }
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('image read returned no data URL'))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Preserve an already-storable image or locally downscale and encode it until
 * it fits the durable settings value.
 * @param file - user-selected PNG, JPEG, WebP, or GIF without an input byte limit.
 * @returns a validated image data URL within the settings envelope.
 */
export async function compressBackground(file: File): Promise<string> {
  if (!BACKGROUND_TYPES.has(file.type)) throw new TypeError('unsupported background image type')
  if (file.size <= Math.floor((MAX_BACKGROUND_LENGTH - 64) * 0.75)) {
    const original = await readDataUrl(file)
    if (isBackgroundDataUrl(original)) return original
  }

  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2D canvas is unavailable')
    let scale = Math.min(1, MAX_BACKGROUND_EDGE / Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of BACKGROUND_QUALITIES) {
        const value = canvas.toDataURL('image/webp', quality)
        if (isBackgroundDataUrl(value)) return value
      }
      scale *= 0.7
    }
    throw new Error('background image could not fit the settings envelope')
  } finally {
    bitmap.close()
  }
}

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({
  t, setTheme, setBackground, setBackgroundOpacity, setPrompt, useStore,
}: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const background = useStore(s => s.background)
  const backgroundOpacity = useStore(s => s.backgroundOpacity)
  const prompt = useStore(s => s.prompt)
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const [backgroundError, setBackgroundError] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraftPrompt(prompt) }, [prompt])

  const readBackground = async (file: File): Promise<void> => {
    setBackgroundBusy(true)
    setBackgroundError(false)
    try {
      const value = await compressBackground(file)
      setBackgroundError(false)
      setBackground(value)
    } catch {
      setBackgroundError(true)
    } finally {
      setBackgroundBusy(false)
    }
  }
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className={css.customSection}>
        <div className={css.customTitle}>{t('appearance.background')}</div>
        <div className={css.customActions}>
          <input
            ref={fileInput}
            className={css.hiddenInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined) void readBackground(file)
            }}
          />
          <button
            type="button"
            className={css.actionButton}
            disabled={backgroundBusy}
            onClick={() => { fileInput.current?.click() }}
          >
            {t(backgroundBusy ? 'appearance.compressingBackground' : 'appearance.chooseBackground')}
          </button>
          {background !== '' && (
            <button type="button" className={css.secondaryButton} onClick={() => { setBackground('') }}>
              {t('appearance.clearBackground')}
            </button>
          )}
        </div>
        {background !== '' && (
          <>
            <img
              className={css.backgroundPreview}
              src={background}
              alt={t('appearance.backgroundPreview')}
              style={{ opacity: backgroundOpacity }}
            />
            <div className={css.opacityHeader}>
              <span>{t('appearance.backgroundOpacity')}</span>
              <span>{Math.round(backgroundOpacity * 100)}%</span>
            </div>
            <input
              className={css.opacitySlider}
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(backgroundOpacity * 100)}
              aria-label={t('appearance.backgroundOpacity')}
              onChange={(event) => { setBackgroundOpacity(Number(event.target.value) / 100) }}
            />
          </>
        )}
        {backgroundError && <div className={css.error}>{t('appearance.backgroundError')}</div>}
      </div>
      <label className={css.customSection}>
        <span className={css.customTitle}>{t('appearance.prompt')}</span>
        <textarea
          className={css.promptInput}
          value={draftPrompt}
          rows={4}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder={t('appearance.promptPlaceholder')}
          onChange={(event) => { setDraftPrompt(event.target.value) }}
          onBlur={() => { setPrompt(draftPrompt) }}
        />
      </label>
    </div>
  )
}
