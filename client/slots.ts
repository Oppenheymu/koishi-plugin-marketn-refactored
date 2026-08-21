import { defineComponent, h } from 'vue'
import { global, router } from '@koishijs/client'
import type { Context } from '@koishijs/client'
import { translate } from './i18n'
import Install from './dialogs/install/index.vue'
import BundleInstall from './dialogs/bundle-install/index.vue'
import Confirm from './dialogs/confirm.vue'
import InstallProgress from './dialogs/install-progress.vue'
import InstallHistory from './dialogs/install-history/index.vue'
import EnvironmentVersions from './dialogs/environment-versions/index.vue'
import Progress from './components/progress.vue'

export function registerSlots(ctx: Context) {
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

  if (!global.static) {
    ctx.slot({
      type: 'status-right',
      component: Progress,
      order: 10,
    })
  }
}
