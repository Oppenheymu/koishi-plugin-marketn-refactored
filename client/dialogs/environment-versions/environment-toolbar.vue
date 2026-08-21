<template>
  <div class="environment-toolbar">
    <span>{{ loading ? t('environment.syncing') : t('environment.count', { count: snapshots.length }) }}</span>
    <el-button :loading="loading" @click="loadSnapshots(true)">{{ t('environment.refresh') }}</el-button>
  </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { environmentContextKey } from './environment-context'

const { t, loading, snapshots, loadSnapshots } = inject(environmentContextKey)!
</script>
