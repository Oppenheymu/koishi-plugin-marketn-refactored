<template>
  <el-select
    v-if="card.showVersionControl && card.data"
    v-model="card.selectedVersion"
    size="small"
    class="market-version-select"
    :class="{ pending: card.pending }"
    :popper-class="card.versionPopperClass"
  >
    <el-option v-if="card.dep" :value="card.removeValue">{{ t('dependencyCard.actions.remove') }}</el-option>
    <el-option v-for="({ result }, itemVersion) in card.data" :key="itemVersion" :value="itemVersion">
      {{ itemVersion }}
      <template v-if="itemVersion === card.dep?.resolved">{{ t('dependencyCard.actions.current') }}</template>
      <span :class="[result, 'theme-color', 'dot-hint']"></span>
    </el-option>
  </el-select>
  <span v-else-if="card.showVersionControl" class="dep-muted">{{ card.compactStatusText }}</span>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../../i18n'
import { cardContextKey } from './use-card'

const { card } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
