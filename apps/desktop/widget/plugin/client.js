/**
 * Task widget settings, browser half.
 *
 * One `settings.section` panel with the enable switch for the desktop task
 * widget. The widget's window is owned by the Electron host, which reads the
 * same namespace over `/desktop-widget/config`, so a saved switch applies to
 * the running widget without a restart.
 *
 * Written against the module loader directly — the host serves this file
 * verbatim at `/plugins/dsh-plugin-desktop-widget/client.js` — so the widget
 * needs no build step of its own. The id below is the *package* name, which is
 * the key the client-modules scanner expects this bundle to register under;
 * the loader entry's own id is independent of it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-desktop-widget',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** The plugin's durable settings namespace; matches the node half. */
    const NAMESPACE = 'desktop-widget'

    //#region styles
    const css = [
      '.dshWidgetForm{display:flex;flex-direction:column;gap:14px;max-width:520px}',
      '.dshWidgetRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}',
      '.dshWidgetRow input{margin-top:2px}',
      '.dshWidgetLabel{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshWidgetHint{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:2px 0 0}',
      '.dshWidgetStatus{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}',
      '.dshWidgetError{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-error)}'
    ].join('')
    const styleTagId = 'desktop-widget/Settings.module.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(styleTagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'desktop-widget'
      tag.dataset.pluginCss = styleTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    //#endregion

    /**
     * Coerce a stored section into the fields this panel edits.
     * @param raw - the stored namespace value, possibly partial.
     * @returns the fully populated editable fields.
     */
    function fieldsOf(raw) {
      const value = raw !== null && typeof raw === 'object' ? raw : {}
      return { enabled: value.enabled !== false, muted: value.muted === true }
    }

    /**
     * Render the settings section: the widget's enable switch.
     *
     * Reads and writes go through the plugin's own `/desktop-widget/config`
     * endpoint rather than `settingsScope`, because `dsh-host-apiproxy` gates
     * the generic settings RPC behind a namespace allowlist a plugin cannot
     * extend. The endpoint writes through the same settings service, so the
     * document, the schema, and the desktop host's live watcher are shared.
     * @returns the settings section element.
     */
    function WidgetSettings() {
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let live = true
        void (async () => {
          try {
            const response = await fetch('/desktop-widget/config', { headers: { accept: 'application/json' } })
            const body = await response.json()
            if (!live) return
            if (body !== null && typeof body === 'object' && body.ok === true) setDraft(fieldsOf(body.value))
            else {
              setFailed(true)
              setNote('读取设置失败')
            }
          } catch {
            // The panel is the only thing lost when this request fails: the
            // widget itself keeps running on whatever the host last read.
            if (!live) return
            setFailed(true)
            setNote('读取设置失败')
          }
        })()
        return () => { live = false }
      }, [])

      /**
       * Persist one field and adopt the host's echo.
       * @param patch - the fields to write.
       */
      const save = async (patch) => {
        setBusy(true)
        let error = ''
        try {
          const response = await fetch('/desktop-widget/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch)
          })
          const body = await response.json()
          if (body !== null && typeof body === 'object' && body.ok === true) setDraft(fieldsOf(body.value))
          else error = '保存失败'
        } catch {
          // Same containment as the read: a failed write leaves the panel
          // showing the last value it knows, and the switch stays usable.
          error = '保存失败'
        }
        setBusy(false)
        setNote(error)
        setFailed(error !== '')
      }

      if (draft === null) {
        return React.createElement('p', { className: failed ? 'dshWidgetError' : 'dshWidgetStatus' },
          failed ? note : '正在读取设置…')
      }

      const toggle = (key) => (event) => {
        const next = { [key]: event.target.checked }
        setDraft({ ...draft, ...next })
        void save(next)
      }

      const row = (key, label, hint) => React.createElement(
        'label',
        { className: 'dshWidgetRow' },
        React.createElement('input', {
          type: 'checkbox',
          checked: draft[key],
          disabled: busy,
          onChange: toggle(key)
        }),
        React.createElement(
          'span',
          null,
          React.createElement('span', { className: 'dshWidgetLabel' }, label),
          React.createElement('p', { className: 'dshWidgetHint' }, hint)
        )
      )

      return React.createElement(
        'div',
        { className: 'dshWidgetForm', 'data-plugin-settings': NAMESPACE },
        row('enabled', '显示桌面挂件', '在屏幕上显示一个悬浮的任务进度窗口。也可以右键挂件本身，或使用托盘图标。'),
        row('muted', '静音', '关闭挂件的提示音，不影响气泡和动画。'),
        note === '' ? null : React.createElement('span', { className: failed ? 'dshWidgetError' : 'dshWidgetStatus' }, note)
      )
    }

    //#region plugin
    /** Client services this plugin needs. */
    const inject = ['slots']

    /**
     * Client plugin body: contribute the widget's settings panel.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      // No `settingsScope`: this namespace is not on the proxy's exposure
      // allowlist, so the panel talks to `/desktop-widget/config` instead.
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: NAMESPACE,
          order: 60,
          label: () => '桌面挂件'
        },
        WidgetSettings
      ))
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
