<template>
  <div class="bundle-uninstall-body">
    <p>
      <strong>{{ recordView?.label || packageName }}</strong>
      {{ t('bundle.messages.isBundle') }}
    </p>

    <p class="bundle-package-name">{{ packageName }}</p>

    <k-comment v-if="recordView?.fallback" type="warning">
      <p>{{ t('bundle.messages.fallbackRecord') }}</p>
    </k-comment>

    <div v-if="loadingRecord" class="bundle-loading">{{ t('bundle.loading') }}</div>

    <bundle-member-list v-else-if="memberRows.length"></bundle-member-list>

    <k-comment v-else>
      <p>{{ t('bundle.messages.noMembers') }}</p>
    </k-comment>

    <bundle-summary></bundle-summary>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleUninstallContextKey } from './bundle-uninstall-context'
import BundleMemberList from './bundle-member-list.vue'
import BundleSummary from './bundle-summary.vue'

const { t } = useMarketNextI18n()
const { recordView, packageName, loadingRecord, memberRows } = inject(bundleUninstallContextKey)!
</script>
