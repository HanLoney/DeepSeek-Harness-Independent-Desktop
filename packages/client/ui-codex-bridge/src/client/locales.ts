/** Copy dictionaries for the Codex bridge settings section. */

/** Chinese strings (the key-set source of truth for this pair). */
export const zh = {
  nav: 'Codex 桥接',
  title: 'Codex 桥接',
  intro: '把本机 Codex 的历史会话导入为 DSH 会话，或把 DSH 会话导出回 Codex。',
  threadsHeading: '可导入的 Codex 线程',
  sessionsHeading: '可导出的 DSH 会话',
  refresh: '刷新',
  loading: '正在读取…',
  loadFailed: '读取失败',
  emptyThreads: '没有在 Codex 目录下找到线程。',
  emptySessions: '没有在会话根目录下找到会话。',
  import: '导入',
  importProject: '导入整个项目',
  export: '导出',
  dryRun: '仅预演',
  shards: '{count} 个分片',
  project: '项目',
  noProject: '未归类项目',
  untitled: '(无标题)',
  logHeading: '进度',
  noRun: '还没有开始任何操作。',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  stage: '阶段',
  bytes: '大小',
  result: '结果',
} as const

/** English strings, keyed by the Chinese source set. */
export const en: Record<CodexBridgeKey, string> = {
  nav: 'Codex Bridge',
  title: 'Codex Bridge',
  intro: 'Import a local Codex session as a DSH session, or export a DSH session back to Codex.',
  threadsHeading: 'Codex threads available to import',
  sessionsHeading: 'DSH sessions available to export',
  refresh: 'Refresh',
  loading: 'Loading…',
  loadFailed: 'Loading failed',
  emptyThreads: 'No threads were found under the Codex home.',
  emptySessions: 'No sessions were found under the session root.',
  import: 'Import',
  importProject: 'Import project',
  export: 'Export',
  dryRun: 'Dry run',
  shards: '{count} shard(s)',
  project: 'Project',
  noProject: 'No project',
  untitled: '(untitled)',
  logHeading: 'Progress',
  noRun: 'No operation has been started yet.',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stage: 'Stage',
  bytes: 'Size',
  result: 'Result',
}

/** The key set both dictionaries share. */
export type CodexBridgeKey = keyof typeof zh

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.codexBridge'
