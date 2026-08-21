<template>
  <el-button
    solid
    :type="getType(data)"
    @click.stop.prevent="openPackage(data)">
    {{ getText(data) }}
  </el-button>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { marketPageContextKey } from '../composables/use-market-page'

const props = defineProps<{ data: SearchObject }>()
const page = inject(marketPageContextKey)!
const { getType, getText, openPackage } = page
</script>
