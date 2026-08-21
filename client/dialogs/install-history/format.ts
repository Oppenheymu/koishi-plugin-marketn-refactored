import type { InstallHistoryChange, InstallHistoryEntry } from 'koishi-plugin-marketn-refactored'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** 安装历史状态文案（列表行与详情头共用）。 */
export function historyStatusText(t: Translate, status: InstallHistoryEntry['status']) {
  switch (status) {
    case 'running': return t('operations.history.statusRunning')
    case 'success': return t('operations.history.statusSuccess')
    case 'error': return t('operations.history.statusError')
    default: return t('operations.history.statusUnknown')
  }
}

/** 安装历史条目标题：按变更方向聚合（安装/更新/卸载）。 */
export function historyTitle(t: Translate, entry: InstallHistoryEntry) {
  if (!entry.changes.length) return t('operations.history.operation')
  let installed = 0
  let removed = 0
  let updated = 0
  for (const change of entry.changes) {
    if (!change.beforeRequest && change.afterRequest) installed++
    else if (change.beforeRequest && !change.afterRequest) removed++
    else updated++
  }
  const groups = [
    installed && t('operations.history.install', { count: installed }),
    updated && t('operations.history.update', { count: updated }),
    removed && t('operations.history.uninstall', { count: removed }),
  ].filter(Boolean)
  if (groups.length === 1) return groups[0]
  return t('operations.history.changed', { count: entry.changes.length })
}

/** 时间戳本地化展示。 */
export function historyDate(t: Translate, value: number, locale: string) {
  if (!Number.isFinite(value) || value <= 0) return t('operations.history.unknownTime')
  return new Date(value).toLocaleString(locale)
}

/** 耗时展示（ms / 秒 / 分秒）。 */
export function historyDuration(t: Translate, value: number) {
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`
  if (value < 60000) return t('common.time.seconds', { count: (value / 1000).toFixed(value < 10000 ? 1 : 0) })
  const minutes = Math.floor(value / 60000)
  const seconds = Math.round(value % 60000 / 1000)
  return t('common.time.minutesSeconds', { minutes, seconds })
}

/** 安装源展示（默认源 / URL 主机名）。 */
export function historyEndpoint(t: Translate, endpoint?: string) {
  if (!endpoint) return t('operations.history.defaultSource')
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

/** 日志大小展示。 */
export function historySize(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/** 版本变更的前置版本展示。 */
export function beforeVersion(t: Translate, change: InstallHistoryChange) {
  return change.beforeResolved || change.beforeRequest || t('operations.history.notInstalled')
}

/** 版本变更的后置版本展示。 */
export function afterVersion(t: Translate, change: InstallHistoryChange) {
  return change.afterResolved || change.afterRequest || t('operations.history.uninstalled')
}
