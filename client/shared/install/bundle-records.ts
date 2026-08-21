import { type Context, type Dict, send, store } from '@koishijs/client'
import type { Registry } from '@koishijs/registry'
import {
  getBundleGroupIdent,
  getPluginShortname,
  isBundlePackageName,
  parseBundleManifest,
  type PluginBundleManifest,
  type PluginBundleRecord,
} from '../../../src/shared/bundle'
import { getConfigWriter } from './config-writer'
import type { BundleMemberCleanupTarget } from '../ui/dialogs'

export type BundleRecordView = PluginBundleRecord & {
  fallback?: boolean
}

function createBundleRecordFromManifest(packageName: string, version = '', bundle?: PluginBundleManifest, fallback = true): BundleRecordView | undefined {
  if (!isBundlePackageName(packageName)) return
  return {
    package: packageName,
    version,
    label: bundle?.label || getPluginShortname(packageName),
    groupKey: `group:${getBundleGroupIdent(packageName)}`,
    installedAt: 0,
    fallback,
    members: (bundle?.members ?? []).map(member => ({
      ...member,
      selected: true,
      installedByBundle: false,
      skipped: true,
    })),
  }
}

export function createLocalBundleRecord(packageName: string): BundleRecordView | undefined {
  if (!isBundlePackageName(packageName)) return
  const local = store.packages?.[packageName]
  const dep = store.dependencies?.[packageName]
  if (!local && !dep) return
  const bundle = parseBundleManifest((local?.package as any)?.koishi?.bundle)
  if (!bundle?.members.length) return
  return createBundleRecordFromManifest(packageName, dep?.resolved ?? local?.package.version ?? '', bundle)
}

export function resolveBundlePackageFromGroup(groupPath?: string, records: Dict<PluginBundleRecord> = {}) {
  if (!groupPath) return
  const groupKey = groupPath.startsWith('group:') ? groupPath : `group:${groupPath}`
  const byRecord = Object.values(records).find(record => record?.groupKey === groupKey)
  if (byRecord?.package) return byRecord.package
  const names = new Set([
    ...Object.keys(store.dependencies ?? {}),
    ...Object.keys(store.packages ?? {}),
  ])
  return [...names].find((name) => {
    const record = createLocalBundleRecord(name)
    return !!record && getBundleGroupIdent(name) === groupPath.replace(/^group:/, '')
  })
}

export function resolveBundleRecordFromGroup(groupPath?: string, records: Dict<PluginBundleRecord> = {}) {
  const packageName = resolveBundlePackageFromGroup(groupPath, records)
  if (!packageName) return
  return records[packageName] || createLocalBundleRecord(packageName)
}

function normalizeGroupPath(path?: string) {
  return path?.replace(/^group:/, '')
}

function isBundleGroupPath(path: string | undefined, groupKey: string | undefined) {
  if (!path || !groupKey) return false
  return normalizeGroupPath(path) === normalizeGroupPath(groupKey)
}

export function getBundleMemberConfigState(ctx: Context, member: BundleMemberCleanupTarget, groupKey?: string) {
  const configWriter = getConfigWriter(ctx)
  const nodes = [
    ...(configWriter?.get(member.package) ?? []),
    ...(member.plugin ? configWriter?.get(member.plugin) ?? [] : []),
  ]
  const unique = new Map<string, any>()
  for (const node of nodes) {
    if (!node) continue
    unique.set(node.path || node.id, node)
  }
  const entries = [...unique.values()]
  const getParentPath = (node: any) => node.parent?.path || node.parent?.id
  return {
    all: entries,
    group: entries.filter(node => isBundleGroupPath(getParentPath(node), groupKey)),
    external: entries.filter(node => !isBundleGroupPath(getParentPath(node), groupKey)),
  }
}

export async function fetchBundleRecord(packageName: string): Promise<BundleRecordView | undefined> {
  if (!isBundlePackageName(packageName)) return
  const registry = await (send('market/package', packageName) ?? Promise.resolve(undefined)).catch((error) => {
    console.warn(error)
    return undefined
  }) as Registry | undefined
  if (!registry?.versions) return createLocalBundleRecord(packageName)
  const targetVersion = store.dependencies?.[packageName]?.resolved ?? store.packages?.[packageName]?.package.version
  const entry = targetVersion && registry.versions?.[targetVersion]
    ? [targetVersion, registry.versions[targetVersion]] as const
    : Object.entries(registry.versions ?? {})[0]
  if (!entry) return createLocalBundleRecord(packageName)
  const [version, remote] = entry
  const bundle = parseBundleManifest((remote as any)?.koishi?.bundle)
  if (!bundle?.members.length) return createLocalBundleRecord(packageName)
  return createBundleRecordFromManifest(packageName, version, bundle)
}
