<template>
  <k-status v-if="isLoading">
    <el-progress :indeterminate="!marketSnapshot" :percentage="percentage">
      {{ t('marketPage.progress.loading') }}
    </el-progress>
  </k-status>
</template>

<script lang="ts" setup>

import { useContext } from '@koishijs/client'
import { computed } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { marketSnapshot } from '../../market/state'

const ctx = useContext()
const { t } = useMarketNextI18n()

const isLoading = computed(() => {
  if (ctx.bail('activity', ctx.$router.pages['market'])) return false
  return !marketSnapshot.value || marketSnapshot.value.total > marketSnapshot.value.progress
})

const percentage = computed(() => {
  if (!marketSnapshot.value) return 50
  return 100 * marketSnapshot.value.progress / marketSnapshot.value.total
})

</script>

<style lang="scss">

.k-status .el-progress-bar {
  width: 120px;
  margin-right: 2px;
}

</style>
