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
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { versionContextKey } from './version-context'

const { t } = useMarketNextI18n()
const { object, showDependencyUninstall, local, pendingRemove, uninstalling, loadingBundleRecord, bundleRecord, cancelPendingUninstall, requestUninstall } = inject(versionContextKey)!
</script>

<style scoped src="./index.scss" lang="scss"></style>
