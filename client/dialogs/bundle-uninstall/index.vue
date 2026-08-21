<template>
  <el-dialog
    v-model="visible"
    append-to-body
    :class="['bundle-uninstall-dialog', modeClass]"
    :title="title || t('bundle.actions.uninstall')"
    width="min(760px, calc(100vw - 24px))"
    destroy-on-close
  >
    <template v-if="packageName">
      <div class="bundle-uninstall-body">
        <p>
          <strong>{{ recordView?.label || packageName }}</strong>
          {{ t('bundle.messages.isBundle') }}
        </p>

        <p class="bundle-package-name">{{ packageName }}</p>

        <k-comment v-if="recordView?.fallback" type="warning">
          <p>{{ t('bundle.messages.fallbackRecord') }}</p>
        </k-comment>

        <div v-if="loadingRecord" class="bundle-loading">{{ t('bundle.loading') }}</div>

        <template v-else-if="memberRows.length">
          <!-- Bulk Operations Bar -->
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

        <k-comment v-else>
          <p>{{ t('bundle.messages.noMembers') }}</p>
        </k-comment>

        <div class="bundle-summary">
          <span>{{ t('bundle.summary.remove', { count: dependencyRemovalCount }) }}</span>
          <span>{{ t('bundle.summary.clean', { count: configCleanupCount }) }}</span>
          <span>{{ t('bundle.summary.keep', { count: keepCount }) }}</span>
        </div>

        <p class="bundle-uninstall-note">
          {{ t('bundle.messages.outsideConfig') }}
        </p>
      </div>
    </template>
    <template v-else>
      <k-comment type="warning">
        <p>{{ t('bundle.messages.noDependency') }}</p>
      </k-comment>
    </template>

    <template #footer>
      <el-button @click="visible = false">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="danger" :loading="loadingRecord || uninstalling" :disabled="!packageName" @click="uninstallBundle">
        {{ t('bundle.actions.uninstall') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useMarketNextI18n } from '../../i18n'
import { useBundleUninstall, type BundleUninstallProps } from './use-uninstall'

const props = defineProps<BundleUninstallProps>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const { t } = useMarketNextI18n()

const {
  visible,
  modeClass,
  packageName,
  recordView,
  memberRows,
  memberActions,
  loadingRecord,
  uninstalling,
  dependencyRemovalCount,
  configCleanupCount,
  keepCount,
  setAllActions,
  uninstallBundle,
} = useBundleUninstall(props, emit)
</script>

<style scoped src="./index.scss" lang="scss"></style>
