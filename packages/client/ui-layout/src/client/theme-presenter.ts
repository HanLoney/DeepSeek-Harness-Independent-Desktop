/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome (scrollbars, form
 * controls), `body[data-ds-dark-theme]` for the token palette, the active
 * theme's alias-token overrides as inline CSS variables on body, the optional
 * user background image with opacity-matched base, sidebar, New Session, and
 * composer fills, and one
 * presenter-owned `meta[name="theme-color"]` for surrounding browser UI. Pure
 * DOM writes, no React involvement; the presenter only ever retracts what it
 * wrote itself, so foreign attributes, metadata, and inline styles survive.
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement
  /** Whether this presenter currently owns body background-image styles. */
  private hasBackground = false

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme` (never the id — `system` is
   * resolved upstream), then replace the previously applied token variables
   * with `active.tokens`. Browser theme-color metadata follows the computed
   * body background after those writes, so the rendered palette remains the
   * color authority.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    if (snapshot.background === '') {
      this.clearBackground(body)
    } else {
      const surfaceAlpha = (1 - snapshot.backgroundOpacity).toFixed(2)
      const customSurfaces = scheme === 'dark'
        ? { newSession: '67, 69, 74', composer: '44, 44, 46' }
        : { newSession: '255, 255, 255', composer: '255, 255, 255' }
      body.style.setProperty('background-image', `url(${JSON.stringify(snapshot.background)})`)
      body.style.setProperty('background-size', 'cover')
      body.style.setProperty('background-position', 'center')
      body.style.setProperty('background-attachment', 'fixed')
      body.style.setProperty('background-repeat', 'no-repeat')
      body.style.setProperty('--dsw-alias-bg-base', scheme === 'dark'
        ? `rgba(21, 21, 23, ${surfaceAlpha})`
        : `rgba(255, 255, 255, ${surfaceAlpha})`)
      body.style.setProperty('--dsw-specific-sidebar-fill', scheme === 'dark'
        ? `rgba(27, 27, 28, ${surfaceAlpha})`
        : `rgba(249, 250, 251, ${surfaceAlpha})`)
      body.style.setProperty('--dsh-custom-background-new-session-fill', `rgba(${customSurfaces.newSession}, ${surfaceAlpha})`)
      body.style.setProperty('--dsh-custom-background-composer-fill', `rgba(${customSurfaces.composer}, ${surfaceAlpha})`)
      this.appliedTokens.push(
        '--dsw-alias-bg-base',
        '--dsw-specific-sidebar-fill',
        '--dsh-custom-background-new-session-fill',
        '--dsh-custom-background-composer-fill',
      )
      this.hasBackground = true
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  /** Retract root color-scheme, the palette attribute, token variables, and the owned metadata node. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.clearBackground(body)
    this.themeColorMeta.remove()
  }

  /** Retract only background properties written by this presenter. */
  private clearBackground(body: HTMLElement): void {
    if (!this.hasBackground) return
    body.style.removeProperty('background-image')
    body.style.removeProperty('background-size')
    body.style.removeProperty('background-position')
    body.style.removeProperty('background-attachment')
    body.style.removeProperty('background-repeat')
    this.hasBackground = false
  }
}
