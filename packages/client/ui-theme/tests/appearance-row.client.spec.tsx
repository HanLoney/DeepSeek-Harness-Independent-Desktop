// @vitest-environment jsdom
/** AppearanceRow behavior: theme selection, background controls, and prompt persistence. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { ThemePreference } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.background': 'Custom background',
  'appearance.backgroundPreview': 'Background preview',
  'appearance.backgroundOpacity': 'Background opacity',
  'appearance.chooseBackground': 'Choose image',
  'appearance.compressingBackground': 'Compressing',
  'appearance.clearBackground': 'Clear background',
  'appearance.backgroundError': 'Bad background',
  'appearance.prompt': 'Personalized prompt',
  'appearance.promptPlaceholder': 'Add guidance',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(preference: ThemePreference = 'system', background = '', prompt = '', backgroundOpacity = 0.48) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, background, backgroundOpacity, prompt, 0)
  const setTheme = vi.fn()
  const setBackground = vi.fn()
  const setBackgroundOpacity = vi.fn()
  const setPrompt = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
    setBackground,
    setBackgroundOpacity,
    setPrompt,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setBackground, setBackgroundOpacity, setPrompt }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearanceRow', () => {
  it('renders the title and three cubes with the preference cube selected', () => {
    mount('dark')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(pressed(/Dark/)).toBe('true')
    expect(pressed(/Light/)).toBe('false')
    expect(pressed(/System/)).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Light/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/Dark/)).toBe('true')
    act(() => { b.store.actions.sync('light', '', 0.48, '', 1) })
    expect(pressed(/Light/)).toBe('true')
    expect(pressed(/Dark/)).toBe('false')
  })

  it('clears an existing background and saves prompt text on blur', () => {
    const b = mount('system', 'data:image/png;base64,AA==', 'Old prompt', 0.35)
    const preview = screen.getByRole('img', { name: 'Background preview' })
    expect(preview.getAttribute('src'))
      .toBe('data:image/png;base64,AA==')
    expect(preview.getAttribute('style')).toContain('opacity: 0.35')
    const opacity = screen.getByRole('slider', { name: 'Background opacity' })
    expect(opacity.getAttribute('value')).toBe('35')
    fireEvent.change(opacity, { target: { value: '70' } })
    expect(b.setBackgroundOpacity).toHaveBeenCalledWith(0.7)
    fireEvent.click(screen.getByRole('button', { name: 'Clear background' }))
    expect(b.setBackground).toHaveBeenCalledWith('')
    const prompt = screen.getByRole('textbox', { name: 'Personalized prompt' })
    fireEvent.change(prompt, { target: { value: 'New prompt' } })
    fireEvent.blur(prompt)
    expect(b.setPrompt).toHaveBeenCalledWith('New prompt')
  })

  it('preserves a small image that already fits the settings value', async () => {
    const b = mount()
    const file = new File(['small'], 'wallpaper.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    await waitFor(() => {
      expect(b.setBackground).toHaveBeenCalledWith('data:image/png;base64,c21hbGw=')
    })
  })

  it('compresses an oversized source instead of rejecting its file size', async () => {
    const b = mount()
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4_000, height: 3_000, close }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,AA==')
    const file = new File([new Uint8Array(2_000_000)], 'wallpaper.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    expect(screen.getByRole('button', { name: 'Compressing' }).hasAttribute('disabled')).toBe(true)
    await waitFor(() => {
      expect(b.setBackground).toHaveBeenCalledWith('data:image/webp;base64,AA==')
    })
    expect(close).toHaveBeenCalledOnce()
  })
})
