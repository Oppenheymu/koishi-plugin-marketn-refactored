<template>
  <div class="col-version" :data-label="t('common.labels.current')">{{ card.currentText }}</div>
  <div class="col-latest" :data-label="card.targetLabel" :class="{ 'has-update': card.updatable, 'pending-val': card.pending }">
    {{ card.showTargetMeta ? card.targetText : '—' }}
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../../i18n'
import { cardContextKey } from '../card/use-card'

const { card } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
