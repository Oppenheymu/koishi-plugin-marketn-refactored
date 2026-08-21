import { watch, type ComputedRef, type Ref } from 'vue'
import { type Dict, store } from '@koishijs/client'
import type { PeerInfo } from '../../shared/install/analyze-versions'
import { active } from '../../shared/ui/dialogs'
import { getPendingOverrides } from '../../shared/config/data-store'
import { requestMarketRegistry } from '../../market/api'

// registry 数据同步所需的版本状态（由 useInstallVersions 构造后传入）。
export interface InstallRegistrySyncInput {
  bulkMode: Ref<boolean>
  data: ComputedRef<Record<string, { peers?: Dict<PeerInfo> } | undefined> | undefined>
  version: Ref<string>
  versions: Dict<string>
  shouldFetchRegistry: (name: string) => boolean
}

/** peer/激活目标变化时拉取 registry 元数据并重建版本选择（自 useInstall 拆出的两个 watch）。 */
export function useInstallRegistrySync(input: InstallRegistrySyncInput) {
  const { bulkMode, data, version, versions, shouldFetchRegistry } = input

  watch(() => data.value?.[version.value]?.peers, async (peers) => {
    if (!peers) return
    const names = Object.keys(peers).filter(shouldFetchRegistry)
    let registry: typeof store.registry = {}
    if (names.length) {
      try {
        registry = await requestMarketRegistry(names)
      } catch (error) {
        console.error(error)
      }
    }
    Object.assign(registry, store.registry)
    if (bulkMode.value) return

    // rebuild versions
    for (const name of Object.keys(versions)) {
      if (name === active.value) continue
      if (name in peers) continue
      delete versions[name]
    }
    for (const name in peers) {
      if (!registry[name]) continue
      const { result } = peers[name]!
      if (result !== 'warning' && result !== 'danger') continue
      versions[name] = Object.keys(registry[name])[0]!
    }
  })

  watch(active, async (name) => {
    if (!name) return

    version.value = getPendingOverrides()[active.value]
      || store.dependencies?.[active.value]?.request
      || Object.keys(store.registry?.[name] || {})[0]

    if (shouldFetchRegistry(name)) {
      try {
        const registry = await requestMarketRegistry([name])
        const versions = registry?.[active.value] || store.registry?.[active.value]
        if (versions) version.value = Object.keys(versions)[0]
      } catch (error) {
        console.error(error)
      }
    }
  }, { immediate: true })
}
