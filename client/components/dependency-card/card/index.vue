<template>
  <article
    :class="['dep-package-card', modeClass, statusClass, { expandable: canExpandCard, expanded: editing }]"
    :style="cardStyle"
    @click="toggleCardActions"
  >
    <div class="dep-status-mark" aria-hidden="true">
      <market-icon :name="markIcon"></market-icon>
    </div>
    <div class="dep-card-header">
      <div class="dep-title">
        <div class="dep-title-line">
          <h3 :title="name">{{ displayName }}</h3>
          <span v-if="showIdentityPill" class="dep-kind-pill">
            <span class="dep-kind-icon">
              <market-icon :name="identityIcon"></market-icon>
            </span>
            {{ identityText }}
          </span>
          <span v-if="showStatusBadge" :class="['dep-badge', statusClass]">
            <market-icon :name="badgeIcon"></market-icon>
            {{ statusLabel }}
          </span>
        </div>
        <span class="dep-full-name" :title="name">{{ name }}</span>
      </div>
      <div class="dep-header-actions" @click.stop>
        <el-button
          v-if="showInlineIgnoreUpdate"
          size="small"
          @click="openIgnoreDialog"
        >
          {{ t('dependencyCard.actions.ignore') }}
        </el-button>
        <el-button v-if="showEditToggle" size="small" @click.stop="toggleEdit">
          {{ editToggleText }}
        </el-button>
      </div>
    </div>

    <p v-if="summaryText" class="dep-summary-text" :title="summaryText">
      {{ summaryText }}
    </p>

    <div class="dep-meta-row">
      <div class="dep-meta-item">
        <span>{{ t('common.labels.current') }}</span>
        <strong>{{ currentText }}</strong>
      </div>
      <div v-if="showTargetMeta" class="dep-meta-item">
        <span>{{ targetLabel }}</span>
        <strong :class="{ danger: pendingRemove }">{{ targetText }}</strong>
      </div>
      <div v-if="requestText" class="dep-meta-item">
        <span>{{ t('common.labels.range') }}</span>
        <strong>{{ requestText }}</strong>
      </div>
      <div v-if="showIdentityMeta" class="dep-meta-item dep-meta-kind">
        <span>{{ t('common.labels.type') }}</span>
        <strong>{{ identityText }}</strong>
      </div>
      <div v-if="showConfigMeta" class="dep-meta-item">
        <span>{{ t('common.labels.config') }}</span>
        <strong :class="{ warning: unconfigured }">{{ configText }}</strong>
      </div>
      <div v-if="showSourceMeta" class="dep-meta-item">
        <span>{{ t('common.labels.source') }}</span>
        <strong>{{ sourceText }}</strong>
      </div>
      <div v-if="versionSourceText" class="dep-meta-item">
        <span>{{ t('common.labels.versionSource') }}</span>
        <strong>{{ versionSourceText }}</strong>
      </div>
    </div>

    <p v-if="showDetailText" :class="['dep-status-text', { danger: statusClass === 'error' }]">
      {{ detailText }}
    </p>

    <div v-if="showCardActions" :class="['dep-card-actions', { floating: floatingActions }]" @click.stop>
      <el-select
        v-if="showVersionControl && data"
        v-model="selectedVersion"
        size="small"
        class="market-version-select"
        :class="{ pending }"
        :popper-class="versionPopperClass"
      >
        <el-option v-if="dep" :value="removeValue">{{ t('dependencyCard.actions.remove') }}</el-option>
        <el-option v-for="({ result }, itemVersion) in data" :key="itemVersion" :value="itemVersion">
          {{ itemVersion }}
          <template v-if="itemVersion === dep?.resolved">{{ t('dependencyCard.actions.current') }}</template>
          <span :class="[result, 'theme-color', 'dot-hint']"></span>
        </el-option>
      </el-select>
      <span v-else-if="showVersionControl" class="dep-muted">{{ compactStatusText }}</span>

      <div class="dep-card-buttons">
        <el-button
          v-if="showQuickUpdate"
          size="small"
          type="primary"
          @click="selectedVersion = latestVersion"
        >
          {{ t('dependencyCard.actions.updateLatest') }}
        </el-button>
        <el-button
          v-if="showRestoreUpdate"
          size="small"
          @click="restoreUpdate"
        >
          {{ t('dependencyCard.actions.restorePrompt') }}
        </el-button>
        <el-button
          v-if="showConfigure"
          size="small"
          type="primary"
          :loading="configuring"
          @click="configure"
        >
          {{ t('dependencyCard.actions.addConfig') }}
        </el-button>
        <el-button
          v-if="showBindLocal"
          size="small"
          type="primary"
          :loading="bindingLocal"
          @click="openLocalBinding"
        >
          {{ t('dependencyCard.actions.bindLocal') }}
        </el-button>
        <el-button
          v-if="showRemoveDependency"
          class="dep-remove-button"
          size="small"
          @click="removeDependency"
        >
          {{ removeButtonText }}
        </el-button>
        <el-button v-if="pending" size="small" @click="clearOverride">{{ t('dependencyCard.actions.cancelChange') }}</el-button>
      </div>
    </div>
  </article>

  <ignore-dialog
    v-model:showIgnoreDialog="showIgnoreDialog"
    v-model:ignorePackagePermanently="ignorePackagePermanently"
    v-model:ignoreDurationPreset="ignoreDurationPreset"
    v-model:ignoreCustomDays="ignoreCustomDays"
    v-model:ignoreCount="ignoreCount"
    :modeClass="modeClass"
    :displayName="displayName"
    :latestVersion="latestVersion"
    :ignoreSaving="ignoreSaving"
    :confirmIgnoreUpdate="confirmIgnoreUpdate"
  ></ignore-dialog>

  <binding-dialog
    v-model:showLocalBindingDialog="showLocalBindingDialog"
    :modeClass="modeClass"
    :displayName="displayName"
    :bindingLocal="bindingLocal"
    :confirmLocalBinding="confirmLocalBinding"
  ></binding-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="name"
    :record="bundleRecord"
  ></bundle-uninstall>
