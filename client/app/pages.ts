import { defineComponent, h } from 'vue'
import { Context, global, router } from '@koishijs/client'
import { translate } from '../shared/i18n'
import extensions from '../extensions'
import Dependencies from '../pages/dependencies/dependencies.vue'
import Install from '../dialogs/install.vue'
import BundleInstall from '../dialogs/bundle-install.vue'
import Confirm from '../dialogs/confirm.vue'
import InstallProgress from '../dialogs/install-progress.vue'
import InstallHistory from '../dialogs/install-history.vue'
import EnvironmentVersions from '../dialogs/environment-versions.vue'
import Market from '../pages/market/market.vue'
import Progress from '../dialogs/progress.vue'
import { createPageBoundary } from '../shared/page-boundary'

const GuardedMarket = createPageBoundary('Market', Market)
const GuardedDependencies = createPageBoundary('Dependencies', Dependencies)

export function setupPages(ctx: Context) {
  ctx.slot({
    type: 'welcome-choice',
    component: defineComponent(() => () => h('div', {
      class: 'choice',
      onClick: () => router.push('/market'),
    }, [
      h('h2', translate('common.welcome.marketTitle')),
      h('p', translate('common.welcome.marketDescription')),
    ])),
  })

  ctx.slot({
    type: 'global',
    component: Install,
  })

  ctx.slot({
    type: 'global',
    component: BundleInstall,
  })

  ctx.slot({
    type: 'global',
    component: Confirm,
  })

  ctx.slot({
    type: 'global',
    component: InstallProgress,
  })

  ctx.slot({
    type: 'global',
    component: InstallHistory,
  })

  ctx.slot({
    type: 'global',
    component: EnvironmentVersions,
  })

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

  if (!global.static) {
    ctx.slot({
      type: 'status-right',
      component: Progress,
      order: 10,
    })

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
