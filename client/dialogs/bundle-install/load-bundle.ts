import type { Ref } from 'vue'
import { store } from '@koishijs/client'
import type { Context } from '@koishijs/client'
import type { Registry, SearchObject } from '@koishijs/registry'
import { satisfies } from 'semver'
import { getBundleGroupIdent } from '../../../src/shared/bundle-idents'
import {
  type BundleInstallMember,
  type PluginBundleManifest,
  parseBundleManifest,
} from '../../../src/shared/bundle'
import { getBundleMemberConfigState } from '../../shared/install/bundle-records'
import { loadMarketObjects } from '../../market/state'
import { requestMarketPackage, requestMarketRegistry } from '../../market/api'

// 套装元数据加载所需的响应式状态（由 useBundleInstall 构造后传入）。
export interface BundleLoaderState {
  ctx: Context
  t: (key: string, ...args: any[]) => string
  loading: Ref<boolean>
  error: Ref<string>
  registry: Ref<Registry | undefined>
  bundle: Ref<PluginBundleManifest | undefined>
  resolvedBundleVersion: Ref<string>
  members: BundleInstallMember[]
  memberJsonErrors: Record<string, string>
}

/** 拉取套装包元数据并构建成员初始状态（conflict/预置配置/安装勾选）。 */
export function createBundleLoader(state: BundleLoaderState) {
  const { ctx, t, loading, error, registry, bundle, resolvedBundleVersion, members, memberJsonErrors } = state

  function buildMemberEntries(value: SearchObject, parsed: PluginBundleManifest): BundleInstallMember[] {
    const groupKey = `group:${getBundleGroupIdent(value.package.name)}`
    return parsed.members.map(member => {
      const state = getBundleMemberConfigState(ctx, member, groupKey)
      const hasConfig = !!(state.group.length || state.external.length)
      const conflictType = state.group.length ? 'same-group' : state.external.length ? 'other-config' : undefined

      const dep = store.dependencies?.[member.package]
      const isMismatch = dep?.resolved && !satisfies(dep.resolved, member.version, { includePrerelease: true })

      return {
        ...member,
        selected: !!member.required || (!!dep && !isMismatch),
        createConfig: !hasConfig && conflictType !== 'same-group',
        usePreset: !hasConfig && !!member.config && Object.keys(member.config).length > 0,
        move: false,
        conflict: (conflictType || (isMismatch ? 'package-mismatch' : undefined))!,
      }
    })
  }

  async function loadBundle(value?: SearchObject) {
    error.value = ''
    registry.value = undefined
    bundle.value = undefined
    resolvedBundleVersion.value = ''
    members.splice(0)
    Object.keys(memberJsonErrors).forEach(key => delete memberJsonErrors[key])
    if (!value) return
    loading.value = true
    try {
      const data = await requestMarketPackage(value.package.name) as Registry
      if (!data?.versions) {
        error.value = t('bundle.messages.noMetadata')
        return
      }
      registry.value = data
      const remoteEntry = data.versions?.[value.package.version]
        ? [value.package.version, data.versions[value.package.version]] as const
        : Object.entries(data.versions ?? {})[0]
      if (!remoteEntry) {
        error.value = t('bundle.messages.noMetadata')
        return
      }
      const [remoteVersion, remote] = remoteEntry
      const parsed = parseBundleManifest((remote as any)?.koishi?.bundle)
      if (!parsed) {
        error.value = t('bundle.messages.noManifest')
        return
      }
      resolvedBundleVersion.value = remoteVersion
      bundle.value = parsed
      void loadMarketObjects(parsed.members.map(member => member.package)).catch(error => {
        console.error('[market-next] failed to load bundle member metadata', error)
      })
      members.push(...buildMemberEntries(value, parsed))
      const names = parsed.members.map(member => member.package).filter(name => !store.registry?.[name])
      if (names.length) {
        const result = await requestMarketRegistry(names).catch(() => undefined)
        if (result) store.registry = { ...store.registry, ...result }
      }
    } catch (err) {
      console.error(err)
      error.value = err instanceof Error ? err.message : t('bundle.messages.loadFailed')
    } finally {
      loading.value = false
    }
  }

  return { loadBundle }
}
