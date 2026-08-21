<template>
  <el-dialog
    v-model="showEnvironmentVersions"
    append-to-body
    destroy-on-close
    :class="['environment-versions-dialog', modeClass]"
    :title="t('environment.title')"
    width="min(1080px, calc(100vw - 24px))"
  >
    <environment-toolbar></environment-toolbar>

    <div class="environment-layout">
      <snapshot-sidebar></snapshot-sidebar>
      <snapshot-detail></snapshot-detail>
    </div>

    <template #footer>
      <environment-footer></environment-footer>
    </template>
  </el-dialog>

  <confirm-dialog></confirm-dialog>
</template>

<script lang="ts" setup>
import { provide } from 'vue'
import { useEnvironment } from './use-environment'
import { environmentContextKey } from './environment-context'
import ConfirmDialog from './confirm-dialog.vue'
import EnvironmentFooter from './environment-footer.vue'
import EnvironmentToolbar from './environment-toolbar.vue'
import SnapshotDetail from './snapshot-detail.vue'
import SnapshotSidebar from './snapshot-sidebar.vue'

const ctx = useEnvironment()
provide(environmentContextKey, ctx)
const { t, modeClass, showEnvironmentVersions } = ctx
</script>

<style src="./index.scss" lang="scss"></style>
