<template>
  <el-dialog :model-value="!!active" @update:model-value="closePanel" :class="['install-panel', modeClass]" destroy-on-close>
    <template v-if="active" #header="{ titleId, titleClass }">
      <install-header :title-id="titleId" :title-class="titleClass"></install-header>
    </template>

    <install-body></install-body>

    <template v-if="active && !global.static" #footer>
      <install-footer></install-footer>
    </template>
  </el-dialog>

  <install-remove-dialog></install-remove-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="bundleUninstallTarget"
    :record="bundleUninstallRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
import { global } from '@koishijs/client'
import { provide } from 'vue'
import BundleUninstall from '../bundle-uninstall/index.vue'
import InstallBody from './install-body.vue'
import InstallFooter from './install-footer.vue'
import InstallHeader from './install-header.vue'
import InstallRemoveDialog from './install-remove-dialog.vue'
import { installContextKey } from './install-context'
import { useInstall } from './use-install'

const ctx = useInstall()
provide(installContextKey, ctx)
const { active, modeClass, closePanel, showBundleUninstallDialog, bundleUninstallTarget, bundleUninstallRecord } = ctx
</script>

<style src="./index.scss" lang="scss"></style>
