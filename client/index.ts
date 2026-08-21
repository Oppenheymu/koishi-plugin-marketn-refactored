import { global } from '@koishijs/client'
import type { Context } from '@koishijs/client'
import { registerMarketNextI18n, translate } from './i18n'
import { setupStoreSync } from './shared/sync/store-sync'
import { registerSlots } from './slots'
import { registerActions } from './actions'
import extensions from './extensions'
import { createPageBoundary } from './shared/ui/page-boundary'
import Market from './pages/market/index.vue'
import Dependencies from './pages/dependencies/index.vue'
import './icons'
import './styles/scrollbars.scss'
import './styles/version-select.scss'

import 'virtual:uno.css'

declare module '@koishijs/client' {
  interface Config {
    // 宿主 KOISHI_CONFIG 无此字段时走 getMarketNextConfig 的兜底，因此声明为可选
    market?: MarketConfig
  }
}

interface MarketConfig {
  bulkMode?: boolean
  removeConfig?: boolean
  updateIgnoredPackages?: string
  updateIgnoreDuration?: number
  updateIgnoreVersions?: number
  updateIgnorePrerelease?: boolean
  gravatar?: string
  search?: {
    endpoint?: string
    timeout?: number
    autoRoute?: boolean
    logLevel?: string
  }
}

const GuardedMarket = createPageBoundary('Market', Market)
const GuardedDependencies = createPageBoundary('Dependencies', Dependencies)

export default (ctx: Context) => {
  registerMarketNextI18n(ctx)

  if (global.devMode) {
    const registeredAt = performance.now()
    console.info('[market-next] console entry registered')
    ctx.effect(() => () => {
      console.info(`[market-next] console entry disposed after ${Math.round(performance.now() - registeredAt)}ms`)
    })
  }

  setupStoreSync(ctx)
  registerSlots(ctx)

  ctx.page({
    id: 'market',
    path: '/market',
    name: () => translate('common.pages.market'),
    icon: 'activity:market',
    order: 750,
    authority: 4,
    fields: ['market'],
    component: GuardedMarket,
  })

  try {
    extensions(ctx)
  } catch (error) {
    console.warn('[market-next] failed to initialize console extensions', error)
  }

  registerActions(ctx)

  if (!global.static) {
    ctx.page({
      id: 'dependencies',
      path: '/dependencies',
      name: () => translate('common.pages.dependencies'),
      icon: 'activity:deps',
      order: 700,
      authority: 4,
      fields: ['dependencies', 'registry', 'registryStatus'],
      component: GuardedDependencies,
    })
  }
}
