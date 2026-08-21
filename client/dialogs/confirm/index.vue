<template>
  <el-dialog v-if="store.market?.registry" v-model="showConfirm" :class="['confirm-panel', modeClass]" destroy-on-close>
    <template #header>{{ t('operations.confirm.title') }}</template>
    <div class="confirm-change-list">
      <table>
        <colgroup>
          <col width="auto">
          <col width="auto">
          <col width="1rem">
          <col width="auto">
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('operations.confirm.dependency') }}</th>
            <th>{{ t('operations.confirm.oldVersion') }}</th>
            <th></th>
            <th>{{ t('operations.confirm.newVersion') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(version, name) in overrides" :key="name">
            <td>{{ name }}</td>
            <td>{{ store.dependencies?.[name]?.resolved || t('operations.confirm.notInstalled') }}</td>
            <td class="arrow"><span><k-icon name="arrow-right"></k-icon></span></td>
            <td>{{ version || t('operations.confirm.removeDependency') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <div class="left">
        <el-checkbox :disabled="!hasRemove" v-model="removeConfig">
          {{ t('operations.confirm.removeConfig') }}
        </el-checkbox>
      </div>
      <div class="right">
        <el-button type="danger" @click="clear">{{ t('operations.confirm.discard') }}</el-button>
        <el-button type="primary" @click="confirm">{{ t('operations.confirm.apply') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>

import { computed, ref } from 'vue'
import { message, send, store, useContext } from '@koishijs/client'
import { ensureInstalledConfigs, getConfigWriter } from '../../lib/config-writer'
import { pendingBundleUninstalls, showConfirm } from '../../lib/dialogs'
import { getPendingOverrides, getWritableBundleRecords, patchMarketNextData } from '../../lib/data-store'
import { install, MARKET_NEXT_PACKAGE } from '../../lib/install-flow'
import { getFrontendMode, getRemoveConfig } from '../../lib/market-config'
import { useMarketNextI18n } from '../../i18n'

const ctx = useContext()
const { t } = useMarketNextI18n()
const overrides = computed(() => getPendingOverrides())
const modeClass = computed(() => `market-mode-${getFrontendMode()}`)

const removeConfig = ref(getRemoveConfig())

function clear() {
  showConfirm.value = false
  const override = getPendingOverrides()
  for (const key of Object.keys(override)) delete override[key]
  void patchMarketNextData({ override: { ...override } })
  pendingBundleUninstalls.value = {}
}

const hasRemove = computed(() => {
  return Object.values(overrides.value).some(version => !version)
})

function confirm() {
  showConfirm.value = false
  const override = { ...overrides.value }
  const selfUpdate = Object.prototype.hasOwnProperty.call(override, MARKET_NEXT_PACKAGE)
  const removed = Object.entries(override)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  const bundleRemovals = Object.fromEntries(Object.entries(pendingBundleUninstalls.value)
    .filter(([name]) => removed.includes(name)))
  const bundlePackages = new Set(Object.keys(bundleRemovals))
  const bundleMembers = new Set(Object.values(bundleRemovals)
    .flatMap(item => item.members ?? []))
  return install(override, async () => {
    const installNames = Object.entries(override)
      .filter(([, value]) => value)
      .map(([name]) => name)
      .filter(name => name !== MARKET_NEXT_PACKAGE)
    await ensureInstalledConfigs(ctx, installNames, true)
    for (const [name, item] of Object.entries(bundleRemovals)) {
      if (!item.cleanup) continue
      await send('market/remove-bundle-configs', {
        package: name,
        members: item.configs,
        removeEmptyGroup: true,
      })
    }
    if (removeConfig.value) {
      for (const name of removed) {
        if (bundlePackages.has(name) || bundleMembers.has(name)) continue
        getConfigWriter(ctx)?.remove(name)
      }
    }
    for (const name of removed) {
      delete getWritableBundleRecords()[name]
      delete pendingBundleUninstalls.value[name]
    }
    for (const key of Object.keys(getPendingOverrides())) delete getPendingOverrides()[key]
    const saved = await patchMarketNextData({
      override: {},
      bundleRecords: getWritableBundleRecords(),
    })
    if (!saved) message.warning(t('operations.confirm.saveBundleFailed'))
  }, undefined, selfUpdate ? {
    loadingText: t('operations.progress.selfUpdateTitle'),
    successText: t('operations.progress.selfSubmittedSuccess'),
    errorText: t('operations.progress.errorSelf'),
    timeoutText: t('operations.progress.installTimeout'),
    selfUpdate: true,
  } : undefined)
}

</script>

<style src="./index.scss" lang="scss"></style>
