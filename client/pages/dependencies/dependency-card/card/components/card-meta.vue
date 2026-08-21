<template>
  <div class="dep-meta-row">
    <div class="dep-meta-item">
      <span>{{ t('common.labels.current') }}</span>
      <strong>{{ card.currentText }}</strong>
    </div>
    <div v-if="card.showTargetMeta" class="dep-meta-item">
      <span>{{ card.targetLabel }}</span>
      <strong :class="{ danger: card.pendingRemove }">{{ card.targetText }}</strong>
    </div>
    <div v-if="card.requestText" class="dep-meta-item">
      <span>{{ t('common.labels.range') }}</span>
      <strong>{{ card.requestText }}</strong>
    </div>
    <div v-if="card.showIdentityMeta" class="dep-meta-item dep-meta-kind">
      <span>{{ t('common.labels.type') }}</span>
      <strong>{{ card.identityText }}</strong>
    </div>
    <div v-if="card.showConfigMeta" class="dep-meta-item">
      <span>{{ t('common.labels.config') }}</span>
      <strong :class="{ warning: card.unconfigured }">{{ card.configText }}</strong>
    </div>
    <div v-if="card.showSourceMeta" class="dep-meta-item">
      <span>{{ t('common.labels.source') }}</span>
      <strong>{{ card.sourceText }}</strong>
    </div>
    <div v-if="card.versionSourceText" class="dep-meta-item">
      <span>{{ t('common.labels.versionSource') }}</span>
      <strong>{{ card.versionSourceText }}</strong>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../../../i18n'
  import { cardContextKey } from '../logic/use-card'

const { card } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
