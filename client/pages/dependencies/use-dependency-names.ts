/**
 * @file 依赖页的包名全集与元数据预取 composable(dependencies 域)。
 *
 * 页面展示的包名 = 依赖表 + 待应用 override + packages 里被发现的本地
 * 插件(未配置/可管理合包/通过发现规则);集合变化时增量拉市场元数据,
 * registry 就绪后为 override 新增包补拉 manual 元数据。
 */

import { computed, watch, type WatchStopHandle } from 'vue'
import { store, type Context } from '@koishijs/client'
import { addManual, getConfigWriter } from '../../shared/operations'
import { getPendingOverrides } from '../../shared/plugin-config'
import { shouldIncludeDiscoveredLocalPlugin } from '../../../src/shared/dependency-source'
import { isPluginPackage } from '../../market/utils'
import { loadMarketObjects } from '../../market/state'
import { isManageableBundle, isUnconfigured } from './dependency-helpers'

export function useDependencyNames(ctx: Context, config: { value: unknown }) {
  /**
   * 页面展示的包名全集:依赖表 + 待应用 override + packages 里符合条件的
   * 本地包(未配置插件包、可管理合包、通过发现规则筛选的本地插件),排序去重。
   */
  const names = computed(() => {
    const configWriter = getConfigWriter(ctx)
    const explicit: Record<string, unknown> = {
      ...(store.dependencies ?? {}),
      ...getPendingOverrides(),
    }
    for (const name of Object.keys(store.packages ?? {})) {
      const pkg = store.packages?.[name]
      if (isUnconfigured(name, ctx, config.value, configWriter)
        || isManageableBundle(name, config.value)
        || isPluginPackage(name) && shouldIncludeDiscoveredLocalPlugin({
          declared: !!store.dependencies?.[name],
          configured: !!configWriter?.get(name)?.length,
          running: !!pkg?.runtime?.id,
          workspace: !!pkg?.workspace,
        })) {
        explicit[name] = true
      }
    }
    return Object
      .keys(explicit)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  })

  /** 包名集合变化时增量拉取市场元数据(卡片描述/分类等展示用)。 */
  watch(names, (value) => {
    void loadMarketObjects(value).catch(error => {
      console.error('[market-next] failed to load dependency market metadata', error)
    })
  }, { immediate: true })

  let dispose: WatchStopHandle | undefined
  /** registry 就绪后:监听 override 里新增的待应用包,为其补拉 manual 元数据(不在依赖表时 classify 需要)。 */
  watch(() => store.market?.registry, (registry) => {
    dispose?.()
    if (!registry) return
    dispose = watch(() => getPendingOverrides(), (object) => {
      if (!object) return
      Object.keys(object).forEach(async (name) => {
        if (store.dependencies?.[name]) return
        addManual(name)
      })
    }, { immediate: true, deep: true })
  }, { immediate: true })

  return { names, disposeNamesWatcher: () => dispose?.() }
}
