<template>
  <div class="col-actions" @click.stop>
    <el-button v-if="card.showQuickUpdate" size="small" type="primary" @click="card.selectedVersion = card.latestVersion">{{ t('dependencyCard.actions.update') }}</el-button>
    <el-button v-if="card.showConfigure" size="small" type="primary" :loading="card.configuring" @click="card.configure">{{ t('dependencyCard.actions.configure') }}</el-button>
    <el-button v-if="card.showInlineIgnoreUpdate" size="small" @click="card.openIgnoreDialog">{{ t('dependencyCard.actions.ignore') }}</el-button>
    <el-button v-if="card.showRestoreUpdate" size="small" @click="card.restoreUpdate">{{ t('dependencyCard.actions.restore') }}</el-button>
    <el-button v-if="card.showBindLocal" size="small" type="primary" :loading="card.bindingLocal" @click="card.openLocalBinding">{{ t('dependencyCard.actions.bindLocal') }}</el-button>
    <el-select
      v-if="card.showVersionControl && card.data && (card.editing || card.pending)"
      v-model="card.selectedVersion"
      size="small"
      class="dep-list-select market-version-select"
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
    <el-button v-if="card.pending" size="small" @click="card.clearOverride">{{ t('dependencyCard.actions.undo') }}</el-button>
    <el-button v-if="card.showRemoveDependency" class="dep-remove-button" size="small" @click="card.removeDependency">{{ card.removeButtonText }}</el-button>
    <el-button v-if="card.canExpandCard && !card.pending" size="small" @click.stop="card.toggleEdit">
      {{ card.editToggleText }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../../../i18n'
import { cardContextKey } from '../card/use-card'

const { card } = inject(cardContextKey)!
const { t } = useMarketNextI18n()
</script>
