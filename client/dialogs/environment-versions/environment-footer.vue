<template>
  <el-button @click="showEnvironmentVersions = false">{{ t('common.actions.close') }}</el-button>
  <el-button type="primary" :disabled="!canApply" @click="confirmVisible = true">
    {{ preview?.snapshot.current ? t('environment.alreadyCurrent') : t('environment.restore') }}
  </el-button>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { environmentContextKey } from './environment-context'

const { t, showEnvironmentVersions, canApply, confirmVisible, preview } = inject(environmentContextKey)!
</script>
