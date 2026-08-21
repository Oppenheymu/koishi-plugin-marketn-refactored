<template>
  <el-dialog
    v-model="confirmVisible"
    append-to-body
    :class="['environment-confirm-dialog', modeClass]"
    :title="t('environment.confirmTitle')"
    width="min(520px, calc(100vw - 24px))"
  >
    <p>{{ t('environment.confirmText', { count: preview?.actionableCount ?? 0 }) }}</p>
    <k-comment type="warning">{{ t('environment.scopeWarning') }}</k-comment>
    <k-comment v-if="removedCount" type="danger">
      {{ t('environment.removeWarning', { count: removedCount }) }}
    </k-comment>
    <template #footer>
      <el-button @click="confirmVisible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" @click="applySnapshot">{{ t('environment.confirmRestore') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { environmentContextKey } from './environment-context'

const { t, modeClass, confirmVisible, preview, removedCount, applySnapshot } = inject(environmentContextKey)!
</script>
