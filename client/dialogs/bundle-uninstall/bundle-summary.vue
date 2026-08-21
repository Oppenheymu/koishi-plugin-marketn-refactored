<template>
  <div class="bundle-summary">
    <span>{{ t('bundle.summary.remove', { count: dependencyRemovalCount }) }}</span>
    <span>{{ t('bundle.summary.clean', { count: configCleanupCount }) }}</span>
    <span>{{ t('bundle.summary.keep', { count: keepCount }) }}</span>
  </div>

  <p class="bundle-uninstall-note">
    {{ t('bundle.messages.outsideConfig') }}
  </p>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleUninstallContextKey } from './bundle-uninstall-context'

const { t } = useMarketNextI18n()
const { dependencyRemovalCount, configCleanupCount, keepCount } = inject(bundleUninstallContextKey)!
</script>
