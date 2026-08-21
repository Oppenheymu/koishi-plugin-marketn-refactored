<template>
  <bundle-uninstall
    v-model="visible"
    :package-name="packageName"
    :record="record"
    redirect-to-plugins
  ></bundle-uninstall>
</template>

<script setup lang="ts">

import { computed, ref, watch } from 'vue'
import { message } from '@koishijs/client'
import {
  fetchBundleRecord,
  resolveBundlePackageFromGroup,
  resolveBundleRecordFromGroup,
} from '../lib/bundle-records'
import type { BundleRecordView } from '../lib/bundle-records'
import { getBundleRecords } from '../lib/data-store'
import { bundleGroupUninstallTarget } from './bundle-group-uninstall'
import BundleUninstall from '../dialogs/bundle-uninstall'
import { useMarketNextI18n } from '../i18n'

const { t } = useMarketNextI18n()
const loadingBundleRecord = ref(false)
const remoteBundleRecord = ref<BundleRecordView>()

const target = computed(() => bundleGroupUninstallTarget.value)
const packageName = computed(() => {
  return resolveBundlePackageFromGroup(target.value?.path, getBundleRecords())
})
const record = computed(() => {
  const name = packageName.value
  if (!name) return
  const records = getBundleRecords()
  const stored = records[name]
  if (stored) return stored
  if (remoteBundleRecord.value?.package === name) return remoteBundleRecord.value
  return resolveBundleRecordFromGroup(target.value?.path, records)
})

const visible = computed({
  get: () => !!bundleGroupUninstallTarget.value,
  set: (value) => {
    if (!value) bundleGroupUninstallTarget.value = undefined
  },
})

watch(target, async (value) => {
  remoteBundleRecord.value = undefined
  if (!value) return
  await loadRemoteBundleRecord()
}, { immediate: true })

async function loadRemoteBundleRecord() {
  const name = packageName.value
  if (!name || getBundleRecords()[name]) return
  loadingBundleRecord.value = true
  try {
    const next = await fetchBundleRecord(name)
    if (next) remoteBundleRecord.value = next
  } catch (error) {
    console.warn(error)
    message.warning(t('extensions.messages.bundleRecordFailedShort'))
  } finally {
    loadingBundleRecord.value = false
  }
}

</script>

<style scoped src="./bundle-group-uninstall.scss" lang="scss"></style>
