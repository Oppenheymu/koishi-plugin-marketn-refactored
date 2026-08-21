import { store } from '@koishijs/client'
import { gt } from 'semver'
import { translate } from '../i18n'
import {
  getUpdateCandidates as getSharedUpdateCandidates,
  isUpdateCheckDisabled,
  isUpdateVersionIgnored,
  normalizeUpdateIgnoreCount,
  normalizeUpdateIgnoreRule,
  type UpdateIgnoreRule,
} from '../../src/shared/update'
import { isLocalDependency } from '../../src/shared/dependency-source'
import type { UpdateIgnoreOptions, UpdatePolicy } from './market-config'

export type { UpdateIgnoreRule } from '../../src/shared/update'
export { isUpdateCheckDisabled } from '../../src/shared/update'

export function createUpdateIgnoreRule(name: string, policy?: UpdatePolicy, options: UpdateIgnoreOptions = {}): UpdateIgnoreRule | undefined {
  const version = getLatestVersion(name, policy)
  if (!version) return
  const duration = Math.max(0, options.duration ?? policy?.updateIgnoreDuration ?? 0)
  const count = normalizeUpdateIgnoreCount(options.count ?? policy?.updateIgnoreVersions)
  const now = Date.now()
  return {
    version,
    count,
    ignoredAt: now,
    until: duration ? now + duration : undefined,
  }
}

export function getLatestVersion(name: string, policy?: UpdatePolicy) {
  const candidates = getUpdateCandidates(name, policy)
  return candidates.find(version => !isUpdateVersionIgnored(name, version, candidates, policy))
}

export function getIgnoredUpdateVersion(name: string, policy?: UpdatePolicy) {
  if (isUpdateCheckDisabled(name, policy)) return
  const latest = getUpdateCandidates(name, policy)[0]
  if (!latest || !isVersionIgnored(name, latest, policy)) return
  return latest
}

export function getUpdateIgnoreText(name: string, policy?: UpdatePolicy) {
  const rule = normalizeUpdateIgnoreRule(policy?.updateIgnored?.[name])
  if (!rule?.version) return ''
  const parts = [translate('common.ignore.version', { version: rule.version })]
  if (rule.count && rule.count > 1) parts.push(translate('common.ignore.count', { count: rule.count }))
  if (rule.until) parts.push(translate('common.ignore.until', { time: new Date(rule.until).toLocaleString() }))
  return parts.join(translate('common.ignore.separator'))
}

export function isUpdateIgnored(name: string, policy?: UpdatePolicy) {
  return !!getIgnoredUpdateVersion(name, policy)
}

export function hasUpdate(name: string, policy?: UpdatePolicy) {
  const latest = getLatestVersion(name, policy)
  const local = store.dependencies?.[name]
  if (!latest || isLocalDependency(local)) return
  try {
    return gt(latest, local.resolved)
  } catch {}
}

function getUpdateCandidates(name: string, policy?: UpdatePolicy) {
  const local = store.dependencies?.[name]
  if (isLocalDependency(local)) return []
  return getSharedUpdateCandidates(Object.keys(store.registry?.[name] ?? {}), local?.resolved, policy)
}

function isVersionIgnored(name: string, version: string, policy?: UpdatePolicy) {
  const candidates = getUpdateCandidates(name, policy)
  return isUpdateVersionIgnored(name, version, candidates, policy)
}
