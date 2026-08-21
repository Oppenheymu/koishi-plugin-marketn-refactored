import { computed, reactive, type Ref } from 'vue'
import { type Dict, store } from '@koishijs/client'
import type { PeerInfo } from '../../shared/install/analyze-versions'
import { getPendingOverrides } from '../../shared/config/data-store'
import { getRegistryStatus } from '../../shared/install/registry-status'
import { isLocalDependency } from '../../../src/shared/dependency-source'
import { active } from '../../shared/ui/dialogs'

/** 版本选择与覆盖状态（自 useInstall 拆出）：bulkMode 下写 pendingOverrides，否则写本地 versions。 */
export function useInstallVersions(bulkMode: Ref<boolean>) {
  const versions = reactive<Dict<string>>({})

  const version = computed({
    get: () => versions[active.value],
    set: (value) => versions[active.value] = value!,
  })

  const selectVersion = computed({
    get: () => version.value,
    set(value) {
      version.value = value
    },
  })

  function getOverride() {
    return bulkMode.value ? getPendingOverrides() : versions
  }

  function getVersion(name: string) {
    const override = getOverride()
    return override[name]!
  }

  function setVersion(name: string, version: string) {
    const override = getOverride()
    if (version) {
      override[name] = version
    } else {
      delete override[name]
    }
  }

  function getWorkspaceVersion(name: string) {
    // workspace plugins:     dependencies ? packages √
    // workspace non-plugins: dependencies √ packages ×
    if (store.dependencies?.[name]?.workspace) {
      return store.dependencies?.[name]?.resolved
    }
    if (store.packages?.[name]?.workspace) {
      return store.packages?.[name]?.package.version
    }
  }

  const workspace = computed(() => getWorkspaceVersion(active.value))
  const localSelection = computed(() => isLocalPackageSelection(active.value))

  function isLocalPackageSelection(name: string) {
    if (!name) return false
    const dependency = store.dependencies?.[name]
    return isLocalDependency(dependency)
      || !!getWorkspaceVersion(name)
      || !dependency && !!store.packages?.[name]
  }

  function shouldShowPeerVersionSelect(peer: PeerInfo, name: string) {
    if (!store.registry?.[name] || isLocalPackageSelection(name)) return false
    if (name in getOverride()) return true
    return peer.result === 'danger'
  }

  function getPeerResolvedVersion(peer: PeerInfo, name: string) {
    return getVersion(name)
      || getWorkspaceVersion(name)
      || peer.resolved
      || store.dependencies?.[name]?.resolved
      || store.packages?.[name]?.package.version
  }

  function shouldFetchRegistry(name: string) {
    return !store.registry?.[name]
      && !isLocalPackageSelection(name)
      && !getRegistryStatus(name)?.loading
  }

  return {
    versions,
    version,
    selectVersion,
    getOverride,
    getVersion,
    setVersion,
    getWorkspaceVersion,
    workspace,
    localSelection,
    isLocalPackageSelection,
    shouldShowPeerVersionSelect,
    getPeerResolvedVersion,
    shouldFetchRegistry,
  }
}
