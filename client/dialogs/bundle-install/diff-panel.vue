<template>
  <div class="bundle-diff">
    <div class="bundle-diff-title">{{ t('bundle.diff.title') }}</div>
    <div class="bundle-diff-grid">
      <div class="bundle-diff-cell">
        <div class="bundle-diff-head"><k-icon name="cube"></k-icon> {{ t('bundle.diff.install') }} <strong>{{ installList.length }}</strong></div>
        <div class="bundle-diff-tags">
          <span v-for="item in installList" :key="item" class="bundle-diff-tag install">{{ item }}</span>
        </div>
      </div>
      <div class="bundle-diff-cell" v-if="configList.length || presetList.length">
        <div class="bundle-diff-head"><k-icon name="settings"></k-icon> {{ t('bundle.diff.config') }} <strong>{{ configList.length }}</strong></div>
        <div class="bundle-diff-tags">
          <span v-for="item in configList" :key="item" :class="['bundle-diff-tag config', { 'with-preset': presetList.includes(item) }]">
            {{ item }}
            <span v-if="presetList.includes(item)" class="preset-marker">{{ t('bundle.diff.preset') }}</span>
          </span>
        </div>
      </div>
      <div class="bundle-diff-cell" v-if="moveList.length">
        <div class="bundle-diff-head"><k-icon name="arrow-right"></k-icon> {{ t('bundle.diff.move') }} <strong>{{ moveList.length }}</strong></div>
        <div class="bundle-diff-tags">
          <span v-for="item in moveList" :key="item" class="bundle-diff-tag move">{{ item }}</span>
        </div>
      </div>
      <div class="bundle-diff-cell" v-if="skippedConfigList.length">
        <div class="bundle-diff-head"><k-icon name="info-full"></k-icon> {{ t('bundle.diff.skip') }} <strong>{{ skippedConfigList.length }}</strong></div>
        <div class="bundle-diff-tags">
          <span v-for="item in skippedConfigList" :key="item" class="bundle-diff-tag skip">{{ item }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useMarketNextI18n } from '../../i18n'

const { t } = useMarketNextI18n()

defineProps<{
  installList: string[]
  configList: string[]
  presetList: string[]
  moveList: string[]
  skippedConfigList: string[]
}>()
</script>
