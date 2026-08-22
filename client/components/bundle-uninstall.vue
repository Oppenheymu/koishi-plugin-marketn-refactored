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

import { computed, reactive, ref, watch } from 'vue'
import { message, router, send, store, useConfig, useContext } from '@koishijs/client'
import { getBundleGroupIdent } from '../../src/shared/bundle-idents'
import type { PluginBundleRecord } from '../../src/shared/bundle'
import {
  fetchBundleRecord,
  getBundleMemberConfigState,
  install,
  pendingBundleUninstalls,
  type BundleRecordView,
  type BundleMemberCleanupTarget,
} from './utils'
import { getBulkMode, getFrontendMode, getPendingOverrides, getWritableBundleRecords, patchMarketNextData } from '../utils'
import { useMarketNextI18n } from '../i18n'

type MemberAction = 'config' | 'dependency' | 'keep'

const protectedDeps = new Set(['@koishijs/plugin-console', '@koishijs/plugin-config', '@koishijs/plugin-server'])

const props = defineProps<{
  modelValue: boolean
  packageName?: string
  record?: BundleRecordView | PluginBundleRecord
  title?: string
  redirectToPlugins?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const config = useConfig()
const { t } = useMarketNextI18n()
const frontendMode = computed(() => getFrontendMode(config.value))
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

function setAllActions(action: MemberAction) {
  for (const row of memberRows.value) {
    if (action === 'dependency') {
      memberActions[row.package] = row.canRemoveDependency ? 'dependency' : (row.hasGroupConfig ? 'config' : 'keep')
    } else if (action === 'config') {
      memberActions[row.package] = row.hasGroupConfig ? 'config' : 'keep'
    } else {
      memberActions[row.package] = 'keep'
    }
  }
}
const ctx = useContext()
const loadingRecord = ref(false)
const uninstalling = ref(false)
const remoteRecord = ref<BundleRecordView>()
const memberActions = reactive<Record<string, MemberAction>>({})

const packageName = computed(() => props.packageName || '')
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const recordView = computed(() => {
  if (props.record?.members?.length) return props.record
  if (remoteRecord.value?.package === packageName.value) return remoteRecord.value
  return props.record
})

const memberRows = computed(() => {
  const groupKey = recordView.value?.groupKey || (packageName.value ? `group:${getBundleGroupIdent(packageName.value)}` : undefined)
  return (recordView.value?.members ?? []).map((member) => {
    const dep = store.dependencies?.[member.package]
    const state = getBundleMemberConfigState(ctx, member, groupKey)
    const installed = !!dep
    const blocked = !!dep?.workspace || !!dep?.invalid || protectedDeps.has(member.package)
    const hasExternalConfig = !!state.external.length
    return {
      ...member,
      installed,
      workspace: !!dep?.workspace,
      hasGroupConfig: !!state.group.length,
      hasExternalConfig,
      canRemoveDependency: installed && !blocked && !hasExternalConfig,
    }
  })
})

const dependencyRemovalMembers = computed(() => memberRows.value
  .filter(row => memberActions[row.package] === 'dependency' && row.canRemoveDependency))
const configCleanupMembers = computed(() => memberRows.value
  .filter(row => memberActions[row.package] === 'dependency' || memberActions[row.package] === 'config')
  .filter(row => row.hasGroupConfig))
const dependencyRemovalCount = computed(() => dependencyRemovalMembers.value.length)
const configCleanupCount = computed(() => configCleanupMembers.value.length)
const keepCount = computed(() => Math.max(0, memberRows.value.length - new Set([
  ...dependencyRemovalMembers.value.map(row => row.package),
  ...configCleanupMembers.value.map(row => row.package),
]).size))

watch(visible, async (value) => {
  if (!value) return
  remoteRecord.value = undefined
  await loadRecord()
  resetActions()
}, { immediate: true })

watch(memberRows, () => {
  if (visible.value) resetActions(false)
})

async function loadRecord() {
  const name = packageName.value
  if (!name || props.record?.members?.length) return
  loadingRecord.value = true
  try {
    const record = await fetchBundleRecord(name)
    if (record) remoteRecord.value = record
  } catch (error) {
    console.warn(error)
    message.warning(t('bundle.messages.recordFailed'))
  } finally {
    loadingRecord.value = false
  }
}

function resetActions(force = true) {
  const seen = new Set<string>()
  for (const row of memberRows.value) {
    seen.add(row.package)
    if (!force && memberActions[row.package]) continue
    memberActions[row.package] = getDefaultAction(row)
  }
  for (const key of Object.keys(memberActions)) {
    if (!seen.has(key)) delete memberActions[key]
  }
}

function getDefaultAction(row: (typeof memberRows.value)[number]): MemberAction {
  if (row.hasExternalConfig) return row.hasGroupConfig ? 'config' : 'keep'
  if (row.canRemoveDependency && row.installedByBundle === true) return 'dependency'
  if (row.hasGroupConfig) return 'config'
  return 'keep'
}

function ensureOverride() {
  return getPendingOverrides()
}

function getCleanupTargets(): BundleMemberCleanupTarget[] {
  return configCleanupMembers.value.map(member => ({
    package: member.package,
    plugin: member.plugin,
  }))
}

async function uninstallBundle() {
  const name = packageName.value
  if (!name || uninstalling.value) return
  const members = dependencyRemovalMembers.value.map(member => member.package)
  const configs = getCleanupTargets()
  const override = {
    [name]: '',
    ...Object.fromEntries(members.map(name => [name, ''])),
  }

  if (getBulkMode(config.value)) {
    const overrides = ensureOverride()
    Object.assign(overrides, override)
    void patchMarketNextData({ override: { ...overrides } })
    pendingBundleUninstalls.value[name] = {
      members,
      cleanup: !!configs.length,
      configs,
    }
    visible.value = false
    message.success(t('bundle.messages.stagedUninstall', { members: members.length, configs: configs.length }))
    return
  }

  visible.value = false
  uninstalling.value = true
  try {
    await install(override, async () => {
      if (configs.length) {
        await send('market/remove-bundle-configs', {
          package: name,
          members: configs,
          removeEmptyGroup: true,
        })
      }
      const records = getWritableBundleRecords(config.value)
      delete records[name]
      const saved = await patchMarketNextData({ bundleRecords: records })
      if (!saved) message.warning(t('bundle.messages.recordSaveFailed'))
      if (props.redirectToPlugins) await router.replace('/plugins')
      emit('done')
    }, undefined, {
      loadingText: t('bundle.messages.uninstalling'),
      successText: t('bundle.messages.uninstalled'),
      errorText: t('bundle.messages.uninstallFailed'),
      timeoutText: t('bundle.messages.uninstallTimeout'),
    })
  } finally {
    uninstalling.value = false
  }
}

</script>

<style lang="scss" scoped src="./bundle-uninstall.scss"></style>
