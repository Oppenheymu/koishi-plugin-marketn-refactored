<template>
  <div :class="['dep-list-row', modeClass, statusClass]" :style="cardStyle">
    <div class="dep-status-mark" aria-hidden="true">
      <market-icon :name="markIcon"></market-icon>
    </div>
    <div class="col-name">
      <span class="name-display" :title="name">
        <span class="name-label">{{ displayName }}</span>
        <span v-if="bundlePackage" class="dep-list-kind-pill" :title="t('dependencyCard.identity.bundle')">
          <market-icon name="file-archive"></market-icon>
          {{ t('dependencyCard.identity.bundle') }}
        </span>
      </span>
      <span class="name-full" :title="name">{{ name }}</span>
    </div>
    <div class="col-version" :data-label="t('common.labels.current')">{{ currentText }}</div>
    <div class="col-latest" :data-label="targetLabel" :class="{ 'has-update': updatable, 'pending-val': pending }">
      {{ showTargetMeta ? targetText : '—' }}
    </div>
    <div class="col-actions" @click.stop>
      <el-button v-if="showQuickUpdate" size="small" type="primary" @click="selectedVersion = latestVersion">{{ t('dependencyCard.actions.update') }}</el-button>
      <el-button v-if="showConfigure" size="small" type="primary" :loading="configuring" @click="configure">{{ t('dependencyCard.actions.configure') }}</el-button>
      <el-button v-if="showInlineIgnoreUpdate" size="small" @click="openIgnoreDialog">{{ t('dependencyCard.actions.ignore') }}</el-button>
      <el-button v-if="showRestoreUpdate" size="small" @click="restoreUpdate">{{ t('dependencyCard.actions.restore') }}</el-button>
      <el-button v-if="showBindLocal" size="small" type="primary" :loading="bindingLocal" @click="openLocalBinding">{{ t('dependencyCard.actions.bindLocal') }}</el-button>
      <el-select
        v-if="showVersionControl && data && (editing || pending)"
        v-model="selectedVersion"
        size="small"
        class="dep-list-select market-version-select"
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
      <el-button v-if="pending" size="small" @click="clearOverride">{{ t('dependencyCard.actions.undo') }}</el-button>
      <el-button v-if="showRemoveDependency" class="dep-remove-button" size="small" @click="removeDependency">{{ removeButtonText }}</el-button>
      <el-button v-if="canExpandCard && !pending" size="small" @click.stop="toggleEdit">
        {{ editToggleText }}
      </el-button>
    </div>
  </div>

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
import { useCard, type DependencyCardProps } from '../card/use-card'
import { useMarketNextI18n } from '../../../i18n'

const props = defineProps<DependencyCardProps>()

const { t } = useMarketNextI18n()

const {
  modeClass,
  statusClass,
  cardStyle,
  markIcon,
  displayName,
  bundlePackage,
  currentText,
  targetLabel,
  showTargetMeta,
  targetText,
  updatable,
  pending,
  showQuickUpdate,
  selectedVersion,
  latestVersion,
  showConfigure,
  configuring,
  configure,
  showInlineIgnoreUpdate,
  openIgnoreDialog,
  showRestoreUpdate,
  restoreUpdate,
  showBindLocal,
  bindingLocal,
  openLocalBinding,
  showVersionControl,
  data,
  editing,
  versionPopperClass,
  dep,
  removeValue,
  clearOverride,
  showRemoveDependency,
  removeDependency,
  removeButtonText,
  canExpandCard,
  toggleEdit,
  editToggleText,
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
