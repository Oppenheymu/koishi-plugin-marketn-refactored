<template>
  <k-comment type="danger" class="market-error">
    <p>{{ t('marketPage.error.title') }}</p>
    <p>
      {{ t('marketPage.error.registry', { value: registry }) }}
      <template v-if="reason"> · {{ t('marketPage.error.reason', { value: reason }) }}</template>
    </p>
    <ul>
      <li>{{ t('marketPage.error.networkHint') }}</li>
      <li>{{ t('marketPage.error.searchHint') }}</li>
    </ul>
    <p style="margin-top: 0.8rem;">
      <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.error.openRegistrySettings') }}</el-button>
    </p>
  </k-comment>
</template>

<script setup lang="ts">

import { router } from '@koishijs/client'
import { useMarketNextI18n } from '../../../i18n'

defineProps<{
  registry: string
  reason?: string
}>()

const { t } = useMarketNextI18n()

</script>
