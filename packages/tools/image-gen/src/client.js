/**
 * Image-generation plugin, browser half.
 *
 * Two surfaces:
 *
 *   1. A keyed `tool.call.toolview` entry for the wire tool name
 *      `generate_image`, replacing the generic JSON card with the actual
 *      picture. The image URL is self-contained: the node half serves the
 *      bytes from a same-origin `/image-gen/<token>` route, and the token is
 *      recovered from the result's `meta` (a root call) or from the rendered
 *      model-facing text (a nested Code Mode sub-call, where the registry
 *      drops `meta` by contract). No session-authorization handshake is
 *      involved, so the card also renders correctly on session replay.
 *
 *   2. A `settings.section` panel that edits the plugin's durable settings
 *      namespace through the plugin's own `/image-gen/config` endpoint. Saving
 *      writes the settings document and the node half's watcher re-reads it in
 *      place, so a change applies to the next generation with no restart.
 *
 * Shipped as a prebuilt classic script: `@deepseek-ai/dsh-client-modules`
 * serves this file verbatim at `/plugins/<id>/client.js`, so it registers
 * itself through `window.__ModuleLoader__.load` and needs no build step.
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-tool-image-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives')

    //#region styles
    const css = [
      '.dshImgCard{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-base)}',
      '.dshImgHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.dshImgTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.dshImgMeta{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}',
      '.dshImgPrompt{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}',
      '.dshImgFrame{border-radius:10px;overflow:hidden;background:var(--dsw-alias-markdown-code-block);max-width:min(100%,520px);line-height:0}',
      '.dshImgFrame img{display:block;width:100%;height:auto}',
      '.dshImgState{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);padding:18px 0;text-align:center}',
      '.dshImgError{font:var(--dsw-font-xs-13);color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshImgFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshImgLink{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}',
      '.dshImgForm{display:flex;flex-direction:column;gap:18px;padding:4px 0}',
      '.dshImgField{display:flex;flex-direction:column;gap:6px}',
      '.dshImgLabel{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshImgHint{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0}',
      '.dshImgRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshImgSizes{display:flex;gap:8px;flex-wrap:wrap}',
      '.dshImgChip{font:var(--dsw-font-xs-13);padding:6px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.dshImgChip[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshImgToggle{display:flex;align-items:center;gap:8px;cursor:pointer;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}',
      '.dshImgActions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.dshImgStatus{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}'
    ].join('')
    const styleTagId = '@deepseek-ai/dsh-tool-image-gen/ImageCard.module.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(styleTagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@deepseek-ai/dsh-tool-image-gen'
      tag.dataset.pluginCss = styleTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    //#endregion

    //#region result reading
    /** The model-facing text of one settled result, joined. */
    function resultText(block) {
      if (!Array.isArray(block.content)) return ''
      return block.content
        .filter((part) => part !== null && typeof part === 'object' && part.type === 'text')
        .map((part) => String(part.text ?? ''))
        .join('\n')
    }

    /** Parse the running call's raw JSON arguments, tolerating a partial stream. */
    function readArgs(block) {
      if (typeof block.argsRaw !== 'string' || block.argsRaw === '') return {}
      try {
        const parsed = JSON.parse(block.argsRaw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /**
     * Recover the opaque image token from the settled result: `meta` is
     * authoritative for a root call, and the rendered `image:` line is the
     * fallback for a nested sub-call that carries no `meta`.
     * @param block - the settled tool-result node.
     * @returns the token, or undefined.
     */
    function readImageToken(block) {
      const meta = block.meta
      if (meta !== null && typeof meta === 'object' && typeof meta.image === 'string' && meta.image !== '') {
        return meta.image
      }
      const found = /^image:\s*(\S+)\s*$/mu.exec(resultText(block))
      return found === null ? undefined : found[1]
    }

    /** The prompt, preferring result metadata and falling back to text then args. */
    function readPrompt(block) {
      const meta = block.meta
      if (meta !== null && typeof meta === 'object' && typeof meta.prompt === 'string' && meta.prompt !== '') return meta.prompt
      const found = /^Generated a .*? image for the prompt:\s*([\s\S]*?)(?=\n(?:saved to|image):|$)/mu.exec(resultText(block))
      if (found !== null && found[1].trim() !== '') return found[1].trim()
      const args = readArgs(block)
      return typeof args.prompt === 'string' ? args.prompt : ''
    }

    /** Caption parts available before the picture loads (model, size, file). */
    function readCaption(block) {
      const meta = block.meta
      if (meta === null || typeof meta !== 'object') {
        const args = readArgs(block)
        return typeof args.size === 'string' ? args.size : ''
      }
      const parts = []
      if (typeof meta.model === 'string' && meta.model !== '') parts.push(meta.model)
      if (Number.isInteger(meta.width) && Number.isInteger(meta.height)) parts.push(meta.width + '×' + meta.height)
      else if (typeof meta.size === 'string' && meta.size !== '') parts.push(meta.size)
      if (typeof meta.file === 'string' && meta.file !== '') parts.push(meta.file)
      return parts.join(' · ')
    }
    //#endregion

    //#region component
    /**
     * Render one `generate_image` call as a prompt caption plus the picture.
     * @param props - keyed toolview payload (callId, toolName, block, cwd, openFile, inspect).
     * @returns the image card.
     */
    function ImageCard(props) {
      const block = props.block
      const settled = block.kind === 'tool-result'
      const failed = settled && block.isError === true
      const prompt = readPrompt(block)
      const caption = readCaption(block)
      const token = settled && !failed ? readImageToken(block) : undefined
      const [failedImage, setFailedImage] = React.useState(false)

      let body
      if (!settled) {
        body = React.createElement('div', { className: 'dshImgState' }, '正在作画…')
      } else if (failed) {
        body = React.createElement('div', { className: 'dshImgError' }, resultText(block) || '图片生成失败。')
      } else if (token === undefined) {
        body = React.createElement('div', { className: 'dshImgState' }, '这次结果里没有图片。')
      } else if (failedImage) {
        body = React.createElement(
          'div',
          { className: 'dshImgFoot' },
          React.createElement('span', { className: 'dshImgError' }, '图片加载不出来。'),
          React.createElement('a', {
            className: 'dshImgLink',
            href: '/image-gen/' + encodeURIComponent(token),
            target: '_blank',
            rel: 'noreferrer'
          }, '直接打开')
        )
      } else {
        body = React.createElement(
          'div',
          { className: 'dshImgFrame' },
          React.createElement('img', {
            src: '/image-gen/' + encodeURIComponent(token),
            alt: prompt === '' ? '生成的图片' : prompt,
            loading: 'lazy',
            onError: () => setFailedImage(true)
          })
        )
      }

      return React.createElement(
        'div',
        {
          className: 'dshImgCard',
          'data-tool': 'generate_image',
          'data-state': settled ? (failed ? 'error' : 'done') : 'running'
        },
        React.createElement(
          'div',
          { className: 'dshImgHead' },
          React.createElement('span', { className: 'dshImgTitle' }, '生成的图片'),
          caption === '' ? null : React.createElement('span', { className: 'dshImgMeta' }, caption)
        ),
        prompt === '' ? null : React.createElement('p', { className: 'dshImgPrompt' }, prompt),
        body
      )
    }
    //#endregion

    //#region settings panel
    /** The plugin's durable settings namespace; matches the node half. */
    const NAMESPACE = 'image-gen'

    /** Sizes the gateway accepts, mirrored from the node half. */
    const SIZES = ['512x512', '1024x1024', '1536x1024', '1024x1536']

    /**
     * Coerce a stored section into the exact fields this form edits, mirroring
     * the node half's normalizer so the panel never shows a value the tool
     * would not actually use.
     * @param raw - the stored namespace value, possibly partial.
     * @returns fully populated editable fields.
     */
    function fieldsOf(raw) {
      const v = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        apiKeyEnv: String(v.apiKeyEnv ?? 'image-gen'),
        apiKey: '',
        baseURL: String(v.baseURL ?? ''),
        model: String(v.model ?? ''),
        size: SIZES.includes(v.size) ? v.size : '1024x1024',
        saveToWorkspace: v.saveToWorkspace !== false
      }
    }

    /**
     * Render the settings section: a form over the durable namespace.
     *
     * The form holds a local draft and POSTs only the changed fields on Save, so
     * nothing reaches the host until the user commits — a half-typed URL never
     * becomes the live endpoint.
     *
     * These reads and writes go through the plugin's own `/image-gen/config`
     * endpoint rather than `settingsScope`: `dsh-host-apiproxy` gates the generic
     * settings RPC behind a hardcoded `WEB_SETTINGS_NAMESPACES` allowlist that a
     * plugin cannot extend, so `settingsScope` answers `settings-not-exposed`
     * for any namespace a plugin registers. The endpoint writes through the same
     * settings service, so the document, the schema validation, and the node
     * half's live watcher are all shared — only the transport differs.
     * @returns the settings section element.
     */
    function ImageGenSettings() {
      const [draft, setDraft] = React.useState(null)
      const [stored, setStored] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [apiKeyConfigured, setApiKeyConfigured] = React.useState(false)

      React.useEffect(() => {
        let live = true
        void (async () => {
          let error = ''
          let value = {}
          try {
            const response = await fetch('/image-gen/config', { headers: { accept: 'application/json' } })
            const body = await response.json()
            if (body.ok === true) {
              value = body.value
              setApiKeyConfigured(body.apiKeyConfigured === true)
            } else error = String(body.error ?? ('HTTP ' + response.status))
          } catch (failure) {
            error = String((failure && failure.message) || failure)
          }
          if (!live) return
          setDraft(fieldsOf(value))
          setStored(fieldsOf(value))
          if (error !== '') setNote('读取配置失败：' + error)
        })()
        return () => { live = false }
      }, [])

      if (draft === null || stored === null) {
        return React.createElement('p', { className: 'dshImgStatus' }, '正在读取配置…')
      }

      const dirty = Object.keys(stored).some((k) => stored[k] !== draft[k]) || draft.apiKey.length > 0

      const edit = (key, value) => {
        setNote('')
        setDraft((current) => ({ ...current, [key]: value }))
      }

      const save = async () => {
        setBusy(true)
        setNote('保存中…')
        try {
          const patch = {}
          for (const key of Object.keys(stored)) if (stored[key] !== draft[key]) patch[key] = draft[key]
          if (draft.apiKey !== '') patch.apiKey = draft.apiKey
          const response = await fetch('/image-gen/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch)
          })
          const body = await response.json()
          if (body.ok === true) {
            const next = fieldsOf(body.value)
            setStored(next)
            setDraft({ ...next, apiKey: '' })
            setApiKeyConfigured(body.apiKeyConfigured === true)
            setNote('已安全保存 API Key；下次生图即生效，无需重启。')
          } else {
            setNote('保存失败：' + String(body.error ?? ('HTTP ' + response.status)))
          }
        } catch (error) {
          setNote('保存失败：' + String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }

      const revert = () => {
        setDraft(stored)
        setNote('已还原为已保存的值。')
      }

      const field = (label, hint, input) => React.createElement(
        'div',
        { className: 'dshImgField' },
        React.createElement('span', { className: 'dshImgLabel' }, label),
        input,
        hint === '' ? null : React.createElement('p', { className: 'dshImgHint' }, hint)
      )

      const text = (key, placeholder) => React.createElement(Input, {
        value: draft[key],
        placeholder,
        spellCheck: false,
        disabled: busy,
        onChange: (event) => edit(key, event.target.value)
      })

      return React.createElement(
        'div',
        { className: 'dshImgForm', 'data-plugin-settings': NAMESPACE },
        field(
          '图片模型',
          '对应请求里的 `model` 字段。本网关提供的是 gpt-image-2。',
          text('model', 'gpt-image-2')
        ),
        field(
          '接口地址',
          'OpenAI 兼容的根地址，后面会自动拼上 `/images/generations`。',
          text('baseURL', 'https://host/v1')
        ),
        field(
          'API Key',
          apiKeyConfigured ? '密钥已安全保存；如需更换，输入新密钥后保存。留空不会清除现有密钥。' : '输入图片网关的 API Key。密钥会安全保存到凭据库，不会写进普通设置文件。',
          React.createElement(Input, {
            type: 'password',
            value: draft.apiKey,
            placeholder: apiKeyConfigured ? '已配置（输入新密钥可替换）' : '粘贴 API Key',
            autoComplete: 'new-password',
            spellCheck: false,
            disabled: busy,
            onChange: (event) => edit('apiKey', event.target.value)
          })
        ),
        field(
          '默认尺寸',
          '调用时未指定 `size` 就用这个。',
          React.createElement(
            'div',
            { className: 'dshImgSizes' },
            SIZES.map((size) => React.createElement(
              'button',
              {
                key: size,
                type: 'button',
                className: 'dshImgChip',
                'aria-pressed': draft.size === size,
                disabled: busy,
                onClick: () => edit('size', size)
              },
              size
            ))
          )
        ),
        field(
          '工作区副本',
          '同时把 PNG 存到会话的工作目录里。',
          React.createElement(
            'label',
            { className: 'dshImgToggle' },
            React.createElement('input', {
              type: 'checkbox',
              checked: draft.saveToWorkspace,
              disabled: busy,
              onChange: (event) => edit('saveToWorkspace', event.target.checked)
            }),
            '在工作区里另存一份'
          )
        ),
        React.createElement(
          'div',
          { className: 'dshImgActions' },
          React.createElement(
            Button,
            {
              variant: 'primary',
              size: 'md',
              disabled: busy || !dirty,
              onClick: () => { void save() }
            },
            '保存'
          ),
          React.createElement(
            Button,
            {
              variant: 'ghost',
              size: 'md',
              disabled: busy || !dirty,
              onClick: revert
            },
            '还原'
          ),
          React.createElement('span', { className: 'dshImgStatus' }, note)
        )
      )
    }
    //#endregion

    //#region plugin
    /** Client services this plugin needs. */
    const inject = ['slots']

    /**
     * Client plugin body: claim the `generate_image` tool row and contribute the
     * settings panel.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key: 'generate_image'
        },
        ImageCard
      ))

      // No `settingsScope` here: the namespace this plugin owns is not on the
      // proxy's exposure allowlist, so the panel talks to `/image-gen/config`.
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: NAMESPACE,
          order: 40,
          label: () => '图片生成'
        },
        ImageGenSettings
      ))
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
