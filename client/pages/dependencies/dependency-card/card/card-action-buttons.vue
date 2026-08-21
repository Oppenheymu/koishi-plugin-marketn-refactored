<template>
  <div class="dep-card-buttons">
    <el-button
      v-if="card.showQuickUpdate"
      size="small"
      type="primary"
      @click="card.selectedVersion = card.latestVersion"
    >
      {{ t('dependencyCard.actions.updateLatest') }}
    </el-button>
    <el-button
      v-if="card.showRestoreUpdate"
      size="small"
      @click="card.restoreUpdate"
    >
      {{ t('dependencyCard.actions.restorePrompt') }}
    </el-button>
    <el-button
      v-if="card.showConfigure"
      size="small"
      type="primary"
      :loading="card.configuring"
      @click="card.configure"
    >
      {{ t('dependencyCard.actions.addConfig') }}
    </el-button>
    <el-button
      v-if="card.showBindLocal"
      size="small"
      type="primary"
      :loading="card.bindingLocal"
      @click="card.openLocalBinding"
    >
      {{ t('dependencyCard.actions.bindLocal') }}
    </el-button>
    <el-button
      v-if="card.showRemoveDependency"
      class="dep-remove-button"
      size="small"
      @click="card.removeDependency"
    >
      {{ card.removeButtonText }}
    </el-button>
    <el-button v-if="card.pending" size="small" @click="card.clearOverride">{{ t('dependencyCard.actions.cancelChange') }}</el-button>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../../i18n'
import { cardContextKey } from './use-card'

const { card } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
