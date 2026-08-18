/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.background': '自定义背景',
  'appearance.backgroundPreview': '背景图片预览',
  'appearance.backgroundOpacity': '背景透明度',
  'appearance.chooseBackground': '选择图片',
  'appearance.compressingBackground': '正在压缩…',
  'appearance.clearBackground': '清除背景',
  'appearance.backgroundError': '图片读取或压缩失败，请换一张图片',
  'appearance.prompt': '个性化提示词',
  'appearance.promptPlaceholder': '输入希望模型遵循的额外规则',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.background': 'Custom background',
  'appearance.backgroundPreview': 'Background image preview',
  'appearance.backgroundOpacity': 'Background opacity',
  'appearance.chooseBackground': 'Choose image',
  'appearance.compressingBackground': 'Compressing…',
  'appearance.clearBackground': 'Clear background',
  'appearance.backgroundError': 'The image could not be read or compressed. Try another image.',
  'appearance.prompt': 'Personalized prompt',
  'appearance.promptPlaceholder': 'Add extra guidance for the model',
} satisfies Record<ThemeKey, string>
