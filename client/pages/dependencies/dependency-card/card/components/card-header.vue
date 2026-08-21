<template>
  <div class="dep-card-header">
    <div class="dep-title">
      <div class="dep-title-line">
        <h3 :title="props.name">{{ card.displayName }}</h3>
        <span v-if="card.showIdentityPill" class="dep-kind-pill">
          <span class="dep-kind-icon">
            <market-icon :name="card.identityIcon"></market-icon>
          </span>
          {{ card.identityText }}
        </span>
        <span v-if="card.showStatusBadge" :class="['dep-badge', card.statusClass]">
          <market-icon :name="card.badgeIcon"></market-icon>
          {{ card.statusLabel }}
        </span>
      </div>
      <span class="dep-full-name" :title="props.name">{{ props.name }}</span>
    </div>
    <div class="dep-header-actions" @click.stop>
      <el-button
        v-if="card.showInlineIgnoreUpdate"
        size="small"
        @click="card.openIgnoreDialog"
      >
        {{ t('dependencyCard.actions.ignore') }}
      </el-button>
      <el-button v-if="card.showEditToggle" size="small" @click.stop="card.toggleEdit">
        {{ card.editToggleText }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import MarketIcon from '../../../../../market/icons'
import { useMarketNextI18n } from '../../../../../i18n'
  import { cardContextKey } from '../logic/use-card'

const { card, props } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
