<template>
  <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
  <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
    {{ t('bundle.actions.install') }} <span v-if="selectedMembers.length" class="footer-count">({{ selectedMembers.length }})</span>
  </el-button>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleContextKey } from './bundle-context'

const { t } = useMarketNextI18n()
const { close, installing, canInstall, confirmInstall, selectedMembers } = inject(bundleContextKey)!
</script>
