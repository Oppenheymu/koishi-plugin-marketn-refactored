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
  import { cardContextKey, useCard, type DependencyCardProps } from './logic/use-card'
  import CardActions from './components/card-actions.vue'
  import CardDialogs from './components/card-dialogs.vue'
  import CardHeader from './components/card-header.vue'
  import CardMeta from './components/card-meta.vue'
  import CardSummary from './components/card-summary.vue'

const props = defineProps<DependencyCardProps>()
const card = useCard(props)
provide(cardContextKey, { card, props })
</script>

<style scoped src="./index.scss" lang="scss"></style>
