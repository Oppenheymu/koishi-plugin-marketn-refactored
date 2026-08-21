<template>
  <div class="bundle-bulk-row">
    <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
    <button class="bundle-section-action" @click="setAllActions('dependency')">{{ t('bundle.bulk.removeDependency') }}</button>
    <span class="bundle-section-spacer">|</span>
    <button class="bundle-section-action" @click="setAllActions('config')">{{ t('bundle.bulk.cleanConfig') }}</button>
    <span class="bundle-section-spacer">|</span>
    <button class="bundle-section-action" @click="setAllActions('keep')">{{ t('bundle.bulk.keepAll') }}</button>
  </div>

  <div class="bundle-member-list">
    <section v-for="row in memberRows" :key="row.package" class="bundle-member-option">
      <div class="member-main">
        <span class="member-title">{{ row.package }}</span>
        <span class="member-meta">
          {{ row.required ? t('bundle.members.required') : t('bundle.members.optional') }} · {{ row.version || t('bundle.members.notDeclared') }}
        </span>
      </div>
      <div class="member-state">
        <span>{{ row.installed ? t('bundle.members.dependencyInstalled') : t('bundle.members.dependencyNotInstalled') }}</span>
        <span v-if="row.hasGroupConfig">{{ t('bundle.members.groupConfig') }}</span>
        <span v-if="row.hasExternalConfig" class="warning">{{ t('bundle.members.externalConfig') }}</span>
        <span v-if="row.workspace">{{ t('bundle.members.workspace') }}</span>
      </div>
      <el-radio-group v-model="memberActions[row.package]" size="small">
        <el-radio-button value="config" :disabled="!row.hasGroupConfig">{{ t('bundle.members.cleanGroupConfig') }}</el-radio-button>
        <el-radio-button value="dependency" :disabled="!row.canRemoveDependency">
          {{ t('bundle.members.removeDependency') }}
        </el-radio-button>
        <el-radio-button value="keep">{{ t('bundle.members.keep') }}</el-radio-button>
      </el-radio-group>
      <p v-if="row.hasExternalConfig" class="member-note">
        {{ t('bundle.conflict.externalNote') }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleUninstallContextKey } from './bundle-uninstall-context'

const { t } = useMarketNextI18n()
const { memberRows, memberActions, setAllActions } = inject(bundleUninstallContextKey)!
</script>
