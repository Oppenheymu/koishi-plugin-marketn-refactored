<template>
  <div class="left">
    <el-checkbox v-model="bulkMode">
      {{ t('operations.install.bulkMode') }}
      <k-hint>
        {{ t('operations.install.bulkModeHint') }}
      </k-hint>
    </el-checkbox>
  </div>
  <div class="right">
    <el-button v-if="local" type="primary" @click="configure()">{{ t('dependencyCard.actions.configure') }}</el-button>
    <template v-if="localSelection">
      <el-button v-if="showRemoveButton" @click="installDep('', true)" type="danger">{{ t('operations.install.remove') }}</el-button>
      <el-button v-else-if="workspace" @click="installDep(workspace)" type="success">{{ t('operations.install.add') }}</el-button>
    </template>
    <template v-else-if="data">
      <el-button v-if="showRemoveButton" @click="requestRemove()" type="danger">{{ t('operations.install.uninstall') }}</el-button>
      <el-button :type="result" @click="installDep(version)" :disabled="unchanged">
        {{ current ? t('operations.install.update') : store.dependencies?.[active] ? t('operations.install.repair') : t('operations.install.install') }}
      </el-button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { store } from '@koishijs/client'
import { inject } from 'vue'
import { installContextKey } from './install-context'

const { t, bulkMode, local, configure, localSelection, showRemoveButton, workspace, installDep, data, requestRemove, result, version, unchanged, current, active } = inject(installContextKey)!
</script>
