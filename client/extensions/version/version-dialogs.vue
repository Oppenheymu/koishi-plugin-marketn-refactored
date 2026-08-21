<template>
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

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import BundleUninstall from '../../dialogs/bundle-uninstall/index.vue'
import { versionContextKey } from './version-context'

const { t } = useMarketNextI18n()
const { showUninstallDialog, showBundleUninstallDialog, name, bundleRecord, uninstallDependency } = inject(versionContextKey)!
</script>
