<template>
  <!-- List row mode -->
  <div v-if="props.listMode" :class="['dep-list-row', modeClass, statusClass]" :style="cardStyle">
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

  <!-- Card mode (default) -->
  <article
    v-else
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

  <el-dialog v-model="showIgnoreDialog" :class="['dep-ignore-dialog', modeClass]" append-to-body destroy-on-close>
    <template #header>{{ t('dependencyCard.ignore.title') }}</template>
    <div class="dep-ignore-body">
      <p>
        {{ t('dependencyCard.ignore.intro', { name: displayName }) }}
        <template v-if="latestVersion">{{ t('dependencyCard.ignore.versionIntro', { version: latestVersion }) }}</template>
      </p>
      <el-checkbox v-model="ignorePackagePermanently">
        {{ t('dependencyCard.ignore.permanent') }}
      </el-checkbox>
      <template v-if="!ignorePackagePermanently">
        <label class="dep-ignore-field">
          <span>{{ t('dependencyCard.ignore.duration') }}</span>
          <el-radio-group v-model="ignoreDurationPreset">
            <el-radio-button value="forever">{{ t('dependencyCard.ignore.forever') }}</el-radio-button>
            <el-radio-button value="1d">{{ t('dependencyCard.ignore.day', { count: 1 }) }}</el-radio-button>
            <el-radio-button value="7d">{{ t('dependencyCard.ignore.day', { count: 7 }) }}</el-radio-button>
            <el-radio-button value="30d">{{ t('dependencyCard.ignore.day', { count: 30 }) }}</el-radio-button>
            <el-radio-button value="custom">{{ t('dependencyCard.ignore.custom') }}</el-radio-button>
          </el-radio-group>
        </label>
        <label v-if="ignoreDurationPreset === 'custom'" class="dep-ignore-field inline">
          <span>{{ t('dependencyCard.ignore.customDays') }}</span>
          <el-input-number v-model="ignoreCustomDays" :min="1" :max="3650" :step="1" controls-position="right"></el-input-number>
        </label>
        <label class="dep-ignore-field inline">
          <span>{{ t('dependencyCard.ignore.versionCount') }}</span>
          <el-input-number v-model="ignoreCount" :min="1" :max="20" :step="1" controls-position="right"></el-input-number>
        </label>
      </template>
      <p class="dep-ignore-note">
        <template v-if="ignorePackagePermanently">
          {{ t('dependencyCard.ignore.permanentNote') }}
        </template>
        <template v-else>
          {{ t('dependencyCard.ignore.durationNote') }}
        </template>
      </p>
    </div>
    <template #footer>
      <el-button @click="showIgnoreDialog = false">{{ t('dependencyCard.ignore.cancel') }}</el-button>
      <el-button type="primary" :loading="ignoreSaving" @click="confirmIgnoreUpdate">{{ t('dependencyCard.ignore.confirm') }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showLocalBindingDialog"
    append-to-body
    align-center
    :class="['market-dialog', 'market-dialog--small', 'dep-local-binding-dialog', modeClass]"
    destroy-on-close
  >
    <template #header>{{ t('dependencyCard.localBinding.title') }}</template>
    <div class="dep-local-binding-body">
      <p>{{ t('dependencyCard.localBinding.description', { name: displayName }) }}</p>
      <k-comment type="warning">{{ t('dependencyCard.localBinding.note') }}</k-comment>
    </div>
    <template #footer>
      <el-button @click="showLocalBindingDialog = false">{{ t('dependencyCard.localBinding.cancel') }}</el-button>
      <el-button type="primary" :loading="bindingLocal" @click="confirmLocalBinding">{{ t('dependencyCard.localBinding.confirm') }}</el-button>
    </template>
  </el-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="name"
    :record="bundleRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>

import { computed, ref } from 'vue'
import { useConfig, useContext } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import { getFrontendMode, getPendingOverrides } from '../../shared/plugin-config'
import { activeBundle, ensureInstalledConfig, expandedDependency, pendingBundleUninstalls } from '../../shared/operations'
import MarketIcon from '../../market/icons'
import BundleUninstall from '../../dialogs/bundle-uninstall/index.vue'
import { useMarketNextI18n } from '../../shared/i18n'
import { useIgnoreUpdate } from './use-ignore-update'
import { useLocalBinding } from './use-local-binding'
import { usePackageCardMeta } from './use-package-card-meta'
import { usePackageCardState } from './use-package-card-state'
import { usePackageCardStatus } from './use-package-card-status'
import { usePackageVisibility } from './use-package-visibility'

type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

const props = defineProps<{
  name: string
  kind?: ItemKind
  listMode?: boolean
}>()

const removeValue = '__market_next_remove__'
const config = useConfig()
const ctx = useContext()
const { t, locale } = useMarketNextI18n()
const frontendMode = computed(() => getFrontendMode(config.value))
const modeClass = computed(() => `market-mode-${frontendMode.value}`)
const versionPopperClass = computed(() => `market-version-popper ${modeClass.value}`)
const configuring = ref(false)
const showBundleUninstallDialog = ref(false)
const editing = computed({
  get: () => expandedDependency.value === props.name,
  set: (value: boolean) => expandedDependency.value = value ? props.name : '',
})

const state = usePackageCardState(props, config, ctx)
const status = usePackageCardStatus(state, t, editing)
const meta = usePackageCardMeta(state, t, locale, editing, ctx, status.statusClass, props.listMode)
const visibility = usePackageVisibility({
  state,
  t,
  statusClass: status.statusClass,
  configText: meta.configText,
  sourceText: meta.sourceText,
  statusIcon: status.statusIcon,
  identityIcon: meta.identityIcon,
  detailText: status.detailText,
  editing,
  listMode: props.listMode,
})
const ignore = useIgnoreUpdate(state, config, t)
const binding = useLocalBinding(props.name, t)

// 模板按名消费,此处平铺解构(script setup 的绑定要求)
const {
  dep, local, localDependency, marketData, bundleRecord, displayName, data,
  latestVersion, pending, pendingRemove, updatable, bundlePackage, unconfigured, overrideValue,
} = state
const {
  statusClass, statusLabel, badgeIcon, currentText, targetText, targetLabel,
  detailText, compactStatusText, versionSourceText,
} = status
const {
  configText, sourceText, removeButtonText, requestText, identityIcon,
  identityText, cardStyle, summaryText, editToggleText,
} = meta
const {
  markIcon, showIdentityPill, showIdentityMeta, showStatusBadge, showConfigMeta, showSourceMeta,
  showTargetMeta, showDetailText, showVersionControl, showEditToggle, canExpandCard,
  showQuickUpdate, showInlineIgnoreUpdate, showRestoreUpdate, showConfigure, showBindLocal,
  showRemoveDependency, showCardActions, floatingActions,
} = visibility
const {
  showIgnoreDialog, ignoreDurationPreset, ignoreCustomDays, ignoreCount,
  ignorePackagePermanently, ignoreSaving, openIgnoreDialog, confirmIgnoreUpdate, restoreUpdate,
} = ignore
const { showLocalBindingDialog, bindingLocal, openLocalBinding, confirmLocalBinding } = binding

const selectedVersion = computed({
  get() {
    if (pendingRemove.value) return removeValue
    if (overrideValue.value) return overrideValue.value
    return dep.value?.resolved ?? latestVersion.value ?? ''
  },
  set(value: string) {
    const override = getPendingOverrides()
    if (value === removeValue) {
      override[props.name] = ''
    } else if (value === dep.value?.resolved || !value && !dep.value) {
      delete override[props.name]
    } else {
      override[props.name] = value
    }
    state.setOverride(override)
  },
})

function toggleCardActions() {
  if (!canExpandCard.value) return
  if (bundlePackage.value) {
    openBundlePanel()
    return
  }
  editing.value = !editing.value
}

function toggleEdit() {
  if (bundlePackage.value) {
    openBundlePanel()
    return
  }
  editing.value = !editing.value
}

function openBundlePanel() {
  const entry = marketData.value
  if (entry) {
    activeBundle.value = entry
    return
  }
  activeBundle.value = {
    package: {
      name: props.name,
      version: dep.value?.resolved ?? local.value?.package.version ?? latestVersion.value ?? '',
      keywords: [],
    },
    shortname: displayName.value,
  } as SearchObject
}

function clearOverride() {
  const pendingBundle = pendingBundleUninstalls.value[props.name]
  const override = getPendingOverrides()
  delete override[props.name]
  for (const member of pendingBundle?.members ?? []) {
    delete override[member]
  }
  state.setOverride(override)
  delete pendingBundleUninstalls.value[props.name]
}

function removeDependency() {
  if (bundleRecord.value) {
    showBundleUninstallDialog.value = true
    return
  }
  selectedVersion.value = removeValue
}

async function configure() {
  configuring.value = true
  try {
    await ensureInstalledConfig(ctx, props.name, false)
  } finally {
    configuring.value = false
  }
}

</script>

<style lang="scss" src="./package.scss"></style>

<style lang="scss" scoped src="./package-scoped.scss"></style>
