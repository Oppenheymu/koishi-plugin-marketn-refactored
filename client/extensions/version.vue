<template>
  <!-- navigation -->
  <div class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8" v-if="object || showDependencyUninstall">
    <a class="el-button" target="_blank"
      v-if="object?.package.links.homepage"
      :href="object.package.links.homepage"
    >{{ t('extensions.links.homepage') }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.npm && local?.package.version"
      :href="object.package.links.npm + '/v/' + local.package.version"
    >{{ t('extensions.links.currentVersion', { version: local.package.version }) }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.repository"
      :href="object.package.links.repository"
    >{{ t('extensions.links.repository') }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.bugs"
      :href="object.package.links.bugs"
    >{{ t('extensions.links.issues') }}</a>
    <el-button
      v-if="showDependencyUninstall"
      :class="{ 'dependency-remove-button': !pendingRemove }"
      :loading="uninstalling || loadingBundleRecord"
      @click="pendingRemove ? cancelPendingUninstall() : requestUninstall()"
    >
      {{ pendingRemove ? t('extensions.actions.cancelUninstall') : bundleRecord ? t('extensions.actions.uninstallBundle') : t('extensions.actions.uninstallPlugin') }}
    </el-button>
  </div>

  <!-- latest -->
  <k-comment v-if="updateAvailable && !global.static">
    <p>{{ t('extensions.messages.outdatedPrefix') }}<router-link to="/dependencies">{{ t('extensions.actions.goDependencies') }}</router-link>{{ t('extensions.messages.outdatedSuffix') }}</p>
  </k-comment>

  <!-- deprecated -->
  <k-comment v-if="versions?.[dep?.resolved]?.deprecated" type="danger">
    <p>{{ t('extensions.messages.deprecated', { reason: versions[dep.resolved].deprecated }) }}</p>
  </k-comment>

  <!-- external -->
  <k-comment type="warning" v-if="local && !local.workspace && store.dependencies && !store.dependencies[name]">
    <p>{{ t('extensions.messages.externalLocal') }}</p>
  </k-comment>

  <el-dialog v-model="showUninstallDialog" class="market-extension-uninstall-dialog" :title="t('operations.install.uninstall')" destroy-on-close>
    {{ t('extensions.messages.configQuestion') }}
    <template #footer>
      <el-button @click="showUninstallDialog = false">{{ t('extensions.actions.cancel') }}</el-button>
      <el-button type="primary" @click="uninstallDependency(false)">{{ t('extensions.actions.onlyUninstall') }}</el-button>
      <el-button type="danger" @click="uninstallDependency(true)">{{ t('extensions.actions.uninstallAndRemoveConfig') }}</el-button>
    </template>
  </el-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="name"
    :record="bundleRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>

import { global, message, store, useContext } from '@koishijs/client'
import { computed, inject, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { getPendingOverrides, getBundleRecords, getWritableBundleRecords, patchMarketNextData } from '../lib/data-store'
import { getBulkMode, getRemoveConfig, getMarketNextPolicy } from '../lib/market-config'
import { hasUpdate } from '../lib/update-policy'
import type {} from '@koishijs/plugin-config'
import type { PluginBundleRecord } from '../../src/shared/bundle'
import { createLocalBundleRecord, fetchBundleRecord } from '../lib/bundle-records'
import type { BundleRecordView } from '../lib/bundle-records'
import { getConfigWriter } from '../lib/config-writer'
import { install } from '../lib/install-flow'
import { pendingBundleUninstalls } from '../lib/dialogs'
import BundleUninstall from '../dialogs/bundle-uninstall'
import { useMarketNextI18n } from '../i18n'
import { getMarketObject, loadMarketObjects } from '../market/state'

const ctx = useContext()
const { t } = useMarketNextI18n()
const name = inject<ComputedRef<string>>('plugin:name')
const protectedDeps = new Set(['@koishijs/plugin-console', '@koishijs/plugin-config', '@koishijs/plugin-server'])

const local = computed(() => store.packages?.[name.value])
const object = computed(() => getMarketObject(name.value))
const dep = computed(() => store.dependencies?.[name.value])
const versions = computed(() => store.registry?.[name.value])
const updateAvailable = computed(() => hasUpdate(name.value, getMarketNextPolicy()))
const uninstalling = ref(false)
const loadingBundleRecord = ref(false)
const showUninstallDialog = ref(false)
const showBundleUninstallDialog = ref(false)
const remoteBundleRecord = ref<BundleRecordView>()

watch(name, (value) => {
  if (!value) return
  void loadMarketObjects([value]).catch(error => {
    console.error('[market-next] failed to load plugin market metadata', error)
  })
}, { immediate: true })

const pendingRemove = computed(() => {
  const override = getPendingOverrides()
  return Object.prototype.hasOwnProperty.call(override, name.value) && !override[name.value]
})

const hasConfigEntries = computed(() => {
  return !!getConfigWriter(ctx)?.get(name.value)?.length
})

const bundleRecord = computed<BundleRecordView | PluginBundleRecord | undefined>(() => {
  const stored = getBundleRecords()[name.value]
  if (stored) return stored
  if (remoteBundleRecord.value?.package === name.value) return remoteBundleRecord.value
  return createLocalBundleRecord(name.value)
})

const showDependencyUninstall = computed(() => {
  if (global.static || protectedDeps.has(name.value)) return false
  if (local.value?.workspace || dep.value?.workspace) return false
  if (pendingRemove.value) return true
  if (store.dependencies) return !!dep.value
  return !!local.value
})

function ensureOverride() {
  return getPendingOverrides()
}

async function requestUninstall() {
  if (!name.value || uninstalling.value) return
  if (bundleRecord.value) {
    await loadRemoteBundleRecord()
    showBundleUninstallDialog.value = true
    return
  }
  if (getBulkMode()) {
    const override = ensureOverride()
    override[name.value] = ''
    void patchMarketNextData({ override: { ...override } })
    message.success(t('extensions.messages.stagedUninstall'))
    return
  }
  const savedRemoveConfig = getRemoveConfig()
  if (hasConfigEntries.value && typeof savedRemoveConfig !== 'boolean') {
    showUninstallDialog.value = true
    return
  }
  return uninstallDependency(savedRemoveConfig === true)
}

async function loadRemoteBundleRecord() {
  if (!name.value || getBundleRecords()[name.value]) return
  if (remoteBundleRecord.value?.package === name.value && remoteBundleRecord.value.members.length) return
  loadingBundleRecord.value = true
  try {
    const record = await fetchBundleRecord(name.value)
    if (record) remoteBundleRecord.value = record
  } catch (error) {
    console.warn(error)
    message.warning(t('extensions.messages.bundleRecordFailedShort'))
  } finally {
    loadingBundleRecord.value = false
  }
}

function cancelPendingUninstall() {
  const pendingBundle = pendingBundleUninstalls.value[name.value]
  const override = ensureOverride()
  delete override[name.value]
  for (const member of pendingBundle?.members ?? []) {
    delete override[member]
  }
  void patchMarketNextData({ override: { ...override } })
  delete pendingBundleUninstalls.value[name.value]
  message.success(t('extensions.messages.cancelUninstall'))
}

async function uninstallDependency(removeConfig: boolean) {
  if (!name.value || uninstalling.value) return
  showUninstallDialog.value = false
  uninstalling.value = true
  try {
    await install({ [name.value]: '' }, async () => {
      if (removeConfig) getConfigWriter(ctx)?.remove(name.value)
      const records = getWritableBundleRecords()
      delete records[name.value]
      const saved = await patchMarketNextData({ bundleRecords: records })
      if (!saved) message.warning(t('extensions.messages.bundleRecordFailed'))
    }, undefined, {
      loadingText: t('operations.install.uninstalling'),
      successText: t('operations.install.uninstalled'),
      errorText: t('operations.install.uninstallFailed'),
      timeoutText: t('operations.install.uninstallTimeout'),
    })
  } finally {
    uninstalling.value = false
  }
}

</script>

<style scoped src="./version.scss" lang="scss"></style>
