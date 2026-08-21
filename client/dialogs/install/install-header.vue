<template>
  <span :id="titleId" :class="titleClass">
    {{ active + (localSelection ? ` (${t('dependencyCard.current.local')})` : '') }}
  </span>
  <el-select
    v-if="data"
    v-model="selectVersion"
    class="market-version-select"
    :disabled="localSelection"
    :popper-class="versionPopperClass"
  >
    <el-option v-for="({ result }, version) in data" :key="version" :value="version">
      {{ version }}
      <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
      <span :class="[result, 'theme-color', 'dot-hint']"></span>
    </el-option>
  </el-select>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { installContextKey } from './install-context'

defineProps<{ titleId: string; titleClass: string }>()

const { t, active, localSelection, data, selectVersion, versionPopperClass, current } = inject(installContextKey)!
</script>
