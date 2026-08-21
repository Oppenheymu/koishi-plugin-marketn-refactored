<template>
  <diff-panel
    :install-list="installList"
    :config-list="configList"
    :preset-list="presetList"
    :move-list="moveList"
    :skipped-config-list="skippedConfigList"
  ></diff-panel>
</template>

<script setup lang="ts">
import { inject } from 'vue'
  import { bundleContextKey } from '../logic/bundle-context'
import DiffPanel from './diff-panel.vue'

const { installList, configList, presetList, moveList, skippedConfigList } = inject(bundleContextKey)!
</script>