</template>

<script setup lang="ts">
import MarketIcon from '../../../market/icons'
import BundleUninstall from '../../../dialogs/bundle-uninstall/index.vue'
import IgnoreDialog from '../dialogs/ignore-dialog.vue'
import BindingDialog from '../dialogs/binding-dialog.vue'
import { useCard, type DependencyCardProps } from './use-card'
import { useMarketNextI18n } from '../../../i18n'

const props = defineProps<DependencyCardProps>()

const { t } = useMarketNextI18n()

const {
  modeClass,
  statusClass,
  cardStyle,
  canExpandCard,
  editing,
  toggleCardActions,
  markIcon,
  displayName,
  showIdentityPill,
  identityIcon,
  identityText,
  showStatusBadge,
  badgeIcon,
  statusLabel,
  showInlineIgnoreUpdate,
  openIgnoreDialog,
  showEditToggle,
  toggleEdit,
  editToggleText,
  summaryText,
  currentText,
  showTargetMeta,
  targetLabel,
  targetText,
  pendingRemove,
  requestText,
  showIdentityMeta,
  showConfigMeta,
  unconfigured,
  configText,
  showSourceMeta,
  sourceText,
  versionSourceText,
  showDetailText,
  detailText,
  showCardActions,
  floatingActions,
  showVersionControl,
  data,
  selectedVersion,
  versionPopperClass,
  pending,
  dep,
  removeValue,
  showQuickUpdate,
  latestVersion,
  showRestoreUpdate,
  restoreUpdate,
  showConfigure,
  configuring,
  configure,
  showBindLocal,
  bindingLocal,
  openLocalBinding,
  showRemoveDependency,
  removeDependency,
  removeButtonText,
  clearOverride,
  compactStatusText,
  showIgnoreDialog,
  ignorePackagePermanently,
  ignoreDurationPreset,
  ignoreCustomDays,
  ignoreCount,
  ignoreSaving,
  confirmIgnoreUpdate,
  showLocalBindingDialog,
  confirmLocalBinding,
  showBundleUninstallDialog,
  bundleRecord,
} = useCard(props)
</script>

<style scoped src="./index.scss" lang="scss"></style>
