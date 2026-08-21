<template>
  <el-dialog
    :model-value="!!activeBundle"
    append-to-body
    align-center
    :class="['bundle-install-panel', modeClass]"
    width="min(880px, calc(100vw - 24px))"
    destroy-on-close
    @update:model-value="close"
  >
    <template #header>
      <div class="bundle-hero">
        <div class="bundle-hero-icon">
          <k-icon name="cube"></k-icon>
        </div>
        <div class="bundle-hero-text">
          <div class="bundle-hero-title">
            <span>{{ title }}</span>
            <span class="bundle-badge">
              <market-icon name="file-archive"></market-icon>
              {{ t('bundle.label') }}
            </span>
          </div>
          <div v-if="activeBundle" class="bundle-hero-meta">
            <span>{{ activeBundle.package.name }}</span>
            <span class="dot">·</span>
            <span>{{ bundleVersion }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-if="activeBundle">
      <div v-if="loading" class="bundle-loading">
        <span class="bundle-loading-spinner"></span>
        {{ t('bundle.loading') }}
      </div>
      <k-comment v-else-if="error" type="danger">
        <p>{{ error }}</p>
      </k-comment>

      <template v-else-if="bundle">
        <p v-if="bundle.description" class="bundle-description">{{ bundle.description }}</p>

        <!-- Stats row: visual progress + counts -->
        <div class="bundle-stats">
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ selectedMembers.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.selected', { count: selectedMembers.length, total: members.length }) }}</span>
            <div class="bundle-stat-bar"><div class="bundle-stat-fill" :style="{ width: progressPercent + '%' }"></div></div>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ presetList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.presets') }}</span>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ moveList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.moved') }}</span>
          </div>
        </div>

        <k-comment v-if="validationErrors.length" type="danger">
          <p v-for="item in validationErrors" :key="item">{{ item }}</p>
        </k-comment>
        <k-comment v-if="validationWarnings.length" type="warning">
          <p v-for="item in validationWarnings" :key="item">{{ item }}</p>
        </k-comment>

        <!-- Global Bulk Operations Row -->
        <div class="bundle-bulk-row" v-if="selectedMembers.length">
          <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(true)">{{ t('bundle.bulk.createAll') }}</button>
          <span class="bundle-section-spacer">|</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(false)">{{ t('bundle.bulk.skipAll') }}</button>
          <template v-if="selectedMembers.some(m => hasPreset(m))">
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(true)">{{ t('bundle.bulk.enablePresets') }}</button>
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(false)">{{ t('bundle.bulk.disablePresets') }}</button>
          </template>
        </div>

        <!-- Required members section -->
        <template v-if="requiredMembers.length">
          <div class="bundle-section-title">
            <k-icon name="check-full"></k-icon>
            {{ t('bundle.members.required') }} <span class="bundle-section-count">{{ requiredMembers.length }}</span>
          </div>
          <div class="bundle-member-list">
            <member-row
              v-for="member in requiredMembers"
              :key="member.package + ':' + member.plugin"
              :member="member"
              required
              :member-json-errors="memberJsonErrors"
              :member-category="memberCategory"
              :format-shortname="formatShortname"
              :risk-tags="riskTags"
              :get-installed-text="getInstalledText"
              :get-package-description="getPackageDescription"
              :has-preset="hasPreset"
              :sensitive-fields="sensitiveFields"
              :format-config="formatConfig"
              :on-json-input="onJsonInput"
              :get-member-key="getMemberKey"
              :toggle-member="toggleMember"
            ></member-row>
          </div>
        </template>

        <!-- Optional members section -->
        <template v-if="optionalMembers.length">
          <div class="bundle-section-title">
            <k-icon name="info-full"></k-icon>
            {{ t('bundle.members.optional') }} <span class="bundle-section-count">{{ optionalMembers.length }}</span>
            <button class="bundle-section-action" @click="toggleAllOptional">
              {{ allOptionalSelected ? t('bundle.members.optionalToggleNone') : t('bundle.members.optionalToggleAll') }}
            </button>
          </div>
          <div class="bundle-member-list">
            <member-row
              v-for="member in optionalMembers"
              :key="member.package + ':' + member.plugin"
              :member="member"
              :member-json-errors="memberJsonErrors"
              :member-category="memberCategory"
              :format-shortname="formatShortname"
              :risk-tags="riskTags"
              :get-installed-text="getInstalledText"
              :get-package-description="getPackageDescription"
              :has-preset="hasPreset"
              :sensitive-fields="sensitiveFields"
              :format-config="formatConfig"
              :on-json-input="onJsonInput"
              :get-member-key="getMemberKey"
              :toggle-member="toggleMember"
            ></member-row>
          </div>
        </template>

        <!-- Diff: visualized -->
        <diff-panel
          :install-list="installList"
          :config-list="configList"
          :preset-list="presetList"
          :move-list="moveList"
          :skipped-config-list="skippedConfigList"
        ></diff-panel>
      </template>
    </template>

    <template #footer>
      <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
        {{ t('bundle.actions.install') }} <span v-if="selectedMembers.length" class="footer-count">({{ selectedMembers.length }})</span>
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import MarketIcon from '../../market/icons'
import MemberRow from './member-row.vue'
import DiffPanel from './diff-panel.vue'
import { useBundleInstall } from './use-bundle-install'

const {
  t,
  activeBundle,
  modeClass,
  title,
  bundleVersion,
  validationErrors,
  validationWarnings,
  loading,
  installing,
  error,
  bundle,
  members,
  selectedMembers,
  requiredMembers,
  optionalMembers,
  progressPercent,
  allOptionalSelected,
  presetList,
  moveList,
  installList,
  configList,
  skippedConfigList,
  memberJsonErrors,
  memberCategory,
  formatShortname,
  riskTags,
  getInstalledText,
  getPackageDescription,
  hasPreset,
  sensitiveFields,
  formatConfig,
  onJsonInput,
  getMemberKey,
  toggleMember,
  toggleAllOptional,
  batchSetCreateConfig,
  batchSetUsePreset,
  close,
  confirmInstall,
  canInstall,
} = useBundleInstall()
</script>

<style src="./index.scss" lang="scss"></style>
