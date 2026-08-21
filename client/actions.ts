import { ref, watch } from 'vue'
import { message, router, send, store } from '@koishijs/client'
import type { Context } from '@koishijs/client'
import { translate } from './i18n'
import { getPendingOverrides } from './shared/config/data-store'
import { showConfirm, showEnvironmentVersions, showInstallHistory, showManual } from './shared/ui/dialogs'
import type { MarketStore } from './shared/sync/store-sync'

export function registerActions(ctx: Context) {
  const refreshingMarket = ref(false)
  const refreshingDependencies = ref(false)
  const pendingMarketRefreshFeedback = ref(false)

  function finishMarketRefreshFeedback() {
    if (!pendingMarketRefreshFeedback.value) return
    pendingMarketRefreshFeedback.value = false
    if (store.market?.stale || store.market?.error) {
      message.error(translate('common.messages.refreshMarketFailed'))
    } else {
      message.success(translate('common.messages.refreshMarketSuccess'))
    }
  }

  ctx.action('market.refresh', {
    shortcut: 'ctrl+r',
    disabled: () => !['market', 'dependencies'].includes(router.currentRoute.value?.meta?.activity.id),
    async action() {
      const activity = router.currentRoute.value?.meta?.activity.id
      const dependencies = activity === 'dependencies'
      const refreshing = dependencies ? refreshingDependencies : refreshingMarket
      if (refreshing.value) return
      refreshing.value = true
      if (!dependencies) pendingMarketRefreshFeedback.value = true
      try {
        await send(dependencies ? 'market/refresh-dependencies' : 'market/refresh')
        if (dependencies) {
          message.success(translate('common.messages.refreshDependenciesStarted'))
        } else {
          message.success(translate('common.messages.refreshMarketSubmitted'))
          setTimeout(() => {
            if (!store.market?.refreshing) finishMarketRefreshFeedback()
          }, 300)
        }
      } catch (error) {
        if (!dependencies) pendingMarketRefreshFeedback.value = false
        console.error(error)
        message.error(translate('common.messages.refreshFailed'))
      } finally {
        refreshing.value = false
      }
    },
  })

  ctx.action('market.install', {
    disabled: () => !Object.keys(getPendingOverrides()).length,
    action() {
      showConfirm.value = true
    },
  })

  ctx.action('dependencies.manual', {
    action() {
      showManual.value = true
    },
  })

  ctx.action('dependencies.history', {
    action() {
      showInstallHistory.value = true
    },
  })

  ctx.action('dependencies.versions', {
    action() {
      showEnvironmentVersions.value = true
    },
  })

  ctx.menu('market', [{
    id: '.install',
    icon: 'check',
    label: () => translate('common.actions.apply'),
  }, {
    id: '.refresh',
    icon: 'refresh',
    label: () => translate('common.actions.refresh'),
    type: () => refreshingMarket.value || !store.market || store.market.refreshing || store.market.progress < store.market.total ? 'spin disabled' : '',
  }])

  const registryRefreshing = () => {
    const target = store as MarketStore
    return Object.values(target.registryStatus ?? {}).some(status => status.loading)
  }

  ctx.menu('dependencies', [{
    id: '.upgrade',
    icon: 'rocket',
    label: () => translate('common.actions.upgradeAll'),
  }, {
    id: 'market.install',
    icon: 'check',
    label: () => translate('common.actions.apply'),
  }, {
    id: '.manual',
    icon: 'add',
    label: () => translate('common.actions.manual'),
  }, {
    id: '.history',
    icon: 'info-full',
    label: () => translate('common.actions.history'),
  }, {
    id: '.versions',
    icon: 'file-archive',
    label: () => translate('common.actions.versionManagement'),
  }, {
    id: 'market.refresh',
    icon: 'refresh',
    label: () => translate('common.actions.refresh'),
    type: () => refreshingDependencies.value || registryRefreshing() ? 'spin disabled' : '',
  }])

  ctx.effect(() => {
    return watch(() => store.market?.refreshing, (refreshing, previous) => {
      if (!pendingMarketRefreshFeedback.value || refreshing || previous !== true) return
      finishMarketRefreshFeedback()
    })
  })
}
