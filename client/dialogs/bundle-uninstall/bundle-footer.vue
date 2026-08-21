<template>
  <el-button @click="visible = false">{{ t('bundle.actions.cancel') }}</el-button>
  <el-button type="danger" :loading="loadingRecord || uninstalling" :disabled="!packageName" @click="uninstallBundle">
    {{ t('bundle.actions.uninstall') }}
  </el-button>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleUninstallContextKey } from './bundle-uninstall-context'

const { t } = useMarketNextI18n()
const { visible, loadingRecord, uninstalling, packageName, uninstallBundle } = inject(bundleUninstallContextKey)!
</script>
