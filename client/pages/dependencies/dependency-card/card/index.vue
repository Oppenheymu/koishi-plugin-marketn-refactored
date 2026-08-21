<template>
  <article
    :class="['dep-package-card', card.modeClass, card.statusClass, { expandable: card.canExpandCard, expanded: card.editing }]"
    :style="card.cardStyle"
    @click="card.toggleCardActions"
  >
    <div class="dep-status-mark" aria-hidden="true">
      <market-icon :name="card.markIcon"></market-icon>
    </div>
    <card-header></card-header>
    <card-summary></card-summary>
    <card-meta></card-meta>
    <card-actions></card-actions>
  </article>

  <card-dialogs></card-dialogs>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import MarketIcon from '../../../../market/icons'
import { cardContextKey, useCard, type DependencyCardProps } from './use-card'
import CardActions from './card-actions.vue'
import CardDialogs from './card-dialogs.vue'
import CardHeader from './card-header.vue'
import CardMeta from './card-meta.vue'
import CardSummary from './card-summary.vue'

const props = defineProps<DependencyCardProps>()
const card = useCard(props)
provide(cardContextKey, { card, props })
</script>

<style scoped src="./index.scss" lang="scss"></style>
